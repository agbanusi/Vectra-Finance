import { estimateRedemption } from "@vectra/sdk";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WithdrawForm, type WithdrawFormProps } from "@/components/index/WithdrawForm";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { initialTxState } from "@/lib/tx";

const E18 = 10n ** 18n;

function renderForm(overrides: Partial<WithdrawFormProps>) {
  const props: WithdrawFormProps = {
    symbol: "tUSDC", indexSymbol: "vSAFE", vault: "0x1", decimals: 6, input: "", shares: null, balance: 10n * E18, balanceValue: 10_000_000n,
    minRedeem: E18 / 1000n, connected: true, blockedReason: null, estimate: undefined, minAssetsOut: undefined, allowQueue: false, tx: initialTxState,
    onInput: vi.fn(), onMax: vi.fn(), onAllowQueue: vi.fn(), onWithdraw: vi.fn(), onConnect: vi.fn(), ...overrides,
  };
  render(<TooltipProvider><WithdrawForm {...props} /></TooltipProvider>);
  return props;
}

const instant = estimateRedemption({ expectedAssets: 2_000_000n, availableLiquidity: 50_000_000n, redemptionsPaused: false, queueFull: false });
const queued = estimateRedemption({ expectedAssets: 9_000_000n, availableLiquidity: 3_000_000n, redemptionsPaused: false, queueFull: false });

describe("WithdrawForm", () => {
  it("withdraws instantly when liquidity covers the claim", () => {
    const props = renderForm({ input: "2", shares: 2n * E18, estimate: instant, minAssetsOut: 1_990_000n });
    expect(screen.getByText("Instant")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Queue my withdrawal/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(props.onWithdraw).toHaveBeenCalledOnce();
  });

  it("requires explicit queue opt-in when liquidity is short", () => {
    renderForm({ input: "9", shares: 9n * E18, estimate: queued, minAssetsOut: 8_955_000n });
    expect(screen.getByText("Queued — not instant")).toBeInTheDocument();
    expect(screen.getByLabelText(/Queue my withdrawal/)).not.toBeChecked();
    expect(screen.getByText("Floor (minimum paid)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request withdrawal" })).toBeDisabled();
  });

  it("enables the queued request once opted in", () => {
    const props = renderForm({ input: "9", shares: 9n * E18, estimate: queued, minAssetsOut: 8_955_000n, allowQueue: true });
    fireEvent.click(screen.getByRole("button", { name: "Request withdrawal" }));
    expect(props.onWithdraw).toHaveBeenCalledOnce();
  });

  it("flags amounts above the share balance", () => {
    renderForm({ input: "20", shares: 20n * E18 });
    expect(screen.getByRole("alert")).toHaveTextContent("exceeds your index token balance");
  });

  it("asks to connect when disconnected", () => {
    const props = renderForm({ connected: false });
    fireEvent.click(screen.getByRole("button", { name: /Connect wallet/ }));
    expect(props.onConnect).toHaveBeenCalledOnce();
  });
});
