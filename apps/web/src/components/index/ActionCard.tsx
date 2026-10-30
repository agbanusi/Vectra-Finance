"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import type { Eligibility } from "@/hooks/useEligibility";
import { useMounted } from "@/hooks/useMounted";
import { Lock } from "lucide-react";
import { config } from "@/lib/config";
import { isPermissionless } from "@/lib/types";
import { Notice } from "../ui/States";
import { isDepositGated } from "@/lib/deposit";
import type { IndexView } from "@/lib/types";
import { Card } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { SegmentedList, SegmentedTrigger, Tabs, TabsContent } from "../ui/Tabs";
import { WalletModal } from "../wallet/WalletModal";
import { DepositPanel } from "./DepositPanel";
import { EligibilityGate } from "./EligibilityGate";
import { FaucetButton } from "./FaucetButton";
import { DEFAULT_SLIPPAGE_BPS, SlippagePopover } from "./SlippagePopover";
import { WithdrawPanel } from "./WithdrawPanel";

export function ActionCard({ index: v, symbol, eligibility }: { index: IndexView; symbol: string; eligibility: Eligibility }) {
  const mounted = useMounted();
  const { address } = useAccount();
  const [tab, setTab] = useState("deposit");
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE_BPS);
  const [walletOpen, setWalletOpen] = useState(false);
  const connect = () => setWalletOpen(true);
  const gated = isDepositGated(eligibility.eligible, Boolean(address));

  return (
    <Card className="p-4 sm:p-5">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center gap-2">
          <SegmentedList aria-label="Action" className="flex-1">
            <SegmentedTrigger value="deposit">Deposit</SegmentedTrigger>
            <SegmentedTrigger value="withdraw">Withdraw</SegmentedTrigger>
          </SegmentedList>
          <SlippagePopover bps={slippage} onChange={setSlippage} />
        </div>
        <div className="mt-4">
          {!mounted ? (
            <div className="space-y-4"><Skeleton className="h-[118px] w-full rounded-2xl" /><Skeleton className="h-24 w-full" /><Skeleton className="h-13 w-full rounded-xl" /></div>
          ) : (
            <>
              <TabsContent value="deposit" className="space-y-4 focus-visible:outline-none">
                {!gated && !isPermissionless(v.compliancePolicy) ? (
                  <Notice tone="warning" icon={Lock}>Restricted index — only allowlisted wallets can deposit. {address ? (eligibility.eligible ? "Your wallet is allowlisted." : eligibility.label + ".") : "Connect to check eligibility."}</Notice>
                ) : null}
                {gated && address ? <EligibilityGate account={address} module={v.complianceModule} /> : <DepositPanel index={v} symbol={symbol} eligible={eligibility.eligible} slippageBps={slippage} onConnect={connect} />}
              </TabsContent>
              <TabsContent value="withdraw" className="focus-visible:outline-none">
                <WithdrawPanel index={v} symbol={symbol} eligible={eligibility.eligible} slippageBps={slippage} onConnect={connect} />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
      {mounted && address && config.isTestnet && tab === "deposit" && !gated ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-subtle">Testnet — need funds?</p>
          <FaucetButton symbol={symbol} decimals={v.baseDecimals} size="xs" />
        </div>
      ) : null}
      <WalletModal open={walletOpen} onOpenChange={setWalletOpen} />
    </Card>
  );
}
