/**
 * The plan each kind of station is working right now — today's, the next
 * prep plan and the next dough plan — resolved the way the dashboard does
 * (pages/dashboard.tsx, /api/production-plans/next-active). Used by the
 * Switch checklist menu so each station opens on its own day (#406).
 */
import { useQuery } from "@tanstack/react-query";
import { useListProductionPlans, getListProductionPlansQueryKey } from "@workspace/api-client-react";
import { londonToday } from "@/lib/station-training";
import type { StationPlanIds } from "./switch-targets";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type NextActive = { planId: number | null; planDate: string | null };

async function nextActive(afterDate: string, kind: "plan" | "prep" | "dough"): Promise<NextActive> {
  const res = await fetch(`${BASE}/api/production-plans/next-active?afterDate=${afterDate}&for=${kind}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useStationPlanIds(enabled: boolean): { plans: StationPlanIds | null; failed: boolean } {
  const today = londonToday();
  // Today's plan from the plan list, like the dashboard — any status, since
  // the closing checklist is often done after the plan is marked complete.
  const list = useListProductionPlans(undefined, { query: { queryKey: getListProductionPlansQueryKey(), enabled } });
  const ahead = useQuery({
    queryKey: ["station-plan-ids-ahead", today],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const [prep, dough] = await Promise.all([nextActive(today, "prep"), nextActive(today, "dough")]);
      return { nextPrep: prep.planId, nextDough: dough.planId };
    },
  });
  const failed = list.isError || ahead.isError;
  if (!list.data || !ahead.data) return { plans: null, failed };
  const todays = list.data.find(p => String(p.planDate).slice(0, 10) === today);
  return { plans: { today: todays?.id ?? null, ...ahead.data }, failed };
}

/** Which plan holds this station's checklist TODAY — asked of the server,
 *  which has the one rule (lib/checklist-day.ts; Graeme, 20 Nov 2026). Every
 *  path into a checklist shows the same list. planId null = no plan for the
 *  station today. */
export function useTodayChecklistPlan(stationType: string, enabled: boolean) {
  return useQuery<{ planId: number | null }>({
    queryKey: ["checklist-today-plan", stationType, londonToday()],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/checklists/station/${encodeURIComponent(stationType)}/today-plan`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}
