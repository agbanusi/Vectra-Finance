"use client";

import * as RT from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export const TooltipProvider = RT.Provider;

export function Tooltip({ content, children, side = "top", className }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  if (content === null || content === undefined || content === "") return <>{children}</>;
  return (
    <RT.Root delayDuration={120}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            "z-50 max-w-[280px] animate-fade-in rounded-lg border border-border-strong bg-surface-3 px-3 py-2 text-xs leading-relaxed text-fg shadow-[var(--shadow-pop)]",
            className,
          )}
        >
          {content}
          <RT.Arrow className="fill-surface-3" width={10} height={5} />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

/** A small (i) icon with an explanatory tooltip. Keyboard focusable. */
export function InfoTip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip content={children}>
      <button type="button" aria-label={label} className="inline-flex size-4 items-center justify-center rounded-full text-subtle transition-colors hover:text-fg">
        <Info className="size-3.5" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
