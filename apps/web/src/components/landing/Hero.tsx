import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { config } from "@/lib/config";
import { networkLabel } from "@/lib/chain";
import { HeroCard, LiveStats } from "./LiveData";

export function Hero() {
  return (
    <section className="noise relative overflow-hidden border-b border-white/[0.04]">
      <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="pointer-events-none absolute -top-56 left-1/2 h-[620px] w-[1100px] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgba(61,107,255,0.28),rgba(61,107,255,0.06)_55%,transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-[-10%] top-40 h-[380px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(99,213,255,0.12),transparent)]" />
      <div className="relative mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:pb-28">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1.5 pr-3 text-xs text-muted backdrop-blur">
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent-strong">{config.isTestnet ? "Testnet" : "Live"}</span>
            Now running on {networkLabel}
          </span>
          <h1 className="text-gradient mt-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[54px] lg:text-[58px]">
            One token.
            <br />
            <span className="text-accent-gradient">Diversified on-chain yield.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted">
            Deposit USDC once. Vectra spreads it across governance-approved lending and real-world-asset vaults, keeps a liquidity buffer for instant exits, and gives you a single ERC-20 that tracks the basket&apos;s net asset value.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/app" className="group inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-[15px] font-semibold text-accent-fg shadow-[var(--shadow-glow)] transition-colors hover:bg-accent-hover">
              Launch app
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <a href="#how" className="inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong bg-white/[0.02] px-6 text-[15px] font-medium text-fg transition-colors hover:bg-white/[0.05]">
              How it works
              <ArrowUpRight className="size-4 text-subtle" aria-hidden="true" />
            </a>
          </div>
          <LiveStats />
        </div>
        <div className="animate-fade-up [animation-delay:120ms]">
          <HeroCard />
        </div>
      </div>
    </section>
  );
}
