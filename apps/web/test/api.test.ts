import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/lib/api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("is inert when no base URL is configured", async () => {
    const fetcher = vi.fn();
    const api = createApiClient({ baseUrl: "", fetcher });
    expect(await api.indexHistory("0x1")).toEqual({ ok: false, error: "API not configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resolves ok:false when the network fails", async () => {
    const api = createApiClient({ baseUrl: "http://x", fetcher: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
    expect(await api.indexHistory("0x1")).toEqual({ ok: false, error: "API unavailable: fetch failed" });
  });

  it("resolves ok:false on HTTP errors", async () => {
    const api = createApiClient({ baseUrl: "http://x", fetcher: vi.fn().mockResolvedValue(json({}, 503)) });
    expect(await api.walletActivity("0x1")).toEqual({ ok: false, error: "API responded 503" });
  });

  it("rejects unexpected shapes and invalid JSON", async () => {
    const api = createApiClient({ baseUrl: "http://x", fetcher: vi.fn().mockResolvedValue(json({ nope: 1 })) });
    expect((await api.indexActivity("0x1")).ok).toBe(false);
    const api2 = createApiClient({ baseUrl: "http://x", fetcher: vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })) });
    expect((await api2.indexes()).ok).toBe(false);
  });

  it("returns data, unwrapping {data} envelopes, and builds query strings", async () => {
    const snap = { timestamp: 1, nav: "1", totalSupply: "1", pricePerShare: "1" };
    const fetcher = vi.fn().mockResolvedValue(json({ data: [snap] }));
    const api = createApiClient({ baseUrl: "http://x", fetcher });
    expect(await api.indexHistory("0xabc", 10, 20)).toEqual({ ok: true, data: [snap] });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://x/v1/indexes/0xabc/history?from=10&to=20");
  });

  it("lists index metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: [{ vault: "0xA", metadata: { riskTier: "low", tags: ["x"] } }] }));
    const res = await createApiClient({ baseUrl: "http://x", fetcher }).indexes();
    expect(res.ok && res.data[0]?.metadata?.riskTier).toBe("low");
  });

  it("times out slow responses", async () => {
    const fetcher = (_: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const api = createApiClient({ baseUrl: "http://x", fetcher, timeoutMs: 10 });
    expect(await api.indexes()).toEqual({ ok: false, error: "API unavailable: aborted" });
  });
});
