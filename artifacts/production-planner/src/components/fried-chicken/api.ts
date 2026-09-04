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

/** One line on the sheet. `children` is present on a mix that is made in bulk
 *  (the Marinade Spice Mix) — the total is what you need, the breakdown is
 *  what you need only when you're making more of it. */
export interface PrepItem {
  name: string;
  unit: string;
  qty: number;
  children?: Array<{ name: string; unit: string; qty: number }>;
}

/** A step of the job — the chicken, the breading tub, the marinade bottle,
 *  the oil, the Korean sauce — in the order they're done. */
export interface PrepSection {
  key: string;
  title: string;
  totalQty: number;
  unit: string;
  done: boolean;
  items: PrepItem[];
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
  sections: PrepSection[];
  ingredients: Array<{ name: string; unit: string; qty: number; category: string | null }>;
}

export function useFriedChickenPrep(planId: number | null, enabled = true) {
  return useQuery<PrepSheet>({
    queryKey: ["fried-chicken", "prep", planId],
    queryFn: () => friedChickenFetch<PrepSheet>(`/plans/${planId}/prep`),
    enabled: enabled && planId != null,
  });
}

export function setFriedChickenPrepTick(planId: number, stepKey: string, done: boolean) {
  return friedChickenFetch<{ stepKey: string; done: boolean }>(`/plans/${planId}/prep-tick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stepKey, done }),
  });
}

/** Runs whose PREP day falls in [from, to] — the production-plans calendar's
 *  "Fried Chicken prep day for …" cards, mirroring the dough-day ones. */
export interface FriedChickenPrepDayRow {
  planId: number;
  planName: string;
  planDate: string;
  prepDate: string;
  packs: number;
}

export function useFriedChickenPrepDays(from: string | null, to: string | null) {
  return useQuery<FriedChickenPrepDayRow[]>({
    queryKey: ["fried-chicken", "prep-days", from, to],
    queryFn: () => friedChickenFetch<FriedChickenPrepDayRow[]>(
      `/prep-days?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`,
    ),
    enabled: !!from && !!to,
    staleTime: 60_000,
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
      /** The plan sitting ON the prep day, if one exists — prep is shown
       *  there, not on the run's plan. */
      prepPlanId: number | null;
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

export interface PriorSubmission {
  at: string;
  by: number | null;
  bags: number;
}

export interface SubmitStockResult {
  dryRun: boolean;
  planId: number;
  adjustments: StockAdjustment[];
  /** Set on a dry run when this plan's stock has already gone once. */
  alreadySubmitted?: PriorSubmission | null;
  /** Bags that actually landed in Shopify on a confirmed run. */
  bagsSent?: number;
  resent?: boolean;
}

export function submitFriedChickenStock(
  planId: number,
  opts: { confirm: boolean; force?: boolean },
) {
  return friedChickenFetch<SubmitStockResult>(`/plans/${planId}/submit-stock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: opts.confirm, force: opts.force === true }),
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
