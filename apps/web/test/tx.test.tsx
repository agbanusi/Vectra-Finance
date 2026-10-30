import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useTx } from "@/hooks/useTx";
import { initialTxState, isTxBusy, txReducer } from "@/lib/tx";

const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

describe("txReducer", () => {
  it("walks the happy path", () => {
    let s = txReducer(initialTxState, { type: "START" });
    expect(s.phase).toBe("simulating");
    s = txReducer(s, { type: "SIMULATED" });
    expect(s.phase).toBe("awaiting-signature");
    s = txReducer(s, { type: "SUBMITTED", hash: HASH });
    expect(s).toEqual({ phase: "pending", hash: HASH });
    s = txReducer(s, { type: "CONFIRMED" });
    expect(s).toEqual({ phase: "confirmed", hash: HASH });
  });
  it("ignores invalid transitions", () => {
    expect(txReducer(initialTxState, { type: "CONFIRMED" })).toBe(initialTxState);
    expect(txReducer({ phase: "simulating" }, { type: "SUBMITTED", hash: HASH }).phase).toBe("simulating");
  });
  it("records revert reasons and busy flags", () => {
    const s = txReducer({ phase: "pending", hash: HASH }, { type: "REVERTED", error: "SlippageExceeded" });
    expect(s).toEqual({ phase: "reverted", hash: HASH, error: "SlippageExceeded" });
    expect(isTxBusy("pending")).toBe(true);
    expect(isTxBusy("reverted")).toBe(false);
  });
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("useTx", () => {
  it("simulates, writes, waits and confirms", async () => {
    const wait = vi.fn().mockResolvedValue({ status: "success" });
    const onConfirmed = vi.fn();
    const { result } = renderHook(() => useTx({ wait, onConfirmed }), { wrapper });
    let ok = false;
    await act(async () => {
      ok = await result.current.execute(async () => "sim", async (sim) => (sim === "sim" ? HASH : "0x0"));
    });
    expect(ok).toBe(true);
    expect(wait).toHaveBeenCalledWith(HASH);
    expect(result.current.state).toEqual({ phase: "confirmed", hash: HASH });
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it("fails without writing when simulation throws", async () => {
    const write = vi.fn();
    const { result } = renderHook(() => useTx({ wait: vi.fn() }), { wrapper });
    await act(async () => {
      await result.current.execute(async () => { throw new Error("boom"); }, write);
    });
    expect(write).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ phase: "failed", error: "boom" });
  });

  it("marks reverted receipts", async () => {
    const wait = vi.fn().mockResolvedValue({ status: "reverted" });
    const { result } = renderHook(() => useTx({ wait }), { wrapper });
    await act(async () => {
      await result.current.execute(async () => 1, async () => HASH);
    });
    expect(result.current.state.phase).toBe("reverted");
    act(() => result.current.reset());
    expect(result.current.state).toEqual(initialTxState);
  });
});
