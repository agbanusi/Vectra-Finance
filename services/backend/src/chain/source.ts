import type { Address, Hex, PublicClient } from "viem";

/** Minimal chain surface the indexer needs. A fake implementation drives the reorg tests. */
export interface BlockHeader {
  number: number;
  hash: Hex;
  parentHash: Hex;
  timestamp: number;
}

export interface RawLog {
  address: Address;
  blockNumber: number;
  blockHash: Hex;
  logIndex: number;
  transactionHash: Hex;
  topics: Hex[];
  data: Hex;
}

export interface ChainSource {
  getHeadNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<BlockHeader>;
  getLogs(params: { addresses: Address[]; fromBlock: number; toBlock: number }): Promise<RawLog[]>;
}

export function viemChainSource(client: PublicClient): ChainSource {
  return {
    async getHeadNumber() {
      return Number(await client.getBlockNumber({ cacheTime: 0 }));
    },
    async getBlock(blockNumber) {
      const b = await client.getBlock({ blockNumber: BigInt(blockNumber) });
      if (b.hash === null || b.number === null) throw new Error(`block ${blockNumber} is pending`);
      return { number: Number(b.number), hash: b.hash, parentHash: b.parentHash, timestamp: Number(b.timestamp) };
    },
    async getLogs({ addresses, fromBlock, toBlock }) {
      if (addresses.length === 0) return [];
      const logs = await client.getLogs({ address: addresses, fromBlock: BigInt(fromBlock), toBlock: BigInt(toBlock) });
      return logs.map((l) => {
        if (l.blockHash === null || l.blockNumber === null || l.logIndex === null || l.transactionHash === null) {
          throw new Error("received a pending log from a confirmed range");
        }
        return {
          address: l.address,
          blockNumber: Number(l.blockNumber),
          blockHash: l.blockHash,
          logIndex: l.logIndex,
          transactionHash: l.transactionHash,
          topics: [...l.topics] as Hex[],
          data: l.data,
        };
      });
    },
  };
}
