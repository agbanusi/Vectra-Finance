import { Lock } from "lucide-react";
import { shortAddress } from "@/lib/explorer";
import { AddressLink } from "../ui/AddressLink";

/** Shown instead of the deposit form when a restricted index rejects the connected wallet. */
export function EligibilityGate({ account, module }: { account: string; module: string }) {
  return (
    <div className="flex flex-col items-center px-2 py-6 text-center" data-testid="eligibility-gate">
      <div className="relative">
        <div aria-hidden="true" className="absolute inset-0 -z-10 scale-150 rounded-full bg-warning/10 blur-xl" />
        <div className="flex size-14 items-center justify-center rounded-2xl border border-warning/30 bg-warning/10 text-warning">
          <Lock className="size-6" aria-hidden="true" />
        </div>
      </div>
      <h3 className="mt-5 text-base font-semibold text-fg">Allowlisted wallets only</h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
        This index holds real-world-asset strategies and enforces an on-chain allowlist. Wallet <span className="tabular font-mono text-fg">{shortAddress(account)}</span> is not on it, so deposits are disabled.
      </p>
      <div className="mt-5 w-full space-y-2 rounded-xl border border-border bg-surface-2 p-3.5 text-left text-[13px]">
        <p className="font-medium text-fg">How access works</p>
        <ul className="space-y-1.5 text-muted">
          <li>Eligibility is attested by the index&apos;s compliance provider and checked on every deposit, withdrawal and transfer.</li>
          <li className="flex flex-wrap items-center gap-1">Compliance module: <AddressLink address={module} /></li>
        </ul>
      </div>
      <p className="mt-4 text-xs text-subtle">You can still browse composition, performance and risk details.</p>
    </div>
  );
}
