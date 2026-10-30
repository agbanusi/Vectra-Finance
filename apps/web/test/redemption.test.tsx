import { estimateRedemption } from "@vectra/sdk";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RedemptionEstimateView } from "@/components/index/RedemptionEstimate";
import { requestSteps } from "@/components/index/RequestsList";
import { RequestStatus } from "@vectra/sdk";

const base = { redemptionsPaused: false, queueFull: false };

function renderEstimate(expectedAssets: bigint, availableLiquidity: bigint, extra: Partial<typeof base> = {}) {
  const estimate = estimateRedemption({ ...base, ...extra, expectedAssets, availableLiquidity });
  const { container } = render(<RedemptionEstimateView estimate={estimate} decimals={6} symbol="USDC" minAssetsOut={990_000n} />);
  return container.firstElementChild;
}

describe("RedemptionEstimateView", () => {
  it("shows instant when free liquidity covers the claim", () => {
    const el = renderEstimate(1_000_000n, 5_000_000n);
    expect(el).toHaveAttribute("data-mode", "instant");
    expect(screen.getByText("Instant")).toBeInTheDocument();
    expect(screen.queryByText(/Queued/)).not.toBeInTheDocument();
  });

  it("shows queued with fill-time NAV and floor explanation when liquidity is short", () => {
    const el = renderEstimate(10_000_000n, 4_000_000n);
    expect(el).toHaveAttribute("data-mode", "queued");
    expect(screen.getByText(/not instant/i)).toBeInTheDocument();
    expect(screen.getByText(/NAV at fill time/)).toBeInTheDocument();
    expect(screen.getByText(/keepers withdraw/)).toBeInTheDocument();
    expect(screen.getByText(/by 6 USDC/)).toBeInTheDocument();
  });

  it("shows unavailable when redemptions are paused or the queue is full", () => {
    expect(renderEstimate(1_000_000n, 5_000_000n, { redemptionsPaused: true })).toHaveAttribute("data-mode", "unavailable");
    expect(screen.getByText(/paused/)).toBeInTheDocument();
  });

  it("shows unavailable when the queue is full and liquidity is short", () => {
    expect(renderEstimate(10_000_000n, 0n, { queueFull: true })).toHaveAttribute("data-mode", "unavailable");
    expect(screen.getByText(/queue is full/)).toBeInTheDocument();
  });
});

describe("requestSteps", () => {
  it("maps statuses onto the timeline", () => {
    expect(requestSteps(RequestStatus.Pending).map((s) => s.state)).toEqual(["done", "active", "todo"]);
    expect(requestSteps(RequestStatus.PartiallyFilled)[1]?.label).toBe("Partially filled");
    expect(requestSteps(RequestStatus.Fulfilled).map((s) => s.state)).toEqual(["done", "done", "done"]);
    const cancelled = requestSteps(RequestStatus.Cancelled);
    expect(cancelled[2]).toEqual({ label: "Cancelled", state: "stopped" });
  });
});
