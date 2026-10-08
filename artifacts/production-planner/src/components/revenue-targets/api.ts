/**
 * Revenue targets on the screen — ONE hook for "the targets for a month",
 * used by Numbers and Sales & Marketing so both show identical figures.
 * Server: routes/revenue-targets.ts. Rules: @workspace/revenue-targets.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { targetsForMonth, type MonthTargets, type StretchRow, type TargetChange } from "@workspace/revenue-targets";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface RevenueTargetsPayload {
  today: string;
  currentMonth: string;
  minimum: number;
  months: Array<MonthTargets & { setBy: { name: string | null; at: string } | null }>;
  rows: StretchRow[];
  history: Array<{
    kind: "minimum" | "stretch";
    month: string | null;
    oldValue: number | null;
    newValue: number | null;
    changedByName: string | null;
    changedAt: string;
  }>;
  /** The founder only — the server refuses everyone else's changes anyway. */
  canEdit: boolean;
}

export const REVENUE_TARGETS_KEY = ["revenue-targets"] as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/revenue-targets${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function useRevenueTargets(enabled = true) {
  return useQuery<RevenueTargetsPayload>({
    queryKey: REVENUE_TARGETS_KEY,
    queryFn: () => request<RevenueTargetsPayload>(""),
    enabled,
    staleTime: 60_000,
  });
}

/** This month's minimum + stretch (with carry-forward), plus the London
 *  day/month figures the pace sums need. Null until loaded. */
export function useThisMonthTargets(enabled = true) {
  const q = useRevenueTargets(enabled);
  const data = q.data;
  const thisMonth = data ? targetsForMonth(data.currentMonth, data.minimum, data.rows) : null;
  return { ...q, thisMonth, today: data?.today ?? null, canEdit: data?.canEdit ?? false };
}

export function useSaveTargetChanges() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: TargetChange[]) =>
      request<{ applied: TargetChange[]; targets: RevenueTargetsPayload }>("/changes", {
        method: "POST",
        body: JSON.stringify({ changes }),
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(REVENUE_TARGETS_KEY, res.targets);
      // The Sales & Marketing pulse words its "behind pace" note from the minimum.
      void queryClient.invalidateQueries({ queryKey: ["founder-sales-pulse"] });
    },
  });
}
