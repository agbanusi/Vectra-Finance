import Link from "next/link";
import { cn } from "../ui/cn";

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="vx-a" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9db6ff" />
          <stop offset="1" stopColor="#3d6bff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#0e1420" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" stroke="white" strokeOpacity="0.1" />
      <path d="M8 9.5 16 23l8-13.5" stroke="url(#vx-a)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 9.5 16 15.5l3.5-6" stroke="#63d5ff" strokeOpacity="0.9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} aria-label="Vectra home" className={cn("flex items-center gap-2.5 rounded-lg text-[17px] font-semibold tracking-tight text-fg", className)}>
      <LogoMark />
      <span>Vectra</span>
    </Link>
  );
}
