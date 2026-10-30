"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useReducer, useRef } from "react";
import { toast } from "sonner";
import type { Hash } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { describeError } from "@/lib/errors";
import { explorerTxUrl } from "@/lib/explorer";
import { initialTxState, isTxBusy, txReducer, type TxState } from "@/lib/tx";
import { wagmiConfig } from "@/lib/wagmi";

export type WaitForReceipt = (hash: Hash) => Promise<{ status: "success" | "reverted" }>;

const defaultWait: WaitForReceipt = (hash) => waitForTransactionReceipt(wagmiConfig, { hash });

export interface UseTx {
  state: TxState;
  busy: boolean;
  /** Simulates, then writes, then waits for the receipt. Resolves true on confirmation. */
  execute: <R>(simulate: () => Promise<R>, write: (simulated: R) => Promise<Hash>) => Promise<boolean>;
  reset: () => void;
}

export interface UseTxOptions {
  wait?: WaitForReceipt;
  onConfirmed?: () => void;
  /** Human label for lifecycle toasts, e.g. "Deposit 100 USDC". No toasts when omitted. */
  label?: string;
}

/** Toast lifecycle for a transaction. Silent when no label is given. */
function notifier(label: string | undefined) {
  let id: string | number | undefined;
  const view = (hash: Hash) => {
    const url = explorerTxUrl(hash);
    return url ? { action: { label: "View", onClick: () => window.open(url, "_blank", "noopener,noreferrer") } } : {};
  };
  return {
    start() {
      if (label) id = toast.loading(label, { description: "Confirm in your wallet" });
    },
    submitted(hash: Hash) {
      if (label) toast.loading(label, { id, description: "Submitted — waiting for confirmation", ...view(hash) });
    },
    confirmed(hash: Hash) {
      if (label) toast.success(label, { id, description: "Confirmed on-chain", ...view(hash) });
    },
    failed(message: string) {
      if (!label) return;
      if (/rejected/i.test(message)) toast.message("Request cancelled", { id, description: "You rejected the request in your wallet." });
      else toast.error(`${label} failed`, { id, description: message });
    },
  };
}

export function useTx(options: UseTxOptions = {}): UseTx {
  const [state, dispatch] = useReducer(txReducer, initialTxState);
  const labelRef = useRef(options.label);
  labelRef.current = options.label;
  const queryClient = useQueryClient();
  const wait = options.wait ?? defaultWait;
  const { onConfirmed } = options;

  const settle = useCallback(
    async (hash: Hash, simulate: () => Promise<unknown>, notify: ReturnType<typeof notifier>): Promise<boolean> => {
      try {
        const receipt = await wait(hash);
        if (receipt.status === "success") {
          dispatch({ type: "CONFIRMED" });
          notify.confirmed(hash);
          await queryClient.invalidateQueries();
          onConfirmed?.();
          return true;
        }
        const reason = await replayReason(simulate);
        dispatch({ type: "REVERTED", error: reason });
        notify.failed(reason);
      } catch (err) {
        const message = describeError(err);
        dispatch({ type: "FAILED", error: message });
        notify.failed(message);
      }
      return false;
    },
    [wait, onConfirmed, queryClient],
  );

  const execute = useCallback<UseTx["execute"]>(
    async (simulate, write) => {
      const notify = notifier(labelRef.current);
      dispatch({ type: "START" });
      notify.start();
      let hash: Hash;
      try {
        const simulated = await simulate();
        dispatch({ type: "SIMULATED" });
        hash = await write(simulated);
        dispatch({ type: "SUBMITTED", hash });
        notify.submitted(hash);
      } catch (err) {
        const message = describeError(err);
        dispatch({ type: "FAILED", error: message });
        notify.failed(message);
        return false;
      }
      return settle(hash, simulate, notify);
    },
    [settle],
  );

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);
  return { state, busy: isTxBusy(state.phase), execute, reset };
}

/** Best-effort: re-simulate against current state to recover the custom error name. */
async function replayReason(simulate: () => Promise<unknown>): Promise<string> {
  try {
    await simulate();
    return "Reverted on-chain (state changed before inclusion).";
  } catch (err) {
    return describeError(err);
  }
}
