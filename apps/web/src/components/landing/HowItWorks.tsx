import { ArrowDownToLine, Coins, Network, Timer, type LucideIcon } from "lucide-react";
import { Section } from "./Section";

const STEPS: { icon: LucideIcon; title: string; body: string; detail: string[] }[] = [
  { icon: ArrowDownToLine, title: "Deposit USDC", body: "Choose an index and deposit in one transaction. Exact-amount approvals, slippage-protected mint.", detail: ["No deposit fee", "Simulated before you sign"] },
  { icon: Network, title: "Diversified allocation", body: "Capital is routed by target weight into governance-approved Morpho, Euler, ERC-4626 and RWA strategies.", detail: ["Keeper rebalancing", "Drift tolerance on-chain"] },
  { icon: Coins, title: "Hold one token", body: "You receive an 18-decimal ERC-20 whose price per share tracks the basket's net asset value.", detail: ["Transferable", "Realised APY = share-price growth"] },
  { icon: Timer, title: "Exit instantly or queue", body: "Withdraw instantly from the liquidity buffer, or join a fair FIFO queue paid at fill-time NAV above your floor.", detail: ["Cancel any time", "Floor-protected payout"] },
];

function Flow() {
  // Allocation diagram: deposit → vault (buffer + strategies) → one token.
  return (
    <div aria-hidden="true" className="surface-card relative hidden overflow-hidden rounded-[var(--radius-2xl)] p-8 lg:block">
      <div className="grid grid-cols-[1fr_auto_1.3fr_auto_1fr] items-center gap-4">
        <div className="rounded-2xl border border-border-strong bg-surface-2 p-5 text-center">
          <p className="text-xs text-subtle">You deposit</p>
          <p className="mt-1 text-lg font-semibold text-fg">USDC</p>
        </div>
        <Connector />
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.06] p-5">
          <p className="text-center text-xs font-medium text-accent-strong">Index vault</p>
          <div className="mt-4 space-y-2">
            {[
              { l: "Morpho-type vaults", w: "46%", c: "var(--color-cat-1)" },
              { l: "Euler-type market", w: "30%", c: "var(--color-cat-2)" },
              { l: "RWA / T-bills", w: "14%", c: "var(--color-cat-4)" },
              { l: "Liquidity buffer", w: "10%", c: "#3a4458" },
            ].map((r) => (
              <div key={r.l} className="flex items-center gap-3 text-xs">
                <span className="w-32 shrink-0 text-muted">{r.l}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full" style={{ width: r.w, background: r.c }} /></span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-[11px] text-subtle">Illustrative weights</p>
        </div>
        <Connector />
        <div className="rounded-2xl border border-border-strong bg-surface-2 p-5 text-center">
          <p className="text-xs text-subtle">You hold</p>
          <p className="mt-1 text-lg font-semibold text-fg">1 index token</p>
          <p className="mt-1 text-[11px] text-subtle">Instant or queued exit</p>
        </div>
      </div>
    </div>
  );
}

function Connector() {
  return (
    <svg width="56" height="12" viewBox="0 0 56 12" fill="none">
      <path d="M0 6h50" stroke="url(#c)" strokeWidth="1.5" strokeDasharray="3 4" />
      <path d="M48 1l6 5-6 5" stroke="#8eabff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="c" x1="0" x2="56" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#273145" /><stop offset="1" stopColor="#8eabff" /></linearGradient>
      </defs>
    </svg>
  );
}

export function HowItWorks() {
  return (
    <Section id="how" eyebrow="How it works" title="From one deposit to a diversified portfolio" intro="Every index is an ERC-20 vault with a USDC buffer and positions in vetted ERC-4626 strategies. You never manage the positions — you hold the token.">
      <Flow />
      <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="surface-card relative flex flex-col rounded-[var(--radius-xl)] p-5">
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-xl border border-border-strong bg-surface-2 text-accent-strong"><s.icon className="size-5" aria-hidden="true" /></span>
              <span className="tabular text-xs font-semibold text-subtle">0{i + 1}</span>
            </div>
            <h3 className="mt-5 text-[15px] font-semibold text-fg">{s.title}</h3>
            <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted">{s.body}</p>
            <ul className="mt-4 space-y-1 border-t border-border pt-3">
              {s.detail.map((d) => <li key={d} className="flex items-center gap-2 text-xs text-subtle"><span aria-hidden="true" className="size-1 rounded-full bg-accent-strong" />{d}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </Section>
  );
}
