import { RequestStatus } from "@vectra/sdk";
import type { Db } from "../db/database.js";
import { transaction } from "../db/database.js";
import { eventsInOrder, type StoredEvent } from "../db/events.js";
import {
  clearDerived,
  getRequest,
  insertActivity,
  upsertIndex,
  upsertRequest,
  type ActivityRow,
  type RequestRow,
} from "../db/derived.js";
import { argAddress, argBig } from "./decode.js";

/**
 * Projects raw events into derived tables. Every handler is a pure function of (event, prior derived
 * state), so replaying `events` in chain order always reproduces identical tables.
 */
type Handler = (db: Db, e: StoredEvent) => void;

const ZERO = "0x0000000000000000000000000000000000000000";

function activity(db: Db, e: StoredEvent, wallet: string, kind: string, extra: Partial<ActivityRow>): void {
  insertActivity(db, e.chainId, {
    eventId: e.id,
    wallet,
    indexAddress: e.address,
    kind,
    shares: null,
    assets: null,
    requestId: null,
    blockNumber: e.blockNumber,
    timestamp: e.blockTimestamp,
    txHash: e.txHash,
    logIndex: e.logIndex,
    ...extra,
  });
}

function activityForEach(db: Db, e: StoredEvent, wallets: string[], kind: string, extra: Partial<ActivityRow>): void {
  for (const wallet of new Set(wallets)) activity(db, e, wallet, kind, extra);
}

const onIndexCreated: Handler = (db, e) => {
  upsertIndex(db, e.chainId, {
    address: argAddress(e.args, "vault"),
    curator: argAddress(e.args, "curator"),
    baseAsset: argAddress(e.args, "baseAsset"),
    name: String(e.args.name),
    symbol: String(e.args.symbol),
    complianceModule: argAddress(e.args, "complianceModule"),
    createdBlock: e.blockNumber,
    createdTx: e.txHash,
  });
};

const onDeposited: Handler = (db, e) => {
  activityForEach(db, e, [argAddress(e.args, "receiver"), argAddress(e.args, "payer")], "deposit", {
    shares: String(e.args.shares),
    assets: String(e.args.assets),
  });
};

const onRedeemed: Handler = (db, e) => {
  activityForEach(db, e, [argAddress(e.args, "owner"), argAddress(e.args, "receiver")], "redeem", {
    shares: String(e.args.shares),
    assets: String(e.args.assets),
  });
};

const onRequested: Handler = (db, e) => {
  const requestId = Number(e.args.requestId);
  const owner = argAddress(e.args, "owner");
  const shares = String(e.args.shares);
  upsertRequest(db, e.chainId, {
    indexAddress: e.address,
    requestId,
    owner,
    receiver: argAddress(e.args, "receiver"),
    initialShares: shares,
    remainingShares: shares,
    minAssetsOut: String(e.args.minAssetsOut),
    assetsPaid: "0",
    status: RequestStatus.Pending,
    expiresAt: Number(e.args.expiresAt),
    requestedAt: e.blockTimestamp,
    requestedBlock: e.blockNumber,
    updatedBlock: e.blockNumber,
    txHash: e.txHash,
  });
  activity(db, e, owner, "redemption_requested", { shares, requestId });
};

function loadRequest(db: Db, e: StoredEvent): RequestRow {
  const requestId = Number(e.args.requestId);
  const row = getRequest(db, e.chainId, e.address, requestId);
  if (!row) throw new Error(`event ${e.eventName} references unknown request ${e.address}#${requestId}`);
  return row;
}

function fillHandler(status: RequestStatus, kind: string): Handler {
  return (db, e) => {
    const row = loadRequest(db, e);
    const burned = argBig(e.args, "sharesBurned");
    const paid = argBig(e.args, "assetsPaid");
    const remaining = BigInt(row.remainingShares) - burned;
    upsertRequest(db, e.chainId, {
      ...row,
      remainingShares: (remaining < 0n ? 0n : remaining).toString(),
      assetsPaid: (BigInt(row.assetsPaid) + paid).toString(),
      status,
      updatedBlock: e.blockNumber,
    });
    activityForEach(db, e, [row.owner, argAddress(e.args, "receiver")], kind, {
      shares: burned.toString(),
      assets: paid.toString(),
      requestId: row.requestId,
    });
  };
}

function closeHandler(status: RequestStatus, kind: string): Handler {
  return (db, e) => {
    const row = loadRequest(db, e);
    upsertRequest(db, e.chainId, { ...row, remainingShares: "0", status, updatedBlock: e.blockNumber });
    activityForEach(db, e, [row.owner, argAddress(e.args, "recipient")], kind, {
      shares: String(e.args.shares),
      requestId: row.requestId,
    });
  };
}

/** Plain share transfers between holders. Mints, burns and queue escrow moves are covered elsewhere. */
const onTransfer: Handler = (db, e) => {
  const from = argAddress(e.args, "from");
  const to = argAddress(e.args, "to");
  const internal = [ZERO, e.address].map((a) => a.toLowerCase());
  if (internal.includes(from.toLowerCase()) || internal.includes(to.toLowerCase())) return;
  const shares = String(e.args.value);
  activity(db, e, from, "transfer_out", { shares });
  activity(db, e, to, "transfer_in", { shares });
};

const HANDLERS: Record<string, Handler> = {
  IndexCreated: onIndexCreated,
  Deposited: onDeposited,
  Redeemed: onRedeemed,
  RedemptionRequested: onRequested,
  RedemptionPartiallyFilled: fillHandler(RequestStatus.PartiallyFilled, "redemption_partially_filled"),
  RedemptionFilled: fillHandler(RequestStatus.Fulfilled, "redemption_filled"),
  RedemptionCancelled: closeHandler(RequestStatus.Cancelled, "redemption_cancelled"),
  RedemptionExpired: closeHandler(RequestStatus.Expired, "redemption_expired"),
  Transfer: onTransfer,
};

export function applyEvent(db: Db, e: StoredEvent): void {
  HANDLERS[e.eventName]?.(db, e);
}

/** Rebuilds derived tables from scratch. Caller must hold a transaction. */
export function rebuildDerivedUnsafe(db: Db, chainId: number): number {
  clearDerived(db, chainId);
  const events = eventsInOrder(db, chainId);
  for (const e of events) applyEvent(db, e);
  return events.length;
}

export function rebuildDerived(db: Db, chainId: number): number {
  return transaction(db, () => rebuildDerivedUnsafe(db, chainId));
}
