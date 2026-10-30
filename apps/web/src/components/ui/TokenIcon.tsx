import { cn } from "./cn";

const PALETTES: [string, string][] = [
  ["#5b8cff", "#2a4bd6"],
  ["#3dd6c6", "#1a8f9c"],
  ["#b48cff", "#6b3fd6"],
  ["#f5b544", "#d0742a"],
  ["#ff7eb6", "#c23d7d"],
  ["#8bd45d", "#3f9a3a"],
  ["#63d5ff", "#2a7fd6"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

/** Two-letter monogram from a symbol: "GAUNTLET-MORPHO-INDEX" → "GM", "vSAFE" → "SA". */
export function monogram(symbol: string): string {
  const parts = symbol.replace(/-?INDEX$/i, "").split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  const word = (parts[0] ?? symbol).replace(/^v(?=[A-Z])/, "");
  return word.slice(0, 2).toUpperCase();
}

/** Deterministic generated mark for an index token (no third-party logos). */
export function TokenIcon({ symbol, seed, size = 36, className }: { symbol: string; seed?: string; size?: number; className?: string }) {
  const [from, to] = PALETTES[hash(seed ?? symbol) % PALETTES.length] ?? PALETTES[0]!;
  const id = `g-${hash((seed ?? symbol) + symbol).toString(36)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${id})`} />
      <rect x="0.5" y="0.5" width="39" height="39" rx="11.5" fill="none" stroke="white" strokeOpacity="0.18" />
      <path d="M0 26 L40 14 L40 40 L0 40 Z" fill="black" fillOpacity="0.12" />
      <text x="20" y="25.5" textAnchor="middle" fontSize="14" fontWeight="700" fill="white" fontFamily="var(--font-geist-sans), system-ui" letterSpacing="-0.3">
        {monogram(symbol)}
      </text>
    </svg>
  );
}

/** Base-asset mark: a stablecoin glyph. */
export function AssetIcon({ symbol, size = 20, className }: { symbol: string; size?: number; className?: string }) {
  const usd = /usd/i.test(symbol);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cn("shrink-0", className)}>
      <circle cx="12" cy="12" r="12" fill={usd ? "#2f6fe4" : "#4a5568"} />
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="white" fontFamily="system-ui">
        {usd ? "$" : symbol.slice(0, 1).toUpperCase()}
      </text>
    </svg>
  );
}

export const PROTOCOL_COLOR: Record<string, string> = {
  Morpho: "var(--color-cat-1)",
  Euler: "var(--color-cat-2)",
  RWA: "var(--color-cat-4)",
  "ERC-4626": "var(--color-cat-3)",
  Other: "var(--color-subtle)",
  Buffer: "#3a4458",
};

/** Generic glyph per protocol kind (abstract shapes, not brand logos). */
export function ProtocolIcon({ protocol, size = 20, className }: { protocol: string; size?: number; className?: string }) {
  const color = PROTOCOL_COLOR[protocol] ?? PROTOCOL_COLOR.Other;
  return (
    <span
      title={protocol}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full ring-2 ring-surface", className)}
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 22%, #0b0f18)`, color }}
    >
      <svg viewBox="0 0 16 16" width={size * 0.6} height={size * 0.6} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {protocol === "Morpho" ? <path d="M3 12V4l5 5 5-5v8" /> : null}
        {protocol === "Euler" ? <path d="M12 3.5H5v9h7M5 8h5.5" /> : null}
        {protocol === "RWA" ? <path d="M2.5 6.5 8 3l5.5 3.5M4 7v5M8 7v5M12 7v5M2.5 13h11" /> : null}
        {protocol === "ERC-4626" ? <rect x="3.5" y="3.5" width="9" height="9" rx="2" /> : null}
        {!["Morpho", "Euler", "RWA", "ERC-4626"].includes(protocol) ? <circle cx="8" cy="8" r="4" /> : null}
      </svg>
    </span>
  );
}

export function ProtocolStack({ protocols, size = 22 }: { protocols: readonly string[]; size?: number }) {
  return (
    <span className="flex items-center -space-x-1.5" aria-label={protocols.join(", ")}>
      {protocols.map((p) => <ProtocolIcon key={p} protocol={p} size={size} />)}
    </span>
  );
}
