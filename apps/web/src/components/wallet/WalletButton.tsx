"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, ChevronDown, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { useState } from "react";
import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { useMounted } from "@/hooks/useMounted";
import { appChain } from "@/lib/chain";
import { explorerAddressUrl, shortAddress } from "@/lib/explorer";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { WalletModal } from "./WalletModal";

function Avatar({ address, size = 20 }: { address: string; size?: number }) {
  const h = parseInt(address.slice(2, 8), 16);
  const a = `hsl(${h % 360} 75% 62%)`;
  const b = `hsl(${(h >> 8) % 360} 70% 45%)`;
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-full ring-1 ring-white/15" style={{ width: size, height: size, background: `conic-gradient(from 140deg, ${a}, ${b}, ${a})` }} />;
}

/** Connect button; opens the wallet modal, or an account menu when connected. */
export function WalletButton({ className, size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { chain } = useAccount();

  if (!mounted) return <Button size={size} variant="secondary" disabled className={className}>Connect wallet</Button>;

  if (!isConnected || !address) {
    return (
      <>
        <Button size={size} onClick={() => setOpen(true)} className={className}>
          <Wallet className="size-4" aria-hidden="true" />
          Connect wallet
        </Button>
        <WalletModal open={open} onOpenChange={setOpen} />
      </>
    );
  }

  const wrongNetwork = (chain?.id ?? chainId) !== appChain.id;
  if (wrongNetwork) {
    return (
      <Button size={size} variant="danger" loading={switching} onClick={() => switchChain({ chainId: appChain.id })} className={className}>
        {switching ? null : <AlertTriangle className="size-4" aria-hidden="true" />}
        Switch to {appChain.name}
      </Button>
    );
  }

  const url = explorerAddressUrl(address);
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <button
          type="button"
          aria-label={`Account ${address}`}
          className={cn("inline-flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-surface-2 pl-2 pr-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-3", className)}
        >
          <Avatar address={address} />
          <span className="tabular">{shortAddress(address)}</span>
          <ChevronDown className="size-3.5 text-subtle" aria-hidden="true" />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={8} className="z-50 w-60 animate-fade-in rounded-xl bg-surface-2 p-1.5 shadow-[var(--shadow-pop)]">
          <div className="flex items-center gap-2.5 px-2.5 py-2.5">
            <Avatar address={address} size={28} />
            <div className="min-w-0">
              <p className="tabular truncate text-sm font-medium text-fg">{shortAddress(address)}</p>
              <p className="text-xs text-subtle">{appChain.name}</p>
            </div>
          </div>
          <DM.Separator className="my-1 h-px bg-border" />
          <MenuItem onSelect={() => void navigator.clipboard?.writeText(address)} icon={<Copy className="size-4" />}>Copy address</MenuItem>
          {url ? <MenuItem onSelect={() => window.open(url, "_blank", "noopener,noreferrer")} icon={<ExternalLink className="size-4" />}>View on explorer</MenuItem> : null}
          <MenuItem onSelect={() => disconnect()} icon={<LogOut className="size-4" />}>Disconnect</MenuItem>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function MenuItem({ children, icon, onSelect }: { children: React.ReactNode; icon: React.ReactNode; onSelect: () => void }) {
  return (
    <DM.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted outline-none transition-colors data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg">
      <span aria-hidden="true" className="text-subtle">{icon}</span>
      {children}
    </DM.Item>
  );
}
