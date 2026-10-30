import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function CtaBand() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
      <div className="noise relative overflow-hidden rounded-[28px] border border-accent/25 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(61,107,255,0.28),rgba(11,15,24,0.9)_55%)] px-6 py-14 text-center sm:px-12">
        <h2 className="mx-auto max-w-2xl text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg sm:text-[36px]">Diversify in one transaction.</h2>
        <p className="mx-auto mt-3 max-w-lg text-muted">Compare live indexes by composition, liquidity and realised performance — then decide for yourself.</p>
        <Link href="/app" className="group mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-fg px-6 text-[15px] font-semibold text-bg transition-colors hover:bg-white">
          Explore markets
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
