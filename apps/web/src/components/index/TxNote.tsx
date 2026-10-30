import { ExternalLink } from "lucide-react";
import { explorerTxUrl, shortAddress } from "@/lib/explorer";
import { TX_PHASE_LABEL, type TxState } from "@/lib/tx";
import { cn } from "../ui/cn";

const TONE: Record<TxState["phase"], string> = {
  idle: "",
  simulating: "text-muted",
  "awaiting-signature": "text-info",
  pending: "text-info",
  confirmed: "text-success",
  reverted: "text-danger",
  failed: "text-danger",
};

/** Inline, screen-reader-announced transaction status under an action button. */
export function TxNote({ state }: { state: TxState }) {
  const url = state.hash ? explorerTxUrl(state.hash) : null;
  return (
    <div aria-live="polite" role="status" className={cn("text-center text-xs", TONE[state.phase])}>
      {state.phase === "idle" ? null : (
        <p>
          {TX_PHASE_LABEL[state.phase]}
          {state.error ? <span className="mt-0.5 block break-words text-danger/90">{state.error}</span> : null}
          {state.hash && url ? (
            <a href={url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
              {shortAddress(state.hash)} <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </p>
      )}
    </div>
  );
}
