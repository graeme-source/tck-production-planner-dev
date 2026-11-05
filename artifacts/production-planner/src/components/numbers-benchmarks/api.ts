/** Benchmarks for the Numbers panels: GET/PUT /api/numbers-benchmarks. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Benchmark, BenchmarkMap, DayPace, KpiId } from "@/lib/numbers-benchmarks";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["numbers-benchmarks"] as const;

export function useNumbersBenchmarks() {
  return useQuery<{ benchmarks: BenchmarkMap; canEdit: boolean }>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/numbers-benchmarks`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kpi, benchmark }: { kpi: KpiId; benchmark: Benchmark }) => {
      const res = await fetch(`${BASE}/api/numbers-benchmarks/${kpi}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(benchmark),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** How a normal day builds up, from the last four weeks' orders. */
export function useDayPace() {
  return useQuery<DayPace>({
    queryKey: ["founder-numbers-day-pace"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/founder-numbers/day-pace`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60_000,
  });
}
