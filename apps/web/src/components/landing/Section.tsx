import type { ReactNode } from "react";

export function Section({ id, eyebrow, title, intro, children, className = "" }: { id?: string; eyebrow: string; title: ReactNode; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-20 ${className}`}>
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-strong">{eyebrow}</p>
          <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-fg sm:text-[40px]">{title}</h2>
          {intro ? <p className="mt-4 text-[16px] leading-relaxed text-muted">{intro}</p> : null}
        </div>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}
