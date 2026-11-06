/** The Ads page's feed: GET /api/meta-ads/report (read-only, from Meta). */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdRow } from "@/lib/ads-page";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type AdsReport =
  | { connected: false; ok: true; message: string }
  | { connected: true; ok: false; message: string }
  | { connected: true; ok: true; from: string; to: string; fetchedAt: string; campaigns: AdRow[]; adSets: AdRow[]; ads: AdRow[] };

const fetchReport = async (from: string, to: string, refresh: boolean): Promise<AdsReport> => {
  const params = new URLSearchParams({ from, to, ...(refresh ? { refresh: "1" } : {}) });
  const res = await fetch(`${BASE}/api/meta-ads/report?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/** Keeps itself fresh every five minutes, in step with the server's copy. */
export function useAdsReport(from: string, to: string, enabled: boolean) {
  const qc = useQueryClient();
  const key = ["meta-ads-report", from, to];
  const query = useQuery<AdsReport>({
    queryKey: key,
    queryFn: () => fetchReport(from, to, false),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(key, await fetchReport(from, to, true));
    } finally {
      setRefreshing(false);
    }
  };
  return { ...query, refresh, refreshing };
}
