import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DepositForm, type DepositFormProps } from "@/components/index/DepositForm";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { blockedReason, checkDeposit, isDepositGated } from "@/lib/deposit";
import { initialTxState } from "@/lib/tx";

const base = { balance: 100_000_000n, allowance: 0n, minDeposit: 1_000_000n, blockedReason: null };
const ui = (el: ReactElement) => render(<TooltipProvider>{el}</TooltipProvider>);

describe("checkDeposit", () => {
  it("is silent for empty input", () => {
    expect(checkDeposit({ ...base, amount: null })).toEqual({ ok: false, message: null });
  });
  it("enforces the minimum deposit and balance", () => {
    expect(checkDeposit({ ...base, amount: 500_000n })).toEqual({ ok: false, message: "Amount is below the minimum deposit." });
    expect(checkDeposit({ ...base, amount: 200_000_000n })).toEqual({ ok: false, message: "Amount exceeds your balance." });
  });
  it("requires approval when allowance is insufficient", () => {
    expect(checkDeposit({ ...base, amount: 5_000_000n })).toEqual({ ok: true, needsApproval: true });
    expect(checkDeposit({ ...base, allowance: 5_000_000n, amount: 5_000_000n })).toEqual({ ok: true, needsApproval: false });
  });
  it("blocks when paused, shut down or ineligible", () => {
    expect(blockedReason({ connected: true, shutdown: true, paused: true, eligible: true, pausedLabel: "p" })).toMatch(/shutdown/);
    expect(blockedReason({ connected: true, shutdown: false, paused: true, eligible: true, pausedLabel: "Deposits are paused." })).toBe("Deposits are paused.");
    expect(blockedReason({ connected: true, shutdown: false, paused: false, eligible: false, pausedLabel: "" })).toMatch(/not eligible/);
    expect(blockedReason({ connected: true, shutdown: false, paused: false, eligible: true, pausedLabel: "" })).toBeNull();
  });
});

describe("isDepositGated", () => {
  it("gates only connected, known-ineligible wallets", () => {
    expect(isDepositGated(false, true)).toBe(true);
    expect(isDepositGated(false, false)).toBe(false);
    expect(isDepositGated(null, true)).toBe(false);
    expect(isDepositGated(true, true)).toBe(false);
  });
});

function renderForm(overrides: Partial<DepositFormProps>) {
  const props: DepositFormProps = {
    symbol: "tUSDC", indexSymbol: "vSAFE", decimals: 6, input: "", amount: null, ...base, connected: true, expectedShares: undefined, minShares: undefined,
    pricePerShare: 1_012_345n, managementFeeBps: 100, performanceFeeBps: 1000, approveTx: initialTxState, depositTx: initialTxState,
    onInput: vi.fn(), onMax: vi.fn(), onApprove: vi.fn(), onDeposit: vi.fn(), onConnect: vi.fn(), ...overrides,
  };
  ui(<DepositForm {...props} />);
  return props;
}

describe("DepositForm", () => {
  it("asks to connect when no wallet is connected", () => {
    const props = renderForm({ connected: false });
    fireEvent.click(screen.getByRole("button", { name: /Connect wallet/ }));
    expect(props.onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Balance/)).not.toBeInTheDocument();
  });

  it("prompts for an amount when empty", () => {
    renderForm({});
    expect(screen.getByRole("button", { name: "Enter an amount" })).toBeDisabled();
  });

  it("shows a min-deposit error", () => {
    renderForm({ input: "0.5", amount: 500_000n });
    expect(screen.getByRole("alert")).toHaveTextContent("below the minimum");
    expect(screen.getByRole("button", { name: "Below minimum deposit" })).toBeDisabled();
  });

  it("shows a balance error", () => {
    renderForm({ input: "500", amount: 500_000_000n });
    expect(screen.getByRole("alert")).toHaveTextContent("exceeds your balance");
    expect(screen.getByRole("button", { name: "Insufficient balance" })).toBeDisabled();
  });

  it("puts approval inline as step 1 when allowance is short", () => {
    const props = renderForm({ input: "5", amount: 5_000_000n, expectedShares: 5n * 10n ** 18n, minShares: 4n * 10n ** 18n });
    expect(screen.getByRole("list", { name: "Deposit steps" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve tUSDC" }));
    expect(props.onApprove).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Deposit" })).not.toBeInTheDocument();
  });

  it("enables deposit when approved and shows the quote, rate and fees", () => {
    const props = renderForm({ input: "5", amount: 5_000_000n, allowance: 5_000_000n, expectedShares: 5n * 10n ** 18n, minShares: 4n * 10n ** 18n });
    expect(screen.getByText("5 vSAFE")).toBeInTheDocument();
    expect(screen.getByText("1 vSAFE = 1.012345 tUSDC")).toBeInTheDocument();
    expect(screen.getByText(/1\.00%\/yr · 10\.00% perf/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(props.onDeposit).toHaveBeenCalledOnce();
  });

  it("MAX fills the balance", () => {
    const props = renderForm({});
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(props.onMax).toHaveBeenCalledOnce();
  });

  it("rejects non-numeric typing", () => {
    const props = renderForm({});
    fireEvent.change(screen.getByLabelText("You deposit"), { target: { value: "abc" } });
    expect(props.onInput).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("You deposit"), { target: { value: "1,5" } });
    expect(props.onInput).toHaveBeenCalledWith("1.5");
  });

  it("shows the blocked reason and disables deposit", () => {
    renderForm({ blockedReason: "Deposits are paused for this index.", input: "5", amount: 5_000_000n, allowance: 5_000_000n, minShares: 1n });
    expect(screen.getByText("Deposits are paused for this index.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
  });

  it("shows a busy state while the deposit is pending", () => {
    renderForm({ input: "5", amount: 5_000_000n, allowance: 5_000_000n, minShares: 1n, depositTx: { phase: "pending", hash: "0x01" } });
    const btn = screen.getByRole("button", { name: /Transaction pending/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});
