"use client";

import { formatUnitsFixed, indexLensAbi, withSlippage } from "@vectra/sdk";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { simulateContract } from "wagmi/actions";
import { ZERO } from "@/hooks/useIndexes";
import { useTx } from "@/hooks/useTx";
import { useUserPosition } from "@/hooks/useUser";
import { vaultAbi } from "@/lib/abis";
import { config } from "@/lib/config";
import { blockedReason } from "@/lib/deposit";
import { formatAmount, parseAmountInput } from "@/lib/format";
import { writeWithGasBuffer } from "@/lib/gas";
import type { IndexView } from "@/lib/types";
import { wagmiConfig } from "@/lib/wagmi";
import { DepositForm } from "./DepositForm";

interface Props {
  index: IndexView;
  symbol: string;
  eligible: boolean | null;
  slippageBps: number;
  onConnect: () => void;
}

export function DepositPanel({ index: v, symbol, eligible, slippageBps, onConnect }: Props) {
  const { address } = useAccount();
  const [input, setInput] = useState("");
  const position = useUserPosition(v.vault);
  const amount = parseAmountInput(input, v.baseDecimals);
  const label = amount ? `Deposit ${formatAmount(amount, v.baseDecimals)} ${symbol}` : "Deposit";
  const approveTx = useTx({ label: amount ? `Approve ${formatAmount(amount, v.baseDecimals)} ${symbol}` : "Approve" });
  const depositTx = useTx({ label, onConfirmed: () => setInput("") });
  const preview = useReadContract({
    address: config.lens ?? ZERO,
    abi: indexLensAbi,
    functionName: "previewDeposit",
    args: [v.vault, amount ?? 0n],
    query: { enabled: Boolean(config.lens && amount) },
  });
  const minShares = preview.data !== undefined ? withSlippage(preview.data, slippageBps) : undefined;
  const blocked = blockedReason({ connected: Boolean(address), shutdown: v.shutdown, paused: v.depositsPaused, eligible, pausedLabel: "Deposits are paused for this index." });
  const balance = position.data?.baseBalance ?? 0n;

  const approve = () => {
    if (!address || !amount) return;
    // Exact-amount approval; never unlimited.
    void approveTx.execute(
      () => simulateContract(wagmiConfig, { address: v.baseAsset, abi: erc20Abi, functionName: "approve", args: [v.vault, amount], account: address }),
      ({ request }) => writeWithGasBuffer(request),
    );
  };
  const deposit = () => {
    if (!address || !amount || minShares === undefined) return;
    void depositTx.execute(
      () => simulateContract(wagmiConfig, { address: v.vault, abi: vaultAbi, functionName: "deposit", args: [amount, minShares, address], account: address }),
      ({ request }) => writeWithGasBuffer(request),
    );
  };

  return (
    <DepositForm
      symbol={symbol}
      indexSymbol={v.symbol}
      decimals={v.baseDecimals}
      input={input}
      amount={amount}
      balance={balance}
      allowance={position.data?.baseAllowance ?? 0n}
      minDeposit={v.minDeposit}
      connected={Boolean(address)}
      blockedReason={blocked}
      expectedShares={amount ? preview.data : undefined}
      minShares={amount ? minShares : undefined}
      pricePerShare={v.pricePerShare}
      managementFeeBps={v.managementFeeBps}
      performanceFeeBps={v.performanceFeeBps}
      approveTx={approveTx.state}
      depositTx={depositTx.state}
      onInput={setInput}
      onMax={() => setInput(formatUnitsFixed(balance, v.baseDecimals, v.baseDecimals).replace(/,/g, ""))}
      onApprove={approve}
      onDeposit={deposit}
      onConnect={onConnect}
    />
  );
}
