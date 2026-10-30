import { keccak256, toHex, type Hex } from "viem";

/** Adapter kinds approved in the AdapterRegistry. */
export const ADAPTER_KINDS = ["ERC4626", "MORPHO", "EULER", "RWA"] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export const ADAPTER_KIND_HASH: Record<AdapterKind, Hex> = Object.fromEntries(
  ADAPTER_KINDS.map((k) => [k, keccak256(toHex(k))]),
) as Record<AdapterKind, Hex>;

export function adapterKindName(hash: Hex): AdapterKind | "UNKNOWN" {
  const lower = hash.toLowerCase();
  const found = ADAPTER_KINDS.find((k) => ADAPTER_KIND_HASH[k].toLowerCase() === lower);
  return found ?? "UNKNOWN";
}

/** Role identifiers from `src/AccessRoles.sol`. */
export const ROLES = {
  DEFAULT_ADMIN: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
  CURATOR: keccak256(toHex("VECTRA_CURATOR_ROLE")),
  KEEPER: keccak256(toHex("VECTRA_KEEPER_ROLE")),
  PAUSER: keccak256(toHex("VECTRA_PAUSER_ROLE")),
} as const;
