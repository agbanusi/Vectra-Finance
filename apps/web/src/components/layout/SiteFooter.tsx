import Link from "next/link";
import { config } from "@/lib/config";
import { explorerAddressUrl } from "@/lib/explorer";
import { Logo } from "./Logo";

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const factoryUrl = config.factory ? explorerAddressUrl(config.factory) : null;
  return (
    <footer className="border-t border-border">
      <div className={`mx-auto max-w-[1280px] px-4 sm:px-6 ${compact ? "py-10" : "py-14"}`}>
        {compact ? null : (
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <Logo />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">Diversified, non-custodial index tokens over curated on-chain yield strategies.</p>
            </div>
            <FooterCol title="Product" links={[{ href: "/app", label: "Markets" }, { href: "/app/portfolio", label: "Portfolio" }]} />
            <FooterCol title="Learn" links={[{ href: "/#how", label: "How it works" }, { href: "/#security", label: "Security" }, { href: "/#faq", label: "FAQ" }]} />
            <FooterCol title="Contracts" links={factoryUrl ? [{ href: factoryUrl, label: "Index factory", external: true }] : []} />
          </div>
        )}
        <div className={compact ? "" : "mt-12 border-t border-border pt-8"}>
          <p className="max-w-4xl text-xs leading-relaxed text-subtle">
            <span className="font-medium text-muted">Risk disclosure.</span> Vectra index tokens are experimental software that interacts with third-party smart contracts. The value of an index can go down as well as up and you may lose some or all of what you deposit. Underlying vaults can suffer exploits, oracle failures or illiquidity, and real-world-asset strategies add off-chain counterparty and legal risk. Redemptions can be delayed by liquidity, pauses or emergency shutdown. Realised APY is historical and never a promise of future returns. Nothing here is investment, legal or tax advice.
            {config.isTestnet ? (
              <>
                {" "}
                <span className="font-medium text-muted">Testnet.</span> This deployment uses test tokens and yield-emulating strategy vaults. Strategy names such as &ldquo;Gauntlet-style&rdquo; or &ldquo;Edge-style&rdquo; describe an allocation style only; Vectra is not affiliated with or endorsed by those teams.
              </>
            ) : null}
          </p>
          <p className="mt-4 text-xs text-subtle">© {new Date().getFullYear()} Vectra Finance</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string; external?: boolean }[] }) {
  if (links.length === 0) return <div />;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            {l.external ? (
              <a href={l.href} target="_blank" rel="noreferrer" className="text-muted transition-colors hover:text-fg">{l.label}</a>
            ) : (
              <Link href={l.href} className="text-muted transition-colors hover:text-fg">{l.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
