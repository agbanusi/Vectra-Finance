"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={120}>
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: "!bg-surface-2 !border-border-strong !text-fg !rounded-xl !shadow-[var(--shadow-pop)]",
                description: "!text-muted",
                actionButton: "!bg-surface-3 !text-fg",
              },
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
