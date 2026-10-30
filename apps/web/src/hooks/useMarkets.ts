"use client";

import { useMemo } from "react";
import type { ApyResult } from "@/lib/apy";
import { config } from "@/lib/config";
import { getIndexMetadata, type IndexMetadata } from "@/lib/metadata";
import type { IndexView } from "@/lib/types";
import { useApiIndexMetadata } from "./useApi";
import { useIndexApys } from "./useApy";
import { useIndexes } from "./useIndexes";

export interface Market {
  index: IndexView;
  meta: IndexMetadata;
  apy: ApyResult | null;
}

/** All indexes with merged metadata and realised APY. APY loads independently of the on-chain views. */
export function useMarkets() {
  const base = useIndexes();
  const apiMeta = useApiIndexMetadata();
  const apys = useIndexApys(base.indexes.map((i) => ({ vault: i.vault, baseDecimals: i.baseDecimals })));
  const markets = useMemo<Market[]>(
    () =>
      base.indexes.map((index) => ({
        index,
        meta: getIndexMetadata(config.chainId, index.vault, index.symbol, apiMeta.data?.[index.vault.toLowerCase()]),
        apy: apys.data?.[index.vault] ?? null,
      })),
    [base.indexes, apiMeta.data, apys.data],
  );
  return { ...base, markets, apyLoading: apys.isLoading, apyError: apys.error };
}

export function useIndexMeta(index: IndexView | undefined): IndexMetadata | null {
  const apiMeta = useApiIndexMetadata();
  if (!index) return null;
  return getIndexMetadata(config.chainId, index.vault, index.symbol, apiMeta.data?.[index.vault.toLowerCase()]);
}
