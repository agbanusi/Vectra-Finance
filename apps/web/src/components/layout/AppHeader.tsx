"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "../wallet/WalletButton";
import { WrongNetworkBanner } from "../wallet/WrongNetworkBanner";
import { cn } from "../ui/cn";
import { Logo } from "./Logo";
import { NetworkPill } from "./NetworkPill";

const LINKS = [
  { href: "/app", label: "Markets" },
  { href: "/app/portfolio", label: "Portfolio" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" || pathname.startsWith("/app/index") : pathname.startsWith(href);
}

export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-4 sm:px-6">
        <Logo href="/" />
        <nav aria-label="App" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <NavLink key={l.href} href={l.href} active={isActive(pathname, l.href)}>{l.label}</NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden sm:inline-flex"><NetworkPill /></span>
          <WalletButton />
        </div>
      </div>
      <nav aria-label="App (mobile)" className="flex gap-1 border-t border-border/60 px-3 py-1.5 md:hidden">
        {LINKS.map((l) => (
          <NavLink key={l.href} href={l.href} active={isActive(pathname, l.href)}>{l.label}</NavLink>
        ))}
        <span className="ml-auto"><NetworkPill /></span>
      </nav>
      <WrongNetworkBanner />
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg")}
    >
      {children}
    </Link>
  );
}
