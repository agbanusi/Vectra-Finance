"use client";

import * as RA from "@radix-ui/react-accordion";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

export function Accordion({ items }: { items: readonly { q: string; a: ReactNode }[] }) {
  return (
    <RA.Root type="single" collapsible className="divide-y divide-border rounded-[var(--radius-xl)] border border-border bg-surface">
      {items.map((item, i) => (
        <RA.Item key={item.q} value={`item-${i}`} className="group">
          <RA.Header>
            <RA.Trigger className="flex w-full items-center justify-between gap-6 px-5 py-5 text-left text-[15px] font-medium text-fg transition-colors hover:text-accent-strong sm:px-6">
              {item.q}
              <Plus aria-hidden="true" className="size-4 shrink-0 text-subtle transition-transform duration-200 group-data-[state=open]:rotate-45" />
            </RA.Trigger>
          </RA.Header>
          <RA.Content className="overflow-hidden px-5 pb-5 text-sm leading-relaxed text-muted sm:px-6">{item.a}</RA.Content>
        </RA.Item>
      ))}
    </RA.Root>
  );
}
