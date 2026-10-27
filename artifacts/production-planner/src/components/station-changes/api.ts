/**
 * Data for "What's changed in this station?" and the station-grouped
 * meeting slide (/api/station-changes; Graeme, 27 Oct 2026). React Query
 * throughout. Keyed by the signed-in person, because "seen" is per person
 * and a PIN switch on a shared iPad must read afresh.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { changesForStation, unseenCount, type ChangeArea, type StationChange } from "@workspace/station-changes";
import { useAuth } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface StationChangesData {
  areas: ChangeArea[];
  entries: StationChange[];
  seenIds: number[];
}

export const stationChangesKey = (userId: number | null, days: number) => ["station-changes", userId, days] as const;

export function useStationChanges(days = 7, enabled = true) {
  const { state, pinLocked } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  return useQuery<StationChangesData>({
    queryKey: stationChangesKey(userId, days),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/station-changes?days=${days}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load what's changed (${res.status})`);
      return res.json();
    },
    enabled: enabled && userId != null && !pinLocked,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 1,
  });
}

/** One station's changes in the last 7 days, and how many this person
 *  hasn't seen. */
export function useStationChangesFor(stationType: string) {
  const q = useStationChanges(7);
  const derived = useMemo(() => {
    const d = q.data;
    if (!d) return { changes: [] as StationChange[], seen: new Set<number>(), unseen: 0 };
    const seen = new Set(d.seenIds);
    const changes = changesForStation(d.entries, d.areas, stationType, new Date());
    return { changes, seen, unseen: unseenCount(changes, seen) };
  }, [q.data, stationType]);
  return { ...q, ...derived };
}

export function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      if (ids.length === 0) return;
      const res = await fetch(`${BASE}/api/station-changes/seen`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`Couldn't save (${res.status})`);
    },
    // Show it as seen straight away; the refetch confirms it.
    onMutate: (ids: number[]) => {
      qc.setQueriesData<StationChangesData>({ queryKey: ["station-changes"] }, prev =>
        prev ? { ...prev, seenIds: [...new Set([...prev.seenIds, ...ids])] } : prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["station-changes"] }),
  });
}
