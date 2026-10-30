"use client";

import { ChevronRight, Wallet } from "lucide-react";
import { useMemo } from "react";
import { useConnect, type Connector } from "wagmi";
import { appChain } from "@/lib/chain";
import { describeError } from "@/lib/errors";
import { Dialog } from "../ui/Dialog";
import { Spinner } from "../ui/Spinner";

function sortConnectors(list: readonly Connector[]): Connector[] {
  const seen = new Set<string>();
  const announced = list.filter((c) => c.type === "injected" && c.id !== "injected");
  const out: Connector[] = [];
  for (const c of list) {
    // Hide the generic injected fallback when EIP-6963 wallets announced themselves.
    if (c.id === "injected" && announced.length > 0) continue;
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.sort((a, b) => Number(b.type === "injected") - Number(a.type === "injected"));
}

function connectorLabel(c: Connector): { name: string; hint: string } {
  if (c.id === "injected") return { name: "Browser wallet", hint: "Injected" };
  if (c.type === "walletConnect") return { name: "WalletConnect", hint: "Scan with a mobile wallet" };
  if (c.type === "coinbaseWallet") return { name: "Coinbase Wallet", hint: "Extension, mobile or smart wallet" };
  return { name: c.name, hint: "Detected" };
}

function ConnectorGlyph({ c }: { c: Connector }) {
  if (c.icon) {
    // Wallet-provided EIP-6963 icon (a data URI announced by the installed extension).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.icon} alt="" width={32} height={32} className="size-8 rounded-lg" />;
  }
  const bg = c.type === "coinbaseWallet" ? "#1652f0" : c.type === "walletConnect" ? "#3b99fc" : "#273145";
  return (
    <span className="flex size-8 items-center justify-center rounded-lg text-white" style={{ background: bg }}>
      <Wallet className="size-4" aria-hidden="true" />
    </span>
  );
}

export function WalletModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const list = useMemo(() => sortConnectors(connectors), [connectors]);
  const pendingId = isPending ? (variables?.connector as Connector | undefined)?.uid : undefined;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Connect a wallet"
      description={`Vectra runs on ${appChain.name}. Connecting never moves funds.`}
    >
      <ul className="space-y-2">
        {list.map((c) => {
          const { name, hint } = connectorLabel(c);
          const pending = pendingId === c.uid;
          return (
            <li key={c.uid}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => connect({ connector: c, chainId: appChain.id }, { onSuccess: () => onOpenChange(false) })}
                className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-3 disabled:opacity-60"
              >
                <ConnectorGlyph c={c} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{name}</span>
                  <span className="block text-xs text-subtle">{pending ? "Approve in your wallet…" : hint}</span>
                </span>
                {pending ? <Spinner className="text-muted" /> : <ChevronRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{describeError(error)}</p> : null}
      <p className="mt-5 text-xs leading-relaxed text-subtle">
        New to wallets? Install a browser wallet such as MetaMask or Rabby, then refresh this page. Vectra is non-custodial: only you control your funds.
      </p>
    </Dialog>
  );
}
