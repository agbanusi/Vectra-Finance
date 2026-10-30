import { networkLabel } from "@/lib/chain";
import { config } from "@/lib/config";
import { Tooltip } from "../ui/Tooltip";

/** Header network indicator. Only the local chain carries an explicit "mock assets" label. */
export function NetworkPill() {
  const detail = config.isMock
    ? "Local anvil chain with mock assets. Nothing here has real value."
    : config.isTestnet
      ? `Connected to ${networkLabel} testnet (chain ${config.chainId}). Assets are test tokens with no value.`
      : `Chain ${config.chainId}`;
  return (
    <Tooltip content={detail} side="bottom">
      <span tabIndex={0} className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-xs font-medium text-muted">
        <span aria-hidden="true" className="size-1.5 animate-pulse-dot rounded-full bg-success" />
        {networkLabel}
        {config.isMock ? <span className="rounded bg-warning/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-warning">mock assets</span> : null}
      </span>
    </Tooltip>
  );
}
