import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ADAPTER_KIND_HASH } from "@vectra/sdk";
import { DEFAULT_FILTERS, filterMarkets, indexProtocols, sortMarkets, type MarketRow } from "@/lib/filters";
import { bestApy, weightedApy } from "@/lib/stats";
import type { IndexView } from "@/lib/types";

function view(p: Partial<IndexView>): IndexView {
  return {
    vault: "0x0000000000000000000000000000000000000001", name: "Index", symbol: "IDX", baseAsset: "0x0000000000000000000000000000000000000002", baseDecimals: 6,
    curator: "0x0000000000000000000000000000000000000003", compliancePolicy: "permissionless", complianceModule: "0x0000000000000000000000000000000000000004",
    totalSupply: 0n, nav: 0n, navHealthy: true, pricePerShare: 1_000_000n, baseBalance: 0n, reservedShares: 0n, reservedAssets: 0n, availableLiquidity: 0n,
    liquidBufferBps: 1000, weightToleranceBps: 500, managementFeeBps: 100, performanceFeeBps: 1000, minDeposit: 1n, minRedeem: 1n, redemptionTtl: 86400n,
    pendingRequests: 0, maxQueueLength: 100, headRequestId: 0n, nextRequestId: 0n, partialFillsEnabled: true, depositsPaused: false, redemptionsPaused: false,
    shutdown: false, configVersion: 1n, adapters: [], ...p,
  } as IndexView;
}

const rows: MarketRow[] = [
  { index: view({ name: "Edge", symbol: "EDGE-INDEX", nav: 300n, availableLiquidity: 30n }), curator: "Edge-style", category: "Lending", apy: 0.05 },
  { index: view({ name: "Safe", symbol: "vSAFE", nav: 500n, availableLiquidity: 100n }), curator: "Vectra", category: "Conservative", apy: null },
  { index: view({ name: "RWA", symbol: "RWA-INDEX", nav: 100n, availableLiquidity: 5n, compliancePolicy: "allowlist" }), curator: "Vectra", category: "RWA", apy: 0.09 },
];

describe("market filters", () => {
  it("filters by curator, category, access and search", () => {
    expect(filterMarkets(rows, { ...DEFAULT_FILTERS, curator: "Vectra" }).map((r) => r.index.symbol)).toEqual(["vSAFE", "RWA-INDEX"]);
    expect(filterMarkets(rows, { ...DEFAULT_FILTERS, category: "Lending" })).toHaveLength(1);
    expect(filterMarkets(rows, { ...DEFAULT_FILTERS, access: "restricted" }).map((r) => r.index.symbol)).toEqual(["RWA-INDEX"]);
    expect(filterMarkets(rows, { ...DEFAULT_FILTERS, access: "permissionless" })).toHaveLength(2);
    expect(filterMarkets(rows, { ...DEFAULT_FILTERS, search: "safe" }).map((r) => r.index.symbol)).toEqual(["vSAFE"]);
  });
});

describe("market sorting", () => {
  it("sorts by TVL both ways", () => {
    expect(sortMarkets(rows, "tvl", "desc").map((r) => r.index.name)).toEqual(["Safe", "Edge", "RWA"]);
    expect(sortMarkets(rows, "tvl", "asc").map((r) => r.index.name)).toEqual(["RWA", "Edge", "Safe"]);
  });
  it("sorts by APY with unknown APY always last", () => {
    expect(sortMarkets(rows, "apy", "desc").map((r) => r.index.name)).toEqual(["RWA", "Edge", "Safe"]);
    expect(sortMarkets(rows, "apy", "asc").map((r) => r.index.name)).toEqual(["Edge", "RWA", "Safe"]);
  });
  it("sorts by buffer ratio and name", () => {
    expect(sortMarkets(rows, "buffer", "desc").map((r) => r.index.name)).toEqual(["Safe", "Edge", "RWA"]);
    expect(sortMarkets(rows, "name", "asc").map((r) => r.index.name)).toEqual(["Edge", "RWA", "Safe"]);
  });
});

describe("stats", () => {
  it("weights APY by NAV and ignores unknowns", () => {
    expect(weightedApy([{ nav: 300n, apy: 0.05 }, { nav: 100n, apy: 0.09 }, { nav: 500n, apy: null }])).toBeCloseTo(0.06, 10);
    expect(weightedApy([{ nav: 1n, apy: null }])).toBeNull();
    expect(bestApy(rows)?.index.name).toBe("RWA");
  });
  it("lists distinct protocols", () => {
    const a = { adapter: "0x1", kind: ADAPTER_KIND_HASH.MORPHO, target: "0x2", targetBps: 5000, enabled: true, quarantined: false, healthy: true, valuationOk: true, totalAssets: 0n, maxDeposit: 0n, maxWithdraw: 0n, targetAssets: 0n };
    const v = view({ adapters: [a, { ...a, adapter: "0x3" }, { ...a, kind: ADAPTER_KIND_HASH.EULER }] as IndexView["adapters"] });
    expect(indexProtocols(v)).toEqual(["Morpho", "Euler"]);
  });
});

vi.mock("wagmi", async (orig) => {
  const actual = await orig<typeof import("wagmi")>();
  return { ...actual, useAccount: () => ({ address: "0x00000000000000000000000000000000000000aa" }) };
});
vi.mock("@/hooks/useFaucet", async (orig) => {
  const actual = await orig<typeof import("@/hooks/useFaucet")>();
  return { ...actual, useFaucet: () => ({ mint: vi.fn(), tx: { state: { phase: "idle" } }, enabled: true }) };
});

describe("FaucetButton", () => {
  it("renders only on testnet deployments with a base asset", async () => {
    const { FaucetButton } = await import("@/components/index/FaucetButton");
    const { faucetAvailable } = await import("@/hooks/useFaucet");
    expect(faucetAvailable({ isTestnet: true, baseAsset: "0x0000000000000000000000000000000000000005" })).toBe(true);
    expect(faucetAvailable({ isTestnet: false, baseAsset: "0x0000000000000000000000000000000000000005" })).toBe(false);
    expect(faucetAvailable({ isTestnet: true, baseAsset: null })).toBe(false);
    const { unmount } = render(<FaucetButton cfg={{ isTestnet: true, baseAsset: "0x0000000000000000000000000000000000000005" }} />);
    expect(await screen.findByRole("button", { name: /Get 10,000 tUSDC/ })).toBeInTheDocument();
    unmount();
    render(<FaucetButton cfg={{ isTestnet: false, baseAsset: "0x0000000000000000000000000000000000000005" }} />);
    expect(screen.queryByRole("button", { name: /Get 10,000/ })).not.toBeInTheDocument();
  });
});

describe("EligibilityGate", () => {
  it("explains allowlisting instead of showing a deposit form", async () => {
    const { EligibilityGate } = await import("@/components/index/EligibilityGate");
    const { TooltipProvider } = await import("@/components/ui/Tooltip");
    render(<TooltipProvider><EligibilityGate account="0x00000000000000000000000000000000000000aa" module="0x0000000000000000000000000000000000000004" /></TooltipProvider>);
    expect(screen.getByText("Allowlisted wallets only")).toBeInTheDocument();
    expect(screen.getByText(/not on it, so deposits are disabled/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deposit/ })).not.toBeInTheDocument();
  });
});
