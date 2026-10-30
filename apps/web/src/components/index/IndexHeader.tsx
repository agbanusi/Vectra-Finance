"use client";

import { ArrowLeft, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import { toast } from "sonner";
import { useMounted } from "@/hooks/useMounted";
import type { IndexMetadata } from "@/lib/metadata";
import { RISK_LABEL } from "@/lib/metadata";
import { indexStatus, isPermissionless, type IndexView } from "@/lib/types";
import { AddressLink } from "../ui/AddressLink";
import { Badge, Tag, type Tone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { TokenIcon } from "../ui/TokenIcon";
import { RestrictedLock } from "../markets/IndexIdentity";

const STATUS: Record<ReturnType<typeof indexStatus>, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  "deposits-paused": { tone: "warning", label: "Deposits paused" },
  "redemptions-paused": { tone: "warning", label: "Withdrawals paused" },
  paused: { tone: "warning", label: "Paused" },
  shutdown: { tone: "danger", label: "Emergency shutdown" },
};

const RISK_TONE = { low: "success", medium: "info", high: "warning" } as const;

function AddToWallet({ index: v }: { index: IndexView }) {
  const mounted = useMounted();
  const { isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  if (!mounted || !isConnected || !wallet) return null;
  const add = async () => {
    try {
      // MetaMask caps watchAsset symbols at 11 characters.
      const ok = await wallet.watchAsset({ type: "ERC20", options: { address: v.vault, symbol: v.symbol.slice(0, 11), decimals: 18 } });
      if (ok) toast.success(`${v.symbol} added to your wallet`);
    } catch {
      toast.error("Your wallet did not add the token");
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={add}>
      <Plus className="size-4" aria-hidden="true" />
      Add to wallet
    </Button>
  );
}

export function IndexHeader({ index: v, meta }: { index: IndexView; meta: IndexMetadata }) {
  const status = STATUS[indexStatus(v)];
  return (
    <header className="space-y-5">
      <Link href="/app" className="inline-flex items-center gap-1.5 rounded text-sm text-muted transition-colors hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Markets
      </Link>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <TokenIcon symbol={v.symbol} seed={v.vault} size={56} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[30px] sm:leading-9">{v.name}</h1>
              {isPermissionless(v.compliancePolicy) ? null : <RestrictedLock size={16} />}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Tag className="font-semibold text-fg">{v.symbol}</Tag>
              <Badge tone={status.tone} dot>{status.label}</Badge>
              <Badge tone="accent">{meta.curator}</Badge>
              <Tag>{meta.category}</Tag>
              <Badge tone={RISK_TONE[meta.riskTier]} icon={<ShieldCheck />}>{RISK_LABEL[meta.riskTier]}</Badge>
              {isPermissionless(v.compliancePolicy) ? <Tag>Permissionless</Tag> : <Badge tone="warning">Allowlist</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-subtle">
            Token <AddressLink address={v.vault} />
          </span>
          <AddToWallet index={v} />
        </div>
      </div>
    </header>
  );
}
