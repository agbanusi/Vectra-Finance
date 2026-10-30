import type { Address, ContractFunctionReturnType, PublicClient } from "viem";
import { indexLensAbi, indexVaultAbi } from "@vectra/sdk";

export type IndexView = ContractFunctionReturnType<typeof indexLensAbi, "view", "getIndex">;
export type AdapterView = IndexView["adapters"][number];
export type UserView = ContractFunctionReturnType<typeof indexLensAbi, "view", "getUser">;
export type OnchainRequest = ContractFunctionReturnType<typeof indexVaultAbi, "view", "redemptionRequest">;

export interface OpenRequest {
  id: bigint;
  request: OnchainRequest;
}

/** Read-only protocol access, always via the lens (which never reverts on a broken adapter). */
export interface ProtocolReader {
  getLatestBlock(): Promise<{ number: number; timestamp: number }>;
  getIndexes(vaults: readonly Address[], blockNumber?: number): Promise<readonly IndexView[]>;
  getUser(vault: Address, user: Address): Promise<UserView>;
  getRequests(vault: Address, fromId: bigint, toId: bigint): Promise<OpenRequest[]>;
  getRequest(vault: Address, id: bigint): Promise<OnchainRequest>;
}

export function viemProtocolReader(client: PublicClient, lens: Address): ProtocolReader {
  return {
    async getLatestBlock() {
      const b = await client.getBlock({ blockTag: "latest" });
      return { number: Number(b.number), timestamp: Number(b.timestamp) };
    },
    async getIndexes(vaults, blockNumber) {
      if (vaults.length === 0) return [];
      return client.readContract({
        address: lens,
        abi: indexLensAbi,
        functionName: "getIndexes",
        args: [[...vaults]],
        ...(blockNumber === undefined ? {} : { blockNumber: BigInt(blockNumber) }),
      });
    },
    getUser(vault, user) {
      return client.readContract({ address: lens, abi: indexLensAbi, functionName: "getUser", args: [vault, user] });
    },
    async getRequests(vault, fromId, toId) {
      const [ids, requests] = await client.readContract({
        address: lens,
        abi: indexLensAbi,
        functionName: "getRequests",
        args: [vault, fromId, toId],
      });
      return ids.map((id, i) => ({ id, request: requests[i] as OnchainRequest }));
    },
    getRequest(vault, id) {
      return client.readContract({ address: vault, abi: indexVaultAbi, functionName: "redemptionRequest", args: [id] });
    },
  };
}
