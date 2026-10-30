import type { Address } from "viem";

/** Mirrors `IIndexVault.RequestStatus`. Order must match the Solidity enum. */
export enum RequestStatus {
  None = 0,
  Pending = 1,
  PartiallyFilled = 2,
  Fulfilled = 3,
  Cancelled = 4,
  Expired = 5,
}

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  [RequestStatus.None]: "Unknown",
  [RequestStatus.Pending]: "Pending",
  [RequestStatus.PartiallyFilled]: "Partially filled",
  [RequestStatus.Fulfilled]: "Fulfilled",
  [RequestStatus.Cancelled]: "Cancelled",
  [RequestStatus.Expired]: "Expired",
};

export function isOpenRequest(status: RequestStatus): boolean {
  return status === RequestStatus.Pending || status === RequestStatus.PartiallyFilled;
}

/** Contents of `deployments/<chainId>.json` written by the Foundry scripts. */
export interface Deployment {
  chainId: number;
  startBlock: number;
  registry: Address;
  vaultImplementation: Address;
  factory: Address;
  lens: Address;
  permissionlessCompliance: Address;
  erc4626AdapterImpl: Address;
  morphoAdapterImpl: Address;
  eulerAdapterImpl: Address;
  rwaAdapterImpl: Address;
  /** Present only on local demo deployments. */
  mock?: boolean;
  /** Public-testnet deployment using faucet assets and yield-emulating strategy vaults. */
  testnet?: boolean;
  /** Testnet strategy vaults keyed by address (name, symbol, aprBps). */
  strategyVaults?: Record<string, { name: string; symbol: string; aprBps: number; vault: Address }>;
  baseAsset?: Address;
  indexes?: Address[];
  rwaCompliance?: Address;
}
