"use client";

import { testnetTokenAbi } from "@vectra/sdk";
import { parseUnits, type Address } from "viem";
import { useAccount } from "wagmi";
import { simulateContract } from "wagmi/actions";
import { config } from "@/lib/config";
import { writeWithGasBuffer } from "@/lib/gas";
import { wagmiConfig } from "@/lib/wagmi";
import { useTx } from "./useTx";

export const FAUCET_AMOUNT = "10000";

/** Whether the faucet button should render: testnet deployments with a known base asset only. */
export function faucetAvailable(cfg: { isTestnet: boolean; baseAsset: Address | null }): boolean {
  return cfg.isTestnet && cfg.baseAsset !== null;
}

/** Mints 10,000 test tokens (faucet cap is 100,000 per call) to the connected wallet. */
export function useFaucet(token: Address | null = config.baseAsset, decimals = 6) {
  const { address } = useAccount();
  const tx = useTx({ label: `Mint ${Number(FAUCET_AMOUNT).toLocaleString("en-US")} test USDC` });
  const mint = () => {
    if (!address || !token) return;
    const amount = parseUnits(FAUCET_AMOUNT, decimals);
    void tx.execute(
      () => simulateContract(wagmiConfig, { address: token, abi: testnetTokenAbi, functionName: "mint", args: [address, amount], account: address }),
      ({ request }) => writeWithGasBuffer(request),
    );
  };
  return { mint, tx, enabled: Boolean(address && token) };
}
