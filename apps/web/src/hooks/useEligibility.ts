"use client";

import { allowlistComplianceAbi } from "@vectra/sdk";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { isPermissionless } from "@/lib/types";
import { ZERO } from "./useIndexes";

export interface Eligibility {
  /** true / false when known, null when unknown (no wallet, unknown policy, or loading). */
  eligible: boolean | null;
  label: string;
}

export function useEligibility(policy: string | undefined, module: Address | undefined): Eligibility {
  const { address } = useAccount();
  const isAllowlist = policy === "allowlist";
  const read = useReadContract({
    address: module ?? ZERO,
    abi: allowlistComplianceAbi,
    functionName: "isEligible",
    args: [address ?? ZERO],
    query: { enabled: Boolean(isAllowlist && module && address) },
  });
  if (!policy || isPermissionless(policy)) return { eligible: true, label: "Open to all wallets" };
  if (!address) return { eligible: null, label: "Connect a wallet to check eligibility" };
  if (!isAllowlist) return { eligible: null, label: `Policy "${policy}" — eligibility enforced on-chain at transaction time` };
  if (read.data === undefined) return { eligible: null, label: read.isError ? "Could not read eligibility" : "Checking eligibility…" };
  return read.data
    ? { eligible: true, label: "Your wallet is on the allowlist" }
    : { eligible: false, label: "Your wallet is not on the allowlist" };
}
