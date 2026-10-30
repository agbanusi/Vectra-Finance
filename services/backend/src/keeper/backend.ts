import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { indexVaultAbi } from "@vectra/sdk";
import { chainFor } from "../chain/clients.js";
import type { KeeperAction } from "./decisions.js";

export interface Simulation {
  result: unknown;
  request: unknown;
}

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** Transaction side of the keeper. Swappable with a fake in tests. */
export interface TxBackend {
  /** Account used for simulation; undefined only if dry-running without a known address. */
  readonly account: Address | undefined;
  /** False in dry-run mode (no private key configured). */
  readonly canSend: boolean;
  simulate(action: KeeperAction): Promise<Simulation>;
  estimateFees(): Promise<Fees>;
  send(action: KeeperAction, fees: Fees): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted"; blockNumber: bigint }>;
}

/** Raised when simulation shows the call would revert; never retried, never sent. */
export class SimulationRevertedError extends Error {}

type VaultCall = { functionName: string; args: readonly unknown[] };

/**
 * Headroom over the node's gas estimate. Estimates run in the block of the vault's last fee accrual
 * (no fee shares minted); execution a block later mints them and costs more. Observed on anvil: a
 * queued redeem estimated at 328,619 gas needed ~330,000 and ran out of gas without headroom.
 */
export const GAS_BUFFER_BPS = 12_500n;

export function bufferedGas(estimate: bigint): bigint {
  return (estimate * GAS_BUFFER_BPS) / 10_000n;
}

export function toCall(action: KeeperAction): VaultCall {
  switch (action.kind) {
    case "expireRedemption":
      return { functionName: "expireRedemption", args: [action.requestId] };
    case "rebalance":
      return { functionName: "rebalance", args: [action.maxActions] };
    case "processRedemptions":
      return { functionName: "processRedemptions", args: [action.maxRequests] };
    case "pullFromAdapter":
      return { functionName: "pullFromAdapter", args: [action.adapter, action.assets] };
    case "pushToAdapter":
      return { functionName: "pushToAdapter", args: [action.adapter, action.assets] };
  }
}

function isRevert(err: unknown): boolean {
  return err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError) !== null;
}

const RECEIPT_TIMEOUT_MS = 120_000;

export function viemTxBackend(opts: {
  publicClient: PublicClient;
  chainId: number;
  rpcUrl: string;
  privateKey: Hex | undefined;
}): TxBackend {
  const account: Account | undefined = opts.privateKey ? privateKeyToAccount(opts.privateKey) : undefined;
  const wallet = account
    ? createWalletClient({ account, chain: chainFor(opts.chainId, opts.rpcUrl), transport: http(opts.rpcUrl) })
    : undefined;
  const pc = opts.publicClient;

  return {
    account: account?.address,
    canSend: wallet !== undefined,
    async simulate(action) {
      const call = toCall(action);
      try {
        const sim = await pc.simulateContract({
          address: action.index,
          abi: indexVaultAbi,
          functionName: call.functionName as "rebalance",
          args: call.args as [bigint],
          ...(account ? { account } : {}),
        });
        return { result: sim.result, request: sim.request };
      } catch (err) {
        if (isRevert(err)) throw new SimulationRevertedError(err instanceof BaseError ? err.shortMessage : String(err));
        throw err;
      }
    },
    async estimateFees() {
      const f = await pc.estimateFeesPerGas();
      return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    },
    async send(action, fees) {
      if (!wallet || !account) throw new Error("dry-run backend cannot send");
      const call = toCall(action);
      const target = {
        address: action.index,
        abi: indexVaultAbi,
        functionName: call.functionName as "rebalance",
        args: call.args as [bigint],
        account,
      } as const;
      const gas = bufferedGas(await pc.estimateContractGas(target));
      return wallet.writeContract({
        ...target,
        gas,
        chain: wallet.chain,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas < fees.maxFeePerGas ? fees.maxPriorityFeePerGas : fees.maxFeePerGas,
      });
    },
    async waitForReceipt(hash) {
      const r = await pc.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      return { status: r.status, blockNumber: r.blockNumber };
    },
  };
}
