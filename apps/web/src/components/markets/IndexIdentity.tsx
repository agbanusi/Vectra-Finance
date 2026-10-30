import { Lock } from "lucide-react";
import type { IndexMetadata } from "@/lib/metadata";
import { isPermissionless, type IndexView } from "@/lib/types";
import { TokenIcon } from "../ui/TokenIcon";
import { Tooltip } from "../ui/Tooltip";

export function RestrictedLock({ size = 14 }: { size?: number }) {
  return (
    <Tooltip content="Restricted index: only allowlisted wallets can deposit, redeem or receive transfers.">
      <span tabIndex={0} aria-label="Restricted" className="inline-flex size-5 items-center justify-center rounded-md bg-warning/10 text-warning ring-1 ring-inset ring-warning/25">
        <Lock style={{ width: size - 2, height: size - 2 }} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

export function IndexIdentity({ index: v, meta, size = 36 }: { index: IndexView; meta: IndexMetadata; size?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TokenIcon symbol={v.symbol} seed={v.vault} size={size} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg">{v.name}</span>
          {isPermissionless(v.compliancePolicy) ? null : <RestrictedLock />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
          <span className="truncate font-medium text-muted">{v.symbol}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{meta.curator}</span>
        </div>
      </div>
    </div>
  );
}
