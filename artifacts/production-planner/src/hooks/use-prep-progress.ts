import { useQuery } from "@tanstack/react-query";
import {
  prepProgress, type PrepProgress, type PrepTick, type PrepTinLine,
  type BasesProgressInput, type RawMeatProgressInput,
} from "@/lib/prep-progress";

/** Prep progress in TASKS for one plan (the plan being prepped FOR), from
 *  the very responses the three prep sections render from, run through the
 *  one shared helper (lib/prep-progress.ts). Used by the dashboard
 *  "Prepping For" tile, the Prepping For hub and the plan page's prep
 *  button, so they always match the section headers. */
export const prepProgressKey = (planId: number) => ["prep-progress-tasks", planId] as const;

type MainPrepResponse = {
  ingredients?: PrepTinLine[];
  completions?: PrepTick[];
  deferrals?: PrepTick[];
  linkedItems?: Record<number, Array<{ key?: string }>>;
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { credentials: "include", signal });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchPrepProgress(planId: number, signal?: AbortSignal): Promise<PrepProgress> {
  const p = `/api/production-plans/${planId}`;
  const [main, linked, bases, subReqs, subDone, meat] = await Promise.all([
    getJson<MainPrepResponse>(`${p}/main-prep?station=main_prep`, signal),
    getJson<Array<{ key: string }>>(`/api/prep-linked-completions/${planId}`, signal),
    getJson<MainPrepResponse>(`${p}/main-prep?station=prep_bases`, signal),
    getJson<{ subRecipes?: BasesProgressInput["subRecipes"] }>(`${p}/sub-recipe-requirements`, signal),
    getJson<{ completions?: Array<{ subRecipeId: number }> }>(`${p}/sub-recipe-completions`, signal),
    getJson<{ recipes?: RawMeatProgressInput["recipes"] }>(`${p}/prep-requirements-by-recipe?station=prep_meat`, signal),
  ]);
  // Away from main prep, /main-prep returns the plan's FULL completion set
  // (it doesn't filter by station), which is exactly what the Raw Meat
  // station matches its trays against — so the bases response serves both.
  const nonMainTicks = bases.completions ?? [];
  return prepProgress({
    mainPrep: {
      ingredients: main.ingredients ?? [],
      completions: main.completions ?? [],
      deferrals: main.deferrals ?? [],
      linkedItems: main.linkedItems ?? {},
      linkedDone: linked.map(r => r.key),
    },
    bases: {
      ingredients: bases.ingredients ?? [],
      completions: nonMainTicks,
      subRecipes: subReqs.subRecipes ?? [],
      completedSubRecipeIds: (subDone.completions ?? []).map(c => c.subRecipeId),
    },
    rawMeat: { recipes: meat.recipes ?? [], completions: nonMainTicks },
  });
}

export function usePrepProgress(planId: number | null | undefined, opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: prepProgressKey(planId ?? 0),
    enabled: planId != null && planId > 0,
    refetchInterval: opts.refetchInterval ?? 30_000,
    queryFn: ({ signal }) => fetchPrepProgress(planId!, signal),
  });
}
