import { describe, expect, it } from "vitest";
import { buildConfig, LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID } from "@/lib/config";
import { getIndexMetadata } from "@/lib/metadata";
import { checkRedeem } from "@/lib/redeem";

describe("buildConfig", () => {
  it("defaults to Sepolia with the bundled deployment and public RPC", () => {
    const c = buildConfig({});
    expect(c.chainId).toBe(SEPOLIA_CHAIN_ID);
    expect(c.factory).toBe("0x535D143ef9A047e4b2250c711f5CbFd28125e0f7");
    expect(c.lens).not.toBeNull();
    expect(c.rpcUrl).toBe("https://ethereum-sepolia-rpc.publicnode.com");
    expect(c.explorerUrl).toBe("https://sepolia.etherscan.io");
    expect(c.startBlock).toBe(12023081n);
    expect(c.isTestnet).toBe(true);
    expect(c.isMock).toBe(false);
    expect(c.apiUrl).toBeNull();
    expect(Object.keys(c.strategyVaults).length).toBeGreaterThan(0);
  });

  it("keeps the local anvil demo working, labelled as mock", () => {
    const c = buildConfig({ NEXT_PUBLIC_CHAIN_ID: String(LOCAL_CHAIN_ID) });
    expect(c.factory).not.toBeNull();
    expect(c.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(c.isMock).toBe(true);
  });

  it("uses env overrides and has no fallback for unknown chains", () => {
    const c = buildConfig({ NEXT_PUBLIC_CHAIN_ID: "1", NEXT_PUBLIC_API_URL: "http://api/", NEXT_PUBLIC_EXPLORER_URL: "https://etherscan.io/" });
    expect(c.factory).toBeNull();
    expect(c.apiUrl).toBe("http://api");
    expect(c.explorerUrl).toBe("https://etherscan.io");
    expect(c.isTestnet).toBe(false);
  });
});

describe("index metadata", () => {
  it("resolves by chain:address, then symbol, then default, merging API fields", () => {
    expect(getIndexMetadata(SEPOLIA_CHAIN_ID, "0x8D70694a167cE9130efE905c3C8374fB4e7E4E4F", "?").curator).toBe("Gauntlet-style");
    expect(getIndexMetadata(1, "0x0000000000000000000000000000000000000001", "vSAFE").riskTier).toBe("low");
    expect(getIndexMetadata(1, "0x0000000000000000000000000000000000000001", "NEW").curator).toBe("Independent");
    const merged = getIndexMetadata(SEPOLIA_CHAIN_ID, "0xB2511e0d41ac26867fbe7Ad804A89552F3956FB1", "EDGE-INDEX", { riskTier: "high", description: "API text", tags: [] });
    expect(merged.riskTier).toBe("high");
    expect(merged.description).toBe("API text");
    expect(merged.tags.length).toBeGreaterThan(0);
  });

  it("never phrases testnet curators as endorsements", () => {
    for (const s of ["EDGE-INDEX", "GAUNTLET-INDEX", "GAUNTLET-MORPHO-INDEX"]) {
      expect(getIndexMetadata(SEPOLIA_CHAIN_ID, "0x0000000000000000000000000000000000000002", s).curator).toMatch(/-style$/);
    }
  });
});

describe("checkRedeem", () => {
  it("validates minimum and balance", () => {
    const base = { balance: 10n, minRedeem: 2n, blockedReason: null };
    expect(checkRedeem({ ...base, shares: 1n }).ok).toBe(false);
    expect(checkRedeem({ ...base, shares: 11n }).ok).toBe(false);
    expect(checkRedeem({ ...base, shares: 5n }).ok).toBe(true);
  });
});
