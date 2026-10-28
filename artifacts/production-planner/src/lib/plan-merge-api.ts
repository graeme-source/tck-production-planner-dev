/**
 * One production plan per day (Graeme, 2026-10-28): when Create Plan is saved
 * for a day that already has a fried-chicken-only (or mac-cheese-only) plan,
 * the calzones go INTO that plan via POST /api/plan-merge/:planId instead of
 * making a second plan. The rule for which plan to merge into is
 * pickMergeTarget in @workspace/production-schedule (tested).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getGetProductionPlanQueryKey, getListProductionPlansQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface PlanMergeBody {
  planDate: string;
  prepDate: string | null;
  doughDate: string | null;
  name: string;
  notes?: string;
  status: "draft" | "active";
  items: Array<{
    recipeId: number;
    orderPosition: number;
    batchesTarget: number;
    tinSize?: string;
    maxBatchesPerTin?: number;
    sopUrl?: string;
  }>;
}

export interface PlanMergeResult {
  id: number;
  name: string;
  status: string;
  merged: true;
  addedCount: number;
  skippedRecipeIds: number[];
}

export function useMergeIntoDayPlan() {
  const queryClient = useQueryClient();
  return useMutation<PlanMergeResult, Error, { planId: number; data: PlanMergeBody }>({
    mutationFn: async ({ planId, data }) => {
      const res = await fetch(`${BASE}/api/plan-merge/${planId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `Couldn't add to that day's plan (${res.status})`);
      return body as PlanMergeResult;
    },
    onSuccess: (_r, { planId }) => {
      queryClient.invalidateQueries({ queryKey: getListProductionPlansQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) });
    },
  });
}
