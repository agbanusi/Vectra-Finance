import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted ring-border-strong",
  accent: "bg-accent-soft text-accent-strong ring-accent/30",
  success: "bg-success/10 text-success ring-success/25",
  warning: "bg-warning/10 text-warning ring-warning/25",
  danger: "bg-danger/10 text-danger ring-danger/25",
  info: "bg-info/10 text-info ring-info/25",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-subtle",
  accent: "bg-accent-strong",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({ tone = "neutral", icon, dot, children, className, title }: { tone?: Tone; icon?: ReactNode; dot?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>
      {dot ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[tone])} /> : null}
      {icon ? <span aria-hidden="true" className="-ml-0.5 [&>svg]:size-3.5">{icon}</span> : null}
      {children}
    </span>
  );
}

/** Low-key tag for metadata (protocols, categories). */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border border-border bg-surface-2 px-2 text-xs text-muted", className)}>{children}</span>;
}
