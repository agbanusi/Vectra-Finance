import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("skeleton block rounded-md", className ?? "h-4 w-full")} />;
}
