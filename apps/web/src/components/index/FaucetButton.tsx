"use client";

import { Droplets } from "lucide-react";
import { useAccount } from "wagmi";
import { faucetAvailable, FAUCET_AMOUNT, useFaucet } from "@/hooks/useFaucet";
import { useMounted } from "@/hooks/useMounted";
import { config } from "@/lib/config";
import { isTxBusy } from "@/lib/tx";
import { Button, type ButtonProps } from "../ui/Button";

/** Testnet-only: mints 10,000 test USDC to the connected wallet. Renders nothing elsewhere. */
export function FaucetButton({ symbol = "tUSDC", decimals = 6, variant = "secondary", size = "sm", className, cfg = config }: { symbol?: string; decimals?: number; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; className?: string; cfg?: Pick<typeof config, "isTestnet" | "baseAsset"> }) {
  const mounted = useMounted();
  const { address } = useAccount();
  const { mint, tx } = useFaucet(cfg.baseAsset, decimals);
  if (!mounted || !faucetAvailable(cfg) || !address) return null;
  return (
    <Button variant={variant} size={size} className={className} loading={isTxBusy(tx.state.phase)} onClick={mint}>
      {isTxBusy(tx.state.phase) ? null : <Droplets className="size-4" aria-hidden="true" />}
      Get {Number(FAUCET_AMOUNT).toLocaleString("en-US")} {symbol}
    </Button>
  );
}
