import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { guardedFetch } from "@/hooks/use-guarded-action";
import { ClientError } from "@/lib/with-retry";
import { toast } from "@/hooks/use-toast";
import { applyDoughMixChange, type DoughMixChange, type SavedDoughMix } from "@/lib/dough-mix-status";

/** GET/PUT /api/dough-mix-progress/:planId (api-server routes/dough-mix-progress.ts).
 *  dough = "day_before" (the calzone dough; planId = the plan it is FOR, the
 *  station's tracking plan) or "same_day:<subRecipeId>" (a dough made on the
 *  production day; planId = the plan it's baked for). */
export type DoughMixProgressResponse = {
  planId: number;
  dough?: string;
  /** dough_prep batch completions (balls) recorded against the plan — day-before dough only. */
  ballsRecorded: number;
  mixes: SavedDoughMix[];
};

export const DAY_BEFORE_DOUGH = "day_before";
export const sameDayDoughKey = (subRecipeId: number) => `same_day:${subRecipeId}`;

/** Shared by the Dough Prep station and the dashboard tile, so a tick on the
 *  station refreshes the tile's cache too. */
export const doughMixProgressKey = (planId: number, dough: string = DAY_BEFORE_DOUGH) =>
  ["dough-mix-progress", planId, dough] as const;

export async function fetchDoughMixProgress(planId: number, signal?: AbortSignal, dough: string = DAY_BEFORE_DOUGH): Promise<DoughMixProgressResponse> {
  const qs = dough === DAY_BEFORE_DOUGH ? "" : `?dough=${encodeURIComponent(dough)}`;
  const res = await guardedFetch(`/api/dough-mix-progress/${planId}${qs}`, { signal });
  return (await res.json()) as DoughMixProgressResponse;
}

export type MixSaveState = "idle" | "saving" | "saved" | "error";

/** Saved mix progress for one dough on one plan: polled so other iPads'
 *  ticks appear, saved one change at a time with an optimistic update, and
 *  a visible save state ("Saving…" / "Saved" / "Not saved — retry"). */
export function useDoughMixProgress(planId: number, opts: { dough?: string; enabled: boolean }) {
  const dough = opts.dough ?? DAY_BEFORE_DOUGH;
  const queryClient = useQueryClient();
  const key = doughMixProgressKey(planId, dough);
  const mutationKey = ["dough-mix-progress-save", planId, dough];
  const query = useQuery({
    queryKey: key,
    enabled: opts.enabled,
    refetchInterval: 5000,
    queryFn: ({ signal }) => fetchDoughMixProgress(planId, signal, dough),
  });
  const [saveState, setSaveState] = useState<MixSaveState>("idle");
  const [failed, setFailed] = useState<DoughMixChange | null>(null);
  const mutation = useMutation({
    mutationKey,
    mutationFn: async (change: DoughMixChange) => {
      const body = dough === DAY_BEFORE_DOUGH ? change : { ...change, dough };
      const res = await guardedFetch(`/api/dough-mix-progress/${planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await res.json()) as DoughMixProgressResponse;
    },
    onMutate: async (change) => {
      setSaveState("saving");
      setFailed(null);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<DoughMixProgressResponse>(key);
      queryClient.setQueryData<DoughMixProgressResponse>(key, old => ({
        planId,
        dough,
        ballsRecorded: old?.ballsRecorded ?? 0,
        mixes: applyDoughMixChange(old?.mixes ?? [], change, new Date().toISOString()),
      }));
      return { prev };
    },
    onError: (err, change, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      setSaveState("error");
      setFailed(change);
      // 423 = PIN due: the PIN pad is already up, a toast would only confuse.
      if (!(err instanceof ClientError && err.status === 423)) {
        toast({ title: "Mix tick not saved", description: `${err.message} — tap "Not saved — retry".`, variant: "destructive" });
      }
    },
    onSuccess: (data) => {
      // Only the last save in flight writes its answer, so a quick second
      // tick isn't briefly undone by the first one's reply.
      if (queryClient.isMutating({ mutationKey }) <= 1) {
        queryClient.setQueryData(key, data);
        setSaveState("saved");
      }
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey }) <= 1) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
  return {
    data: query.data,
    isSuccess: query.isSuccess,
    saveState,
    save: (change: DoughMixChange) => mutation.mutate(change),
    retry: failed ? () => mutation.mutate(failed) : undefined,
  };
}
