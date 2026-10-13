import React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { CalendarCheck, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { PrepRequirementItem } from "@workspace/api-client-react";
import { packNoun, formatPackSize, formatPrepWeight } from "@workspace/units";

export function fmtQty(q: number | string, unit: string): string {
  // Defensive coercion: pgNumeric columns come back as strings ("2.2700"),
  // and several callers pass packWeight / quantity straight from the API
  // without converting. Without this coerce, .toFixed crashes the page.
  const n = typeof q === "number" ? q : Number(q);
  const safe = Number.isFinite(n) ? n : 0;
  // Weights always render as kg with 3 decimals, regardless of whether the
  // ingredient is stored in g or kg. Keeps the prep sheet visually consistent
  // across ingredients that happen to be saved in different base units, and
  // makes like-for-like comparisons obvious at a glance (e.g. sub-recipe
  // components where one is saved in g and another in kg).
  if (unit === "g") return `${(safe / 1000).toFixed(3)} kg`;
  if (unit === "kg") return `${safe.toFixed(3)} kg`;
  // Volumes always render as litres with 3 decimals for the same reason.
  if (unit === "ml") return `${(safe / 1000).toFixed(3)} l`;
  if (unit === "l" || unit === "L") return `${safe.toFixed(3)} l`;
  // Legacy "pcs" and "each" both mean piece counts — render them the same
  // way as "pieces" so the prep sheet doesn't expose internal naming drift.
  if (unit === "pieces" || unit === "pcs" || unit === "each") {
    const r = Math.round(safe);
    return `${r} ${r === 1 ? "piece" : "pieces"}`;
  }
  return `${safe % 1 === 0 ? safe : safe.toFixed(2)} ${unit}`;
}

/** Amounts the prep room WEIGHS: grams under 1 kg, kg above, litres converted
 *  at 1 g/ml — never litres (Graeme, 2026-09-29). fmtQty stays for stock
 *  counts and orders, where bottles/litres are how things are bought. */
export const fmtPrepQty = formatPrepWeight;

export const toKg = (qty: number, unit: string): number =>
  unit === "g" ? qty / 1000 : unit === "mg" ? qty / 1_000_000 : qty;

// Pack/bottle label ("pack" / "bottles" …) — lives in @workspace/units so
// the server, the Orders page and the stations share one copy.
export { packNoun };

// Descriptive pack label including the pack size, e.g. "2.27 kg packs" or
// "1 L bottle". Used in stock-check prompts so operators can tell at a glance
// what each pack actually contains, instead of just "packs".
export function packDescriptor(unit: string, packWeight: number | string | null | undefined, count: number): string {
  // If `unit` is itself a pack-counted unit (e.g. a PO line stored with
  // unit="packs" or "bottles"), we don't know the native weight unit — so
  // just return "packs" / "bottles" rather than "1 packs packs". Callers
  // that do have the native unit should reach for packSizeHint instead.
  if (unit === "packs" || unit === "bottles") return packNoun(unit, count);
  const noun = packNoun(unit, count);
  // Some endpoints return pgNumeric as a string ("2.2700") — coerce so the
  // formatter doesn't blow up on `.toFixed`. Treats non-numeric input as missing.
  const pw = packWeight == null ? null : Number(packWeight);
  if (pw == null || !Number.isFinite(pw) || pw <= 0) return noun;
  // Reuse fmtQty so weights/volumes get normalised the same way the rest of
  // the prep sheet displays them (kg/L with 3 decimals, ml→L, etc.).
  const sized = fmtQty(pw, unit);
  return `${sized} ${noun}`;
}

// Pack-size formatter at the most natural scale ("500g", "2.27 kg", "5 L",
// "36 each") — lives in @workspace/units (formatPackSize) so the Orders page
// and the server share one copy.
export const fmtPackSize = formatPackSize;

// Compact "<size> per pack" / "<size> per bottle" suffix used as small grey
// secondary text next to a pack-count input or pill. Returns null when the
// pack size is missing/invalid so the caller can skip rendering entirely.
export function packSizeHint(
  packWeight: number | string | null | undefined,
  nativeUnit: string,
): string | null {
  const pw = packWeight == null ? NaN : Number(packWeight);
  if (!Number.isFinite(pw) || pw <= 0) return null;
  return `${fmtPackSize(pw, nativeUnit)} per ${packNoun(nativeUnit, 1)}`;
}

// Render a PO line quantity in two parts: a primary "<count> pack(s)" label
// and an optional "<size> per pack" descriptor for smaller secondary text.
// Handles both storage shapes — lines whose unit is already "packs"/"bottles"
// (the quantity IS the pack count) and lines stored in native units (kg/g/
// ml/l) where the count is derived by dividing by packWeight.
export function formatLineQtyParts(
  qty: number,
  lineUnit: string,
  nativeUnit: string | null | undefined,
  packWeight: number | string | null | undefined,
  stockInPacks: boolean | null | undefined,
): { primary: string; descriptor: string | null } {
  const pw = packWeight == null ? NaN : Number(packWeight);
  const hasPackSize = Number.isFinite(pw) && pw > 0;
  const lineIsPackUnit = lineUnit === "packs" || lineUnit === "bottles";
  const native = nativeUnit ?? lineUnit;
  const buildDescriptor = (count: number) =>
    `${fmtPackSize(pw, native)} per ${packNoun(native, 1)}`;
  if (lineIsPackUnit && hasPackSize) {
    return {
      primary: `${qty} ${packNoun(native, qty)}`,
      descriptor: buildDescriptor(qty),
    };
  }
  if (stockInPacks && hasPackSize) {
    // 2 dp, not whole packs — part-packs (0.5 of a box) are a real count.
    const count = Math.round((qty / pw) * 100) / 100;
    return {
      primary: `${count} ${packNoun(native, count)}`,
      descriptor: buildDescriptor(count),
    };
  }
  return { primary: `${qty} ${lineUnit}`, descriptor: null };
}

// Single-line variant for callers that don't have separate styling for the
// pack-size descriptor. Built on top of formatLineQtyParts.
export function formatLineQty(
  qty: number,
  lineUnit: string,
  nativeUnit: string | null | undefined,
  packWeight: number | string | null | undefined,
  stockInPacks: boolean | null | undefined,
): string {
  const { primary, descriptor } = formatLineQtyParts(qty, lineUnit, nativeUnit, packWeight, stockInPacks);
  return descriptor ? `${primary} (${descriptor})` : primary;
}

// Given a native-unit stock value and the ingredient's packWeight, return
// how many packs that represents. Rounded to 2 dp, NOT whole packs — the
// team records part-packs (0.5 of a box) and whole-pack rounding both
// displayed them wrong and clobbered the value on prefill-then-save.
// Returns null if the ingredient can't be expressed in packs.
export function nativeToPackCount(nativeQty: number, packWeight: number | null | undefined): number | null {
  if (packWeight == null || packWeight <= 0) return null;
  return Math.round((nativeQty / packWeight) * 100) / 100;
}

// Convert a whole-pack count back to native units for storage. Keeps the
// stock table in the same units the recipe costing layer already expects,
// so the pack flag stays a pure UI concern.
export function packsToNative(packs: number, packWeight: number | null | undefined): number {
  if (packWeight == null || packWeight <= 0) return 0;
  return packs * packWeight;
}

// Light-grey secondary label for stock-check UIs showing pack-based values.
// Given a pack count + packWeight + native unit, returns a string like
// "≈ 3.000 L" that the UI renders next to "3 bottles" so the operator
// double-checks they're counting the right thing. Returns an empty string
// when there's nothing useful to show (0 packs / missing pack size).
export function packsWeightHint(
  packCount: number,
  packWeight: number | null | undefined,
  nativeUnit: string,
): string {
  if (!Number.isFinite(packCount) || packCount <= 0) return "";
  if (packWeight == null || packWeight <= 0) return "";
  return `≈ ${fmtQty(packCount * packWeight, nativeUnit)}`;
}

export function PrepIngredientTable({ items }: { items: PrepRequirementItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <p className="font-medium">No ingredients to display</p>
        <p className="text-sm mt-1">Make sure ingredient categories are set in the ingredients library</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/20 border-b border-border">
            <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Ingredient</th>
            <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Recipes</th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">
              <span>Prep Qty</span>
              <span className="block text-[10px] font-normal opacity-60">weigh this</span>
            </th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Reference</th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Trays</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const hasProcLoss = item.processingRatio != null && item.processingRatio < 1;
            const mode = (item as { prepWeightMode?: string }).prepWeightMode ?? "raw";
            const prepQty = (item as { prepQty?: number }).prepQty ?? item.totalRawQty;
            const refQty = mode === "processed" ? item.totalRawQty : item.totalCookedQty;
            const refLabel = mode === "processed" ? "raw" : "cooked";
            return (
              <tr key={item.ingredientId} className="border-b border-border/50 last:border-0">
                <td className="py-3 px-4 font-medium">
                  {item.ingredientName}
                  {hasProcLoss && (
                    <span className={cn("ml-1.5 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                      mode === "processed"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    )}>
                      {mode === "processed" ? "processed wt" : "raw wt"}
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-muted-foreground text-xs">{item.recipes.join(", ")}</td>
                <td className="py-3 px-4 text-right tabular-nums font-bold text-base">
                  {fmtPrepQty(prepQty, item.unit)}
                </td>
                <td className="py-3 px-4 text-right tabular-nums text-muted-foreground text-xs">
                  {hasProcLoss ? (
                    <>
                      {fmtPrepQty(refQty, item.unit)} {refLabel}
                      <span className="ml-1">({((item.processingRatio ?? 1) * 100).toFixed(0)}%)</span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  {item.trayCount != null ? (
                    <span className="font-bold text-base text-rose-600 dark:text-rose-400">{item.trayCount}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface NextActivePlan {
  planId: number | null;
  planDate: string | null;
  planName: string | null;
  prepDate: string | null;
  doughDate: string | null;
  status: string | null;
  sameDayPlans?: Array<{ planId: number; planName: string }>;
}

// `forKind` selects which date column /next-active walks. Prep stations
// pass "prep" so a plan whose prep_date is overridden surfaces on the
// scheduled prep day, not the previous business day. Dough stations pass
// "dough". Defaults to "plan" so any caller that doesn't opt in keeps
// the legacy plan_date behaviour — important so a missed migration on a
// new caller doesn't silently shift the prep team to the wrong plan.
export function useNextActivePlan(afterDate?: string, forKind: "plan" | "prep" | "dough" = "plan") {
  const [data, setData] = useState<NextActivePlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setIsLoading(true);
    const params = new URLSearchParams();
    if (afterDate) params.set("afterDate", afterDate);
    if (forKind !== "plan") params.set("for", forKind);
    const qs = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/production-plans/next-active${qs}`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then((json: NextActivePlan) => { setData(json); initialLoadDone.current = true; setIsLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setIsLoading(false); } });
  }, [afterDate, forKind]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch]);

  return { data, isLoading };
}

export function PrepDateBanner({
  currentPlanDate,
  targetPlanDate,
  targetPlanName,
  isLoading,
  activityLabel = "Prep",
}: {
  currentPlanDate?: string | null;
  targetPlanDate: string | null;
  targetPlanName: string | null;
  isLoading: boolean;
  activityLabel?: string;
}) {
  if (isLoading) return null;
  if (!targetPlanDate) return null;

  const targetFormatted = format(parseISO(targetPlanDate), "EEEE d MMMM");
  const currentFormatted = currentPlanDate
    ? format(parseISO(currentPlanDate), "EEEE d MMMM")
    : null;

  return (
    <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <CalendarCheck className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0" />
      <div className="min-w-0">
        {currentFormatted ? (
          <>
            <p className="font-bold text-green-900 dark:text-green-100 text-lg leading-snug">
              {activityLabel} on {currentFormatted}
            </p>
            <p className="text-sm text-green-700 dark:text-green-300 leading-snug">
              for production on <span className="font-semibold">{targetFormatted}</span>
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">{activityLabel} for</p>
            <p className="font-bold text-green-900 dark:text-green-100 text-lg leading-tight">{targetFormatted}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PrepDraftBanner — shown above prep stations when the next upcoming plan is
// still in draft status. The prep crew can see all prep data but completions
// are blocked (both in the UI and at the API) until the plan is activated.
// ──────────────────────────────────────────────────────────────────────────────
export function PrepDraftBanner({
  planId,
  planDate,
  planName,
  onActivated,
}: {
  planId: number;
  planDate: string;
  planName?: string | null;
  onActivated?: () => void;
}) {
  const [activating, setActivating] = useState(false);
  const dateLabel = format(parseISO(planDate), "EEE d MMM");

  const activate = async () => {
    setActivating(true);
    try {
      const res = await fetch(`/api/production-plans/${planId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      toast({ title: "Plan activated", description: `${planName ?? "Plan"} is now active — you can start prepping.` });
      onActivated?.();
    } catch (e) {
      toast({
        title: "Failed to activate plan",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-center gap-3">
      <AlertTriangle className="w-7 h-7 text-amber-600 dark:text-amber-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-amber-900 dark:text-amber-200 text-base leading-tight">
          Draft plan — activate before starting prep
        </h3>
        <p className="text-sm text-amber-800 dark:text-amber-300 leading-snug mt-0.5">
          {planName ?? "This plan"} ({dateLabel}) is still a draft. You can see what's needed below,
          but completions are locked until it's activated. Batch numbers may still change while draft.
        </p>
      </div>
      <button
        onClick={activate}
        disabled={activating}
        className="px-4 py-2 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50 flex-shrink-0 whitespace-nowrap"
      >
        {activating ? "Activating…" : "Activate now"}
      </button>
    </div>
  );
}

/** Shared toast helper for stations blocking actions when the plan is draft. */
export function toastDraftBlocked() {
  toast({
    title: "Plan is a draft",
    description: "Activate the plan before recording completions.",
    variant: "destructive",
  });
}

// StockCheckStatusPanel moved to ./stock-check-status-panel.tsx (prep
// stock-check alarm, Graeme 13 Oct 2026).
