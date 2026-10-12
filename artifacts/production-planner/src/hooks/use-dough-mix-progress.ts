import { guardedFetch } from "@/hooks/use-guarded-action";
import type { SavedDoughMix } from "@/lib/dough-mix-status";

/** GET/PUT /api/dough-mix-progress/:planId (api-server routes/dough-mix-progress.ts).
 *  planId = the plan the dough is FOR (the Dough Prep station's tracking plan). */
export type DoughMixProgressResponse = {
  planId: number;
  /** dough_prep batch completions (balls) recorded against the plan. */
  ballsRecorded: number;
  mixes: SavedDoughMix[];
};

/** Shared by the Dough Prep station and the dashboard tile, so a tick on the
 *  station refreshes the tile's cache too. */
export const doughMixProgressKey = (planId: number) => ["dough-mix-progress", planId] as const;

export async function fetchDoughMixProgress(planId: number, signal?: AbortSignal): Promise<DoughMixProgressResponse> {
  const res = await guardedFetch(`/api/dough-mix-progress/${planId}`, { signal });
  return (await res.json()) as DoughMixProgressResponse;
}
