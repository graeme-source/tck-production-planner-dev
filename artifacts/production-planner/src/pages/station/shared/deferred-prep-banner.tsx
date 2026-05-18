import { useState, useEffect, useCallback, useRef } from "react";
import { Clock3, CheckCircle2, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { fmtQty } from "./prep-helpers";

// ──────────────────────────────────────────────────────────────────────────────
// DeferredPrepBanner
// ──────────────────────────────────────────────────────────────────────────────
//
// Shows prep tins that were deferred from a prior prep session and are now
// owed today. Same list, shown in two places:
//   - Main prep page (no category filter): all deferred items across stations
//   - Macaroni Cheese station (category="Macaroni Cheese"): only mac cheese
//
// Single source of truth — ticking a deferred item here calls the existing
// /:id/prep-completions POST against the SOURCE plan, so the completion shows
// up on Friday's prep view as ticked (clearing the deferral from the
// outstanding list) without any duplicate tracking.
//
// Hidden entirely when the list is empty so the banner doesn't take any
// vertical space on quiet days.
// ──────────────────────────────────────────────────────────────────────────────

export interface DeferredPrepItem {
  id: number;
  sourcePlanId: number;
  sourcePlanDate: string;
  sourcePlanName: string | null;
  ingredientId: number;
  isSubRecipe: boolean;
  subRecipeOriginId: number | null;
  recipeId: number;
  recipeName: string | null;
  recipeCategory: string | null;
  recipeColor: string | null;
  tinNumber: number;
  tinCount: number | null;
  qtyPerTin: number | null;
  deferredToDate: string;
  deferredAt: string;
  deferredByUserId: number | null;
  deferredByUserName: string | null;
  itemName: string | null;
  itemUnit: string | null;
}

export function DeferredPrepBanner({
  category,
  onResolved,
}: {
  /** Optional recipe category filter (e.g. "Macaroni Cheese"). When omitted,
   *  the banner shows every outstanding deferred item across all stations. */
  category?: string;
  /** Fires after a tick succeeds so the parent can invalidate its own data
   *  (e.g. main-prep refetch) if it cares about the source plan's progress. */
  onResolved?: () => void;
}) {
  const [items, setItems] = useState<DeferredPrepItem[] | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [runAction] = useGuardedAction();

  const fetchItems = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    fetch(`/api/production-plans/prep-deferrals/outstanding?${params.toString()}`, {
      credentials: "include",
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch(e => { if (e.name !== "AbortError") setItems([]); });
  }, [category]);

  useEffect(() => {
    fetchItems();
    // Same 5s cadence as the main-prep page so a Friday tick on the source
    // plan clears the banner here within one refresh tick.
    const interval = setInterval(fetchItems, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [fetchItems]);

  const handleTick = async (item: DeferredPrepItem) => {
    setPendingId(item.id);
    try {
      await runAction(async (signal) => {
        await guardedFetch(`/api/production-plans/${item.sourcePlanId}/prep-completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ingredientId: item.ingredientId,
            recipeId: item.recipeId,
            tinNumber: item.tinNumber,
            isSubRecipe: item.isSubRecipe,
            subRecipeOriginId: item.subRecipeOriginId,
          }),
          signal,
        });
      });
      // Optimistic: drop the row immediately so the kitchen sees instant
      // feedback. The 5s poll will reconcile if the POST silently failed
      // (it would re-appear).
      setItems(prev => prev?.filter(i => i.id !== item.id) ?? null);
      toast({ title: "Marked complete", description: `${item.itemName ?? "Item"} ticked off.` });
      onResolved?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to mark complete";
      toast({ title: "Couldn't tick off", description: msg, variant: "destructive" });
      // Pull fresh state in case the row state diverged.
      fetchItems();
    } finally {
      setPendingId(null);
    }
  };

  // Hidden entirely when nothing is outstanding — the banner shouldn't take
  // any space on quiet days.
  if (items == null || items.length === 0) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Clock3 className="w-7 h-7 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="text-left min-w-0">
            <p className="font-bold text-amber-900 dark:text-amber-100 text-lg leading-tight">
              {items.length} deferred {items.length === 1 ? "item" : "items"} to prep today
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300 leading-snug">
              Pushed from earlier prep sessions — tap to {collapsed ? "expand" : "collapse"}
            </p>
          </div>
        </div>
        {collapsed ? (
          <ChevronDown className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        ) : (
          <ChevronUp className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        )}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-4 border-t border-amber-200 dark:border-amber-800 pt-3">
          {/* Group by recipe so a recipe with multiple deferred ingredients
              gets a single header (cleaner than repeating the recipe name on
              every tile). Inside each group, render tin tiles that mirror the
              main-prep station's prep-tile layout: tin label at top, qty in
              the middle in big font, tap-the-tile to mark done. */}
          {Object.entries(
            items.reduce<Record<string, { recipeName: string; recipeColor: string | null; items: DeferredPrepItem[] }>>((acc, item) => {
              // Group key matches the per-tile disambiguation rules in
              // main-prep — same recipe + ingredient + sub-recipe origin =
              // one tile cluster, so a row's tile order matches the source
              // plan exactly.
              const groupKey = `${item.recipeId}_${item.ingredientId}_${item.isSubRecipe ? "s" : "i"}_${item.subRecipeOriginId ?? "x"}`;
              if (!acc[groupKey]) {
                acc[groupKey] = {
                  recipeName: item.recipeName ?? "Recipe",
                  recipeColor: item.recipeColor,
                  items: [],
                };
              }
              acc[groupKey].items.push(item);
              return acc;
            }, {})
          ).map(([groupKey, group]) => {
            // All tiles within a group share the same ingredient / unit /
            // recipe — sort by tin number so they read in natural order.
            const sorted = [...group.items].sort((a, b) => a.tinNumber - b.tinNumber);
            const first = sorted[0];
            const sourceLabel = first.sourcePlanDate
              ? format(parseISO(first.sourcePlanDate), "EEE d MMM")
              : "";
            return (
              <div key={groupKey}>
                {/* Recipe + ingredient header — mirrors the main-prep recipe-
                    row label so the operator instantly recognises the layout. */}
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg mb-2 bg-amber-100/60 dark:bg-amber-900/30">
                  <div className="flex items-center gap-2 min-w-0">
                    {group.recipeColor && (
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: group.recipeColor }}
                      />
                    )}
                    <p className="text-lg font-semibold truncate text-amber-900 dark:text-amber-100">
                      {first.itemName ?? "Item"}{" "}
                      <span className="text-amber-700 dark:text-amber-300 font-normal">·</span>{" "}
                      <span className="text-amber-700 dark:text-amber-300 font-normal">{group.recipeName}</span>
                    </p>
                  </div>
                  <span className="text-sm text-amber-700 dark:text-amber-300 ml-2 flex-shrink-0">
                    {formatMetaLabel(sorted.length, first.tinCount, sourceLabel)}
                  </span>
                </div>
                {/* Tin tile grid — same column layout as main-prep so a
                    finger trained on Friday's prep finds Monday's tiles in
                    the same place. */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                  {sorted.map(item => {
                    const isPending = pendingId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleTick(item)}
                        disabled={isPending}
                        className={cn(
                          "relative flex flex-col items-center border-2 rounded-2xl px-3 py-4 transition-all active:scale-95",
                          "bg-background border-amber-300 dark:border-amber-700",
                          "hover:border-emerald-400 hover:shadow-md",
                          isPending && "opacity-60 cursor-wait"
                        )}
                      >
                        <div className="flex items-center gap-1.5 mb-2">
                          {isPending ? (
                            <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                          ) : (
                            <Clock3 className="w-5 h-5 text-amber-600" />
                          )}
                          <span className="text-xl font-bold">Tin {item.tinNumber}</span>
                        </div>
                        {item.qtyPerTin != null && item.itemUnit ? (
                          <span className="text-3xl font-bold tabular-nums text-foreground">
                            {fmtQty(item.qtyPerTin, item.itemUnit)}
                          </span>
                        ) : (
                          <span className="text-base font-medium text-muted-foreground italic">
                            quantity n/a
                          </span>
                        )}
                        <span className="text-sm text-emerald-700 dark:text-emerald-400 mt-1.5 leading-tight text-center font-semibold">
                          Tap when done
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Small helper to keep the JSX above tidy. Builds the "3 tins · from Fri 22 Aug"
// subtitle for the recipe-row header inside the banner.
function formatMetaLabel(numTins: number, totalTins: number | null, sourceLabel: string): string {
  const parts: string[] = [];
  parts.push(
    totalTins != null
      ? `${numTins}/${totalTins} ${numTins === 1 ? "tin" : "tins"}`
      : `${numTins} ${numTins === 1 ? "tin" : "tins"}`
  );
  if (sourceLabel) parts.push(`from ${sourceLabel} prep`);
  return parts.join(" · ");
}
