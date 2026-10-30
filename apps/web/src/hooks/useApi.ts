"use client";

import { useQuery } from "@tanstack/react-query";
import { api, apiEnabled } from "@/lib/api";

/** Backend metadata keyed by lowercase vault address (empty when the API is not configured). */
export function useApiIndexMetadata() {
  return useQuery({
    queryKey: ["api", "indexes"],
    enabled: apiEnabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await api.indexes();
      if (!res.ok) return {};
      return Object.fromEntries(res.data.filter((i) => typeof i.vault === "string").map((i) => [i.vault.toLowerCase(), i.metadata ?? null]));
    },
  });
}
