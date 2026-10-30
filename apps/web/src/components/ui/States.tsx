import { AlertTriangle, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon ? (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border-strong bg-surface-2 text-muted">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      ) : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <div className="mt-1.5 max-w-sm text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-danger/30 bg-danger/[0.06] px-4 py-3.5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{title}</p>
        {detail ? <p className="mt-0.5 break-words text-muted">{detail}</p> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

type NoticeTone = "info" | "warning" | "danger" | "success";
const NOTICE: Record<NoticeTone, string> = {
  info: "border-info/25 bg-info/[0.06] [&_svg]:text-info",
  warning: "border-warning/30 bg-warning/[0.07] [&_svg]:text-warning",
  danger: "border-danger/30 bg-danger/[0.07] [&_svg]:text-danger",
  success: "border-success/30 bg-success/[0.07] [&_svg]:text-success",
};

export function Notice({ tone = "info", icon: Icon = tone === "info" ? Info : AlertTriangle, title, children, className }: { tone?: NoticeTone; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3 rounded-[var(--radius-lg)] border px-3.5 py-3 text-[13px] leading-relaxed", NOTICE[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-muted">
        {title ? <p className="font-medium text-fg">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
