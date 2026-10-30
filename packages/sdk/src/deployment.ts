import { getAddress, isAddress, type Address } from "viem";
import type { Deployment } from "./types.js";

const REQUIRED_ADDRESSES = [
  "registry",
  "vaultImplementation",
  "factory",
  "lens",
  "permissionlessCompliance",
  "erc4626AdapterImpl",
  "morphoAdapterImpl",
  "eulerAdapterImpl",
  "rwaAdapterImpl",
] as const;

/** Validates and checksums a deployment JSON object. Throws on any missing or malformed field. */
export function parseDeployment(raw: unknown): Deployment {
  if (typeof raw !== "object" || raw === null) throw new Error("deployment: not an object");
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of REQUIRED_ADDRESSES) out[key] = requireAddress(obj, key);
  out.chainId = requireNumber(obj, "chainId");
  out.startBlock = requireNumber(obj, "startBlock");
  if (obj.mock !== undefined) out.mock = Boolean(obj.mock);
  if (obj.testnet !== undefined) out.testnet = Boolean(obj.testnet);
  if (obj.strategyVaults !== undefined) out.strategyVaults = obj.strategyVaults;
  if (obj.baseAsset !== undefined) out.baseAsset = requireAddress(obj, "baseAsset");
  if (obj.rwaCompliance !== undefined) out.rwaCompliance = requireAddress(obj, "rwaCompliance");
  if (obj.indexes !== undefined) {
    if (!Array.isArray(obj.indexes)) throw new Error("deployment: indexes must be an array");
    out.indexes = obj.indexes.map((a, i) => toAddress(a, `indexes[${i}]`));
  }
  return out as unknown as Deployment;
}

function requireAddress(obj: Record<string, unknown>, key: string): Address {
  return toAddress(obj[key], key);
}

function toAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`deployment: ${label} is not an address`);
  }
  return getAddress(value);
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`deployment: ${key} must be a non-negative integer`);
  }
  return value;
}
