"use client";

import * as RTabs from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export const Tabs = RTabs.Root;
export const TabsContent = RTabs.Content;

/** Underlined page-level tabs. */
export function TabsList({ className, ...rest }: ComponentPropsWithoutRef<typeof RTabs.List>) {
  return <RTabs.List className={cn("scrollbar-none flex gap-6 overflow-x-auto border-b border-border", className)} {...rest} />;
}

export function TabsTrigger({ className, ...rest }: ComponentPropsWithoutRef<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        "relative -mb-px whitespace-nowrap border-b-2 border-transparent pb-3 pt-1 text-sm font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent-strong data-[state=active]:text-fg",
        className,
      )}
      {...rest}
    />
  );
}

/** Pill-style segmented tabs (used in the action card). */
export function SegmentedList({ className, ...rest }: ComponentPropsWithoutRef<typeof RTabs.List>) {
  return <RTabs.List className={cn("grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-bg p-1 ring-1 ring-inset ring-border", className)} {...rest} />;
}

export function SegmentedTrigger({ className, ...rest }: ComponentPropsWithoutRef<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        "h-9 rounded-[9px] text-sm font-medium text-muted transition-all hover:text-fg data-[state=active]:bg-surface-3 data-[state=active]:text-fg data-[state=active]:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_2px_rgb(0_0_0/0.5)]",
        className,
      )}
      {...rest}
    />
  );
}
