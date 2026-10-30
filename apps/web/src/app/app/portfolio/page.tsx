"use client";

import { isOpenRequest, type RequestStatus } from "@vectra/sdk";
import { ArrowRight, Briefcase, Inbox, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { ActivityList } from "@/components/index/ActivityList";
import { FaucetButton } from "@/components/index/FaucetButton";
import { RequestsList } from "@/components/index/RequestsList";
import { ApyCell } from "@/components/markets/ApyCell";
import { IndexIdentity } from "@/components/markets/IndexIdentity";
import { StatStrip } from "@/components/markets/StatStrip";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Value } from "@/components/ui/Value";
import { WalletModal } from "@/components/wallet/WalletModal";
import { useWalletActivity } from "@/hooks/useActivity";
import { useMarkets, type Market } from "@/hooks/useMarkets";
import { useMounted } from "@/hooks/useMounted";
import { useMyRequestsAcross, type RequestRow } from "@/hooks/useRequests";
import { useTokenSymbol } from "@/hooks/useToken";
import { useUserPositions } from "@/hooks/useUser";
import { config } from "@/lib/config";
import { formatPct, formatShares } from "@/lib/format";

export default function PortfolioPage() {
  const mounted = useMounted();
  const { address } = useAccount();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-fg sm:text-[32px]">Portfolio</h1>
          <p className="mt-2 text-[15px] text-muted">Your index positions, withdrawal requests and history — read live from chain.</p>
        </div>
        {mounted && address && config.isTestnet ? <FaucetButton /> : null}
      </header>
      {!mounted ? (
        <Skeleton className="h-28 w-full rounded-2xl" />
      ) : !address ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="Connect a wallet to see your portfolio"
            action={<Button onClick={() => setOpen(true)}><Wallet className="size-4" aria-hidden="true" />Connect wallet</Button>}
          >
            Positions, pending withdrawals and activity appear here once connected.
          </EmptyState>
          <WalletModal open={open} onOpenChange={setOpen} />
        </Card>
      ) : (
        <Connected />
      )}
    </div>
  );
}

function Connected() {
  const { address } = useAccount();
  const { markets, isLoading, error } = useMarkets();
  const positions = useUserPositions(markets.map((m) => m.index.vault));
  const symbol = useTokenSymbol(markets[0]?.index.baseAsset ?? config.baseAsset ?? undefined);
  const decimals = markets[0]?.index.baseDecimals ?? 6;
  const baseBalance = useReadContract({ address: config.baseAsset ?? undefined, abi: erc20Abi, functionName: "balanceOf", args: [address!], query: { enabled: Boolean(config.baseAsset && address), refetchInterval: 20_000 } });

  const held = useMemo(
    () =>
      markets
        .map((m, i) => {
          const r = positions.data?.[i];
          return { m, p: r?.status === "success" ? r.result : undefined };
        })
        .filter((x): x is { m: Market; p: NonNullable<typeof x.p> } => Boolean(x.p && x.p.shares > 0n))
        .sort((a, b) => (a.p.value === b.p.value ? 0 : a.p.value > b.p.value ? -1 : 1)),
    [markets, positions.data],
  );
  const total = held.reduce((s, x) => s + x.p.value, 0n);
  const requests = useMyRequestsAcross(markets.map((m) => m.index), address);
  const openRequests = [...requests.byVault.values()].flat().filter((r) => isOpenRequest(r.status as RequestStatus));

  if (error) return <ErrorState title="Could not load indexes" detail={error.message.split("\n")[0]} />;
  const loading = isLoading || positions.isLoading;

  return (
    <>
      <StatStrip
        items={[
          { label: "Total value", value: <Value value={total} decimals={decimals} symbol={symbol} />, sub: "At current NAV", loading },
          { label: "Positions", value: held.length, sub: `of ${markets.length} indexes`, loading },
          { label: "Pending withdrawals", value: openRequests.length, sub: openRequests.length ? `${formatShares(openRequests.reduce((s, r) => s + r.shares, 0n), 2)} shares escrowed` : "No open requests", loading: loading || requests.isLoading },
          { label: `Wallet ${symbol}`, value: baseBalance.data !== undefined ? <Value value={baseBalance.data} decimals={decimals} symbol={symbol} /> : "—", sub: "Available to deposit", loading: baseBalance.isLoading },
        ]}
      />

      <Card>
        <CardHeader title="Positions" />
        <div className="mt-4 border-t border-border">
          {loading ? (
            <div className="space-y-3 p-5"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : held.length === 0 ? (
            <EmptyState icon={Briefcase} title="No positions yet" action={<Link href="/app"><Button size="sm" variant="secondary">Explore markets <ArrowRight className="size-4" aria-hidden="true" /></Button></Link>}>
              Deposit into an index to start earning diversified yield.
            </EmptyState>
          ) : (
            <PositionsTable held={held} total={total} symbol={symbol} />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Withdrawal requests" description="Queued withdrawals across all indexes, with live status." />
        <div className="mt-3 border-t border-border">
          <AllRequests markets={markets} byVault={requests.byVault} loading={requests.isLoading} symbol={symbol} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Activity" />
        <div className="mt-3 border-t border-border">
          <WalletHistory markets={markets} symbol={symbol} decimals={decimals} />
        </div>
      </Card>
    </>
  );
}

function PositionsTable({ held, total, symbol }: { held: { m: Market; p: { shares: bigint; value: bigint } }[]; total: bigint; symbol: string }) {
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <caption className="sr-only">Your positions</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-subtle">
            <th scope="col" className="h-10 pl-6 pr-3 font-medium">Index</th>
            <th scope="col" className="px-3 text-right font-medium">Shares</th>
            <th scope="col" className="px-3 text-right font-medium">Value</th>
            <th scope="col" className="px-3 text-right font-medium">Allocation</th>
            <th scope="col" className="pl-3 pr-6 text-right font-medium">Realised APY</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {held.map(({ m, p }) => {
            const weight = total > 0n ? Number((p.value * 10_000n) / total) / 10_000 : 0;
            return (
              <tr key={m.index.vault} className="transition-colors hover:bg-white/[0.015]">
                <td className="py-3.5 pl-6 pr-3"><Link href={`/app/index/${m.index.vault}`} className="block rounded-lg"><IndexIdentity index={m.index} meta={m.meta} size={32} /></Link></td>
                <td className="tabular px-3 text-right text-muted">{formatShares(p.shares, 4)}</td>
                <td className="px-3 text-right font-medium text-fg"><Value value={p.value} decimals={m.index.baseDecimals} symbol={symbol} /></td>
                <td className="px-3 text-right">
                  <span className="tabular text-fg">{formatPct(weight)}</span>
                  <span className="ml-auto mt-1 block h-1 w-16 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-accent-strong" style={{ width: `${weight * 100}%` }} /></span>
                </td>
                <td className="pl-3 pr-6 text-right"><ApyCell apy={m.apy} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="divide-y divide-border md:hidden">
        {held.map(({ m, p }) => (
          <li key={m.index.vault}>
            <Link href={`/app/index/${m.index.vault}`} className="flex items-center justify-between gap-3 px-5 py-4">
              <IndexIdentity index={m.index} meta={m.meta} size={32} />
              <div className="text-right">
                <p className="text-sm font-medium text-fg"><Value value={p.value} decimals={m.index.baseDecimals} symbol={symbol} /></p>
                <p className="tabular text-xs text-subtle">{formatShares(p.shares, 2)} sh</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function AllRequests({ markets, byVault, loading, symbol }: { markets: readonly Market[]; byVault: Map<string, RequestRow[]>; loading: boolean; symbol: string }) {
  if (loading) return <div className="space-y-3 p-5"><Skeleton className="h-20 w-full" /></div>;
  const groups = markets.map((m) => ({ m, rows: byVault.get(m.index.vault.toLowerCase()) ?? [] })).filter((g) => g.rows.length > 0);
  if (groups.length === 0) return <EmptyState icon={Inbox} title="No withdrawal requests">Queued withdrawals appear here with their live status and timeline.</EmptyState>;
  return (
    <div>
      {groups.map(({ m, rows }) => (
        <section key={m.index.vault} className="border-b border-border last:border-b-0">
          <div className="flex items-center gap-2 bg-white/[0.012] px-5 py-2.5 sm:px-6">
            <Link href={`/app/index/${m.index.vault}`} className="text-xs font-semibold text-muted hover:text-fg">{m.index.name}</Link>
          </div>
          <RequestsList vault={m.index.vault} rows={rows} decimals={m.index.baseDecimals} symbol={symbol} indexSymbol={m.index.symbol} />
        </section>
      ))}
    </div>
  );
}

function WalletHistory({ markets, symbol, decimals }: { markets: readonly Market[]; symbol: string; decimals: number }) {
  const { address } = useAccount();
  const q = useWalletActivity(address, markets.map((m) => m.index.vault));
  const byVault = new Map(markets.map((m) => [m.index.vault.toLowerCase(), m.index.symbol]));
  return <ActivityList query={q} decimals={decimals} symbol={symbol} indexLabel={(v) => (v ? (byVault.get(v.toLowerCase()) ?? null) : null)} emptyText="No activity in the scanned range" />;
}
