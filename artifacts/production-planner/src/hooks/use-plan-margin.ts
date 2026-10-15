/**
 * The production safety margin (GET /api/plan-margin): orders + 2 packs, or
 * + 4 once the orders need more than 12 batches. The Create / Edit Plan
 * screens size suggestions and raise warnings from it. Until it loads (or if
 * it can't), the defaults apply — the margin is never silently switched off.
 */
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_PLAN_MARGIN, type PlanMarginSettings } from "@workspace/plan-margin";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const PLAN_MARGIN_KEY = ["plan-margin"] as const;

export function usePlanMargin(enabled = true) {
  const q = useQuery<{ settings: PlanMarginSettings }>({
    queryKey: PLAN_MARGIN_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/plan-margin`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the safety margin (${res.status})`);
      return res.json();
    },
    enabled,
    staleTime: 60_000,
  });
  return { settings: q.data?.settings ?? DEFAULT_PLAN_MARGIN, loaded: !!q.data, loadError: q.isError };
}

export async function savePlanMargin(body: PlanMarginSettings): Promise<PlanMarginSettings> {
  const res = await fetch(`${BASE}/api/plan-margin`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b?.error ?? `Couldn't save (${res.status})`);
  return b.settings as PlanMarginSettings;
}
