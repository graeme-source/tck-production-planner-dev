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

export function useStationPlanIds(enabled: boolean): StationPlanIds | null {
  const today = londonToday();
  // Today's plan from the plan list, like the dashboard — any status, since
  // the closing checklist is often done after the plan is marked complete.
  const { data: plans } = useListProductionPlans(undefined, { query: { queryKey: getListProductionPlansQueryKey(), enabled } });
  const { data: ahead } = useQuery({
    queryKey: ["station-plan-ids-ahead", today],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const [prep, dough] = await Promise.all([nextActive(today, "prep"), nextActive(today, "dough")]);
      return { nextPrep: prep.planId, nextDough: dough.planId };
    },
  });
  if (!plans || !ahead) return null;
  const todays = plans.find(p => String(p.planDate).slice(0, 10) === today);
  return { today: todays?.id ?? null, ...ahead };
}
