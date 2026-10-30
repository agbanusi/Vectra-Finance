"use client";

import * as RP from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { cn } from "./cn";

export function Popover({ trigger, children, align = "end", className }: { trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end"; className?: string }) {
  return (
    <RP.Root>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className={cn("z-50 w-72 animate-fade-in rounded-xl bg-surface-2 p-4 text-sm shadow-[var(--shadow-pop)] focus:outline-none", className)}
        >
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
