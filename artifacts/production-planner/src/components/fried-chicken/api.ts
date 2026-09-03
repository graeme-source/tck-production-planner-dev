/**
 * The fried chicken endpoints, in one place.
 *
 * Three screens talk to routes/fried-chicken.ts — the planning dialog, the
 * prep sheet and the count sheet's stock submission — so the query keys and
 * response shapes live here rather than being written out three times and
 * drifting apart.
 */
import { useQuery } from "@tanstack/react-query";
import type { SuggestionVariant } from "./plan-rows";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function friedChickenFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/fried-chicken${path}`, { credentials: "include", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

export interface Suggestion {
  rawKg: number;
  defaultKg: number;
  oilKg: number;
  totalPacks: number;
  kgUsed: number;
  kgSpare: number;
  /** Recipes with no Shopify link — no stock, no sales, so the maths can't
   *  see them. Said out loud rather than treated as zero. */
  unmapped: string[];
  /** Recipes whose ingredients resolve to no raw meat at all. */
  noMeat: string[];
  variants: SuggestionVariant[];
}

export function useFriedChickenSuggestion(rawKg: number | null, enabled: boolean) {
  return useQuery<Suggestion>({
    queryKey: ["fried-chicken", "suggestion", rawKg],
    queryFn: () => friedChickenFetch<Suggestion>(
      rawKg && rawKg > 0 ? `/suggestion?rawKg=${encodeURIComponent(rawKg)}` : "/suggestion",
    ),
    enabled,
    // Shopify stock and trailing sales move slowly; the run is planned once.
    staleTime: 60_000,
  });
}

export interface PrepSheet {
  planId: number;
  planName: string;
  planDate: string;
  packs: number;
  bags: Array<{ recipeName: string; packs: number }>;
  rawMeatKg: number;
  oilOnSiteKg: number;
  oilKgPerKgChicken: number;
  ingredients: Array<{ name: string; unit: string; qty: number; category: string | null }>;
}

export function useFriedChickenPrep(planId: number | null, enabled = true) {
  return useQuery<PrepSheet>({
    queryKey: ["fried-chicken", "prep", planId],
    queryFn: () => friedChickenFetch<PrepSheet>(`/plans/${planId}/prep`),
    enabled: enabled && planId != null,
  });
}

export type NextRun =
  | { found: false }
  | {
      found: true;
      planId: number;
      planName: string;
      planDate: string;
      prepDate: string;
      packs: number;
      isPrepDay: boolean;
      isRunDay: boolean;
    };

export function useNextFriedChickenRun(after: string | null) {
  return useQuery<NextRun>({
    queryKey: ["fried-chicken", "next-run", after],
    queryFn: () => friedChickenFetch<NextRun>(`/next-run?after=${encodeURIComponent(after!)}`),
    enabled: !!after,
    staleTime: 60_000,
  });
}

export interface StockAdjustment {
  recipeName: string;
  variantId: string | null;
  made: number;
  target: number;
  result?: string;
  newQuantity?: number;
}

export interface SubmitStockResult {
  dryRun: boolean;
  planId: number;
  adjustments: StockAdjustment[];
}

export function submitFriedChickenStock(planId: number, confirm: boolean) {
  return friedChickenFetch<SubmitStockResult>(`/plans/${planId}/submit-stock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm }),
  });
}

export function saveFriedChickenItems(
  planId: number,
  rawKg: number,
  items: Array<{ recipeId: number; packs: number }>,
) {
  return friedChickenFetch<{ ok: true; itemsKept: number; notRemoved: number[] }>(
    `/plans/${planId}/items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawKg, items }),
    },
  );
}
