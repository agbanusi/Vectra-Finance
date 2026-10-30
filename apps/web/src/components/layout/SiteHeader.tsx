import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "./Logo";
import { NetworkPill } from "./NetworkPill";

const LINKS = [
  { href: "#indexes", label: "Indexes" },
  { href: "#how", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#faq", label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.04] bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-7 text-sm text-muted lg:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-fg">{l.label}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden sm:inline-flex"><NetworkPill /></span>
          <Link href="/app" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-fg px-4 text-sm font-semibold text-bg transition-colors hover:bg-white">
            Launch app
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
