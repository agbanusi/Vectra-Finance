"use client";

import { estimateRedemption, formatUnitsFixed, indexLensAbi, withSlippage } from "@vectra/sdk";
import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { simulateContract } from "wagmi/actions";
import { ZERO } from "@/hooks/useIndexes";
import { useTx } from "@/hooks/useTx";
import { useUserPosition } from "@/hooks/useUser";
import { vaultAbi } from "@/lib/abis";
import { config } from "@/lib/config";
import { blockedReason } from "@/lib/deposit";
import { formatShares, parseAmountInput, SHARE_DECIMALS } from "@/lib/format";
import { writeWithGasBuffer } from "@/lib/gas";
import type { IndexView } from "@/lib/types";
import { wagmiConfig } from "@/lib/wagmi";
import { WithdrawForm } from "./WithdrawForm";

interface Props {
  index: IndexView;
  symbol: string;
  eligible: boolean | null;
  slippageBps: number;
  onConnect: () => void;
}

export function WithdrawPanel({ index: v, symbol, eligible, slippageBps, onConnect }: Props) {
  const { address } = useAccount();
  const [input, setInput] = useState("");
  const [allowQueue, setAllowQueue] = useState(false);
  const position = useUserPosition(v.vault);
  const shares = parseAmountInput(input, SHARE_DECIMALS);
  const balance = position.data?.shares ?? 0n;
  const preview = useReadContract({
    address: config.lens ?? ZERO,
    abi: indexLensAbi,
    functionName: "previewRedeem",
    args: [v.vault, shares ?? 0n],
    query: { enabled: Boolean(config.lens && shares) },
  });
  const estimate =
    preview.data && shares
      ? estimateRedemption({ expectedAssets: preview.data[0], availableLiquidity: preview.data[1], redemptionsPaused: v.redemptionsPaused, queueFull: v.pendingRequests >= v.maxQueueLength })
      : undefined;
  const queued = estimate?.mode === "queued";
  const tx = useTx({
    label: shares ? `${queued ? "Request withdrawal of" : "Withdraw"} ${formatShares(shares)} ${v.symbol}` : "Withdraw",
    onConfirmed: () => {
      setInput("");
      setAllowQueue(false);
    },
  });
  const blocked = blockedReason({ connected: Boolean(address), shutdown: false, paused: v.redemptionsPaused, eligible, pausedLabel: "Withdrawals are paused for this index." });
  const minAssetsOut = estimate ? withSlippage(estimate.expectedAssets, slippageBps) : undefined;

  const withdraw = () => {
    if (!address || !shares || minAssetsOut === undefined) return;
    void tx.execute(
      () => simulateContract(wagmiConfig, { address: v.vault, abi: vaultAbi, functionName: "redeem", args: [shares, minAssetsOut, queued && allowQueue, address], account: address }),
      ({ request }) => writeWithGasBuffer(request),
    );
  };

  return (
    <WithdrawForm
      symbol={symbol}
      indexSymbol={v.symbol}
      vault={v.vault}
      decimals={v.baseDecimals}
      input={input}
      shares={shares}
      balance={balance}
      balanceValue={position.data?.value ?? 0n}
      minRedeem={v.minRedeem}
      connected={Boolean(address)}
      blockedReason={blocked}
      estimate={estimate}
      minAssetsOut={minAssetsOut}
      allowQueue={allowQueue}
      tx={tx.state}
      onInput={setInput}
      onMax={() => setInput(formatUnitsFixed(balance, SHARE_DECIMALS, SHARE_DECIMALS).replace(/,/g, ""))}
      onAllowQueue={setAllowQueue}
      onWithdraw={withdraw}
      onConnect={onConnect}
    />
  );
}
