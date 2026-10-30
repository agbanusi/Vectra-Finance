"use client";

import { AlertTriangle } from "lucide-react";
import { useAccount, useSwitchChain } from "wagmi";
import { useMounted } from "@/hooks/useMounted";
import { appChain } from "@/lib/chain";
import { Button } from "../ui/Button";

/** Prompts a network switch when the connected wallet is on another chain. */
export function WrongNetworkBanner() {
  const mounted = useMounted();
  const { isConnected, chain, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  if (!mounted || !isConnected || (chain?.id ?? chainId) === appChain.id) return null;
  return (
    <div role="alert" className="border-b border-warning/25 bg-warning/[0.07]">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <p className="flex items-center gap-2 text-sm text-fg">
          <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
          Your wallet is on another network. Switch to {appChain.name} to deposit or withdraw.
        </p>
        <Button size="xs" variant="secondary" loading={isPending} onClick={() => switchChain({ chainId: appChain.id })}>
          Switch to {appChain.name}
        </Button>
      </div>
    </div>
  );
}
