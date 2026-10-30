import { getAddress, type Address } from "viem";
import { adapterKindName, isOpenRequest, RequestStatus, type Deployment } from "@vectra/sdk";
import type { Db } from "../db/database.js";
import { getIndexRow, listIndexRows, listRequestsByOwner, type RequestRow } from "../db/derived.js";
import { getMetadata } from "../db/metadata.js";
import type { IndexView, ProtocolReader } from "../chain/reader.js";
import { toJsonSafe } from "../util/json.js";
import { notFound } from "./errors.js";

export interface ServiceDeps {
  db: Db;
  reader: ProtocolReader;
  chainId: number;
  deployment: Pick<Deployment, "indexes">;
}

const OPEN_STATUSES = [RequestStatus.Pending, RequestStatus.PartiallyFilled];

/** Indexes discovered by the indexer, plus any listed in the deployment file (before first sync). */
export function knownIndexes(deps: ServiceDeps): Address[] {
  const fromDb = listIndexRows(deps.db, deps.chainId).map((r) => getAddress(r.address));
  return [...new Set([...fromDb, ...(deps.deployment.indexes ?? [])])];
}

export function requireKnownIndex(deps: ServiceDeps, address: Address): void {
  if (!knownIndexes(deps).includes(address)) throw notFound(`index ${address} is not known`);
}

function presentIndex(deps: ServiceDeps, view: IndexView): unknown {
  const row = getIndexRow(deps.db, deps.chainId, view.vault);
  return {
    ...(toJsonSafe(view) as Record<string, unknown>),
    adapters: view.adapters.map((a) => ({ ...(toJsonSafe(a) as Record<string, unknown>), kindName: adapterKindName(a.kind) })),
    createdBlock: row?.createdBlock ?? null,
    metadata: getMetadata(deps.db, deps.chainId, view.vault) ?? null,
  };
}

export async function listIndexes(deps: ServiceDeps): Promise<unknown[]> {
  const views = await deps.reader.getIndexes(knownIndexes(deps));
  return views.map((v) => presentIndex(deps, v));
}

export async function getIndex(deps: ServiceDeps, address: Address): Promise<unknown> {
  requireKnownIndex(deps, address);
  const [view] = await deps.reader.getIndexes([address]);
  if (!view) throw notFound(`index ${address} is not known`);
  return presentIndex(deps, view);
}

/** Cached open requests are re-read on-chain; the chain wins and stale rows are dropped. */
async function verifiedOpenRequests(deps: ServiceDeps, wallet: Address): Promise<unknown[]> {
  const cached = listRequestsByOwner(deps.db, deps.chainId, wallet, OPEN_STATUSES);
  const verified = await Promise.all(cached.map((r) => verifyRequest(deps, r)));
  return verified.filter((r) => r !== undefined);
}

async function verifyRequest(deps: ServiceDeps, row: RequestRow): Promise<unknown> {
  const onchain = await deps.reader.getRequest(row.indexAddress as Address, BigInt(row.requestId));
  if (!isOpenRequest(onchain.status as RequestStatus)) return undefined;
  return {
    index: row.indexAddress,
    requestId: row.requestId,
    receiver: onchain.receiver,
    shares: onchain.shares.toString(),
    minAssetsOut: onchain.minAssetsOut.toString(),
    assetsPaid: onchain.assetsPaid.toString(),
    status: onchain.status,
    requestedAt: Number(onchain.requestedAt),
    expiresAt: Number(onchain.expiresAt),
  };
}

export async function portfolio(deps: ServiceDeps, wallet: Address): Promise<unknown> {
  const indexes = knownIndexes(deps);
  const users = await Promise.all(indexes.map((vault) => deps.reader.getUser(vault, wallet)));
  const positions = indexes
    .map((index, i) => ({ index, user: users[i] }))
    .filter(({ user }) => user !== undefined && user.shares > 0n)
    .map(({ index, user }) => ({
      index,
      symbol: getIndexRow(deps.db, deps.chainId, index)?.symbol ?? null,
      shares: user?.shares.toString(),
      value: user?.value.toString(),
    }));
  return { wallet, positions, openRequests: await verifiedOpenRequests(deps, wallet) };
}
