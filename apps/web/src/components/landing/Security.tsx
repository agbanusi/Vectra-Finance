import { Droplets, Fingerprint, KeyRound, ListOrdered, Lock, ShieldCheck, type LucideIcon } from "lucide-react";
import { Section } from "./Section";

const ITEMS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: KeyRound, title: "Non-custodial", body: "Funds sit in on-chain vaults you can verify. No one — including Vectra — can move your shares." },
  { icon: Lock, title: "Immutable vault logic", body: "Index vaults are deployed from a fixed implementation. Fees and parameters are bounded by hard-coded caps." },
  { icon: ShieldCheck, title: "Governance-approved strategies", body: "Allocation is restricted to adapters and targets on the on-chain registry allowlist. Curation cannot route funds elsewhere." },
  { icon: Droplets, title: "Liquidity buffer", body: "Each index keeps a target share of NAV idle in USDC so most withdrawals settle instantly, in one transaction." },
  { icon: ListOrdered, title: "Fair FIFO queue", body: "Larger exits queue first-in, first-out, are paid at fill-time NAV and never below your floor. Cancel any time." },
  { icon: Fingerprint, title: "Compliance-aware indexes", body: "Restricted indexes enforce allowlists on deposit, withdrawal and transfer — open indexes stay permissionless." },
];

export function Security() {
  return (
    <Section id="security" eyebrow="Security & transparency" title="Built to be verified, not trusted" intro="Every number in the app is read from chain. Every rule that protects depositors is enforced by the contracts." className="border-y border-white/[0.04] bg-bg-raised">
      <ul className="grid gap-px overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((it) => (
          <li key={it.title} className="bg-surface p-6 transition-colors hover:bg-surface-2 sm:p-7">
            <it.icon className="size-5 text-accent-strong" aria-hidden="true" />
            <h3 className="mt-4 text-[15px] font-semibold text-fg">{it.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{it.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
