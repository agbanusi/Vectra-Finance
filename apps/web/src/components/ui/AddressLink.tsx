"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { explorerAddressUrl, shortAddress } from "@/lib/explorer";
import { cn } from "./cn";

export function CopyButton({ text, label = "Copy address", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable (insecure context); nothing to do.
    }
  };
  return (
    <button type="button" onClick={copy} aria-label={copied ? "Copied" : label} className={cn("inline-flex size-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-3 hover:text-fg", className)}>
      {copied ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

/** Short address with copy + explorer link. */
export function AddressLink({ address, label, copy = true, className }: { address: string; label?: string; copy?: boolean; className?: string }) {
  const url = explorerAddressUrl(address);
  const text = label ?? shortAddress(address);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title={address} className="group inline-flex items-center gap-1 font-mono text-[13px] text-muted transition-colors hover:text-accent-strong">
          {text}
          <ExternalLink className="size-3 opacity-60 group-hover:opacity-100" aria-hidden="true" />
          <span className="sr-only">(opens explorer)</span>
        </a>
      ) : (
        <span title={address} className="font-mono text-[13px] text-muted">{text}</span>
      )}
      {copy ? <CopyButton text={address} /> : null}
    </span>
  );
}
