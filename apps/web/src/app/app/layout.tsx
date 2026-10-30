import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-20 pt-8 sm:px-6 sm:pt-10">{children}</main>
      <SiteFooter compact />
    </div>
  );
}
