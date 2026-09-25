import { useQuery } from "@tanstack/react-query";
import type { Granularity, TrendSeries } from "@/lib/sales-trend-view";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchTrend(from: string, to: string, granularity: Granularity | null): Promise<TrendSeries> {
  const params = new URLSearchParams({ from, to });
  if (granularity) params.set("granularity", granularity);
  const res = await fetch(`${BASE}/api/founder-numbers/trend?${params}`, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<TrendSeries>;
}

/**
 * One period's trend series — every metric per bucket, so all the graphs
 * for a period share this one read. `granularity` null lets the server pick
 * the natural grain for the period (hourly / daily / weekly).
 */
export function useSalesTrend(from: string, to: string, granularity: Granularity | null, enabled = true) {
  return useQuery({
    queryKey: ["founder-numbers-trend", from, to, granularity ?? "auto"],
    queryFn: () => fetchTrend(from, to, granularity),
    staleTime: 60 * 1000,
    enabled,
  });
}
