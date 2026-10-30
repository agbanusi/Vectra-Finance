import { SearchX } from "lucide-react";
import Link from "next/link";
import { getAddress, isAddress } from "viem";
import { IndexDetail } from "@/components/index/IndexDetail";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";

export default async function IndexPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) {
    return (
      <Card>
        <EmptyState icon={SearchX} title="Invalid index address" action={<Link href="/app" className="text-sm font-medium text-accent-strong hover:underline">Back to markets</Link>}>
          <span className="break-all font-mono text-xs">{address}</span>
        </EmptyState>
      </Card>
    );
  }
  return <IndexDetail address={getAddress(address)} />;
}
