import { decodeEventLog, getAddress, type Abi, type Hex } from "viem";
import { indexFactoryAbi, indexVaultAbi } from "@vectra/sdk";
import type { EventArgs } from "../db/events.js";
import type { RawLog } from "../chain/source.js";

export const UNKNOWN_EVENT = "Unknown";

const EVENT_ABI: Abi = [...indexVaultAbi, ...indexFactoryAbi].filter((item) => item.type === "event") as Abi;

export interface DecodedLog {
  eventName: string;
  args: EventArgs;
}

function normalize(value: unknown): string | number | boolean {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean" || typeof value === "number") return value;
  return String(value);
}

/** Decodes a vault/factory log. Logs with unknown topics are kept raw under `Unknown`. */
export function decodeLog(log: Pick<RawLog, "topics" | "data">): DecodedLog {
  if (log.topics.length === 0) return { eventName: UNKNOWN_EVENT, args: {} };
  try {
    const decoded = decodeEventLog({
      abi: EVENT_ABI,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    });
    const args: EventArgs = {};
    for (const [k, v] of Object.entries((decoded.args ?? {}) as Record<string, unknown>)) args[k] = normalize(v);
    return { eventName: decoded.eventName ?? UNKNOWN_EVENT, args };
  } catch {
    // Not an event from our ABIs (e.g. a future contract version): stored raw, never dropped.
    return { eventName: UNKNOWN_EVENT, args: {} };
  }
}

export function argAddress(args: EventArgs, key: string): string {
  return getAddress(String(args[key]));
}

export function argBig(args: EventArgs, key: string): bigint {
  return BigInt(String(args[key]));
}
