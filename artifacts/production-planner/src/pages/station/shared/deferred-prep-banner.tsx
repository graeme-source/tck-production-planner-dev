import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Clock3, Loader2, ChevronDown, ChevronUp, ChevronRight, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { usePrepSessionCapture, type PrepSessionStation } from "@/hooks/use-prep-session-capture";
import { fmtPrepQty } from "./prep-helpers";
import { RecipeSwatch } from "@/components/recipe-swatch";
import {
  deferredPrepItemOf, groupDeferredPrep,
  type DeferredPrepGroup, type DeferredPrepItem,
} from "./deferred-prep-groups";

export type { DeferredPrepItem } from "./deferred-prep-groups";

// ──────────────────────────────────────────────────────────────────────────────
// DeferredPrepBanner
// ──────────────────────────────────────────────────────────────────────────────
//
// Shows prep tins that were deferred from a prior prep session and are now
// owed today. Same list, shown in two places:
//   - Main prep page (no category filter): all deferred items across stations
//   - Macaroni Cheese station (category="Macaroni Cheese"): only mac cheese
//
// The list says WHAT is owed (item, recipe, which day's prep) — no amounts.
// Tapping a card opens the item: its tins with the amounts, big, and each
// tin is ticked there (Graeme, 27 Oct 2026: "no completing prep without
// opening the item"). Opening is also what the invisible prep timing
// records (hooks/use-prep-session-capture.ts; nothing about it is shown).
//
// Single source of truth — ticking a deferred tin calls the existing
// /:id/prep-completions POST against the SOURCE plan, so the completion shows
// up on Friday's prep view as ticked (clearing the deferral from the
// outstanding list) without any duplicate tracking.
//
// Hidden entirely when the list is empty so the banner doesn't take any
// vertical space on quiet days.
// ──────────────────────────────────────────────────────────────────────────────

const sourceDayLabel = (date: string) => (date ? format(parseISO(date), "EEE d MMM") : "");

export function DeferredPrepBanner({
  category,
  onResolved,
  station = "main_prep",
}: {
  /** Optional recipe category filter (e.g. "Macaroni Cheese"). When omitted,
   *  the banner shows every outstanding deferred item across all stations. */
  category?: string;
  /** Fires after a tick succeeds so the parent can invalidate its own data
   *  (e.g. main-prep refetch) if it cares about the source plan's progress. */
  onResolved?: () => void;
  /** The screen showing the banner — context on the prep timing only. */
  station?: PrepSessionStation;
}) {
  const [items, setItems] = useState<DeferredPrepItem[] | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
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
      .then(r => {
        if (!r.ok) throw new Error(`Deferred prep not loaded (${r.status})`);
        return r.json();
      })
      .then(d => setItems(Array.isArray(d?.items) ? d.items : []))
      // A failed refresh keeps what's on screen — an item someone has open
      // shouldn't vanish on one dropped poll. First load failing = nothing.
      .catch(e => { if (e.name !== "AbortError") setItems(prev => prev ?? []); });
  }, [category]);

  useEffect(() => {
    fetchItems();
    // Same 5s cadence as the main-prep page so a Friday tick on the source
    // plan clears the banner here within one refresh tick.
    const interval = setInterval(fetchItems, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [fetchItems]);

  const groups = useMemo(() => groupDeferredPrep(items ?? []), [items]);
  const openGroup = openKey ? groups.find(g => g.key === openKey) ?? null : null;

  // The opened item's last tin is done (here, or by someone else): it closes.
  useEffect(() => {
    if (openKey && items != null && !openGroup) setOpenKey(null);
  }, [openKey, openGroup, items]);

  /** `afterSave` runs once the tick is saved, before the tin leaves the list. */
  const handleTick = async (item: DeferredPrepItem, afterSave?: () => void) => {
    setPendingId(item.id);
    try {
      const saved = await runAction(async (signal) => {
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
        return true;
      });
      // Not saved: the guard has already said why (or the PIN pad is up).
      // Pull fresh state in case the row state diverged.
      if (!saved) { fetchItems(); return; }
      afterSave?.();
      // Optimistic: drop the tin immediately so the kitchen sees instant
      // feedback. The 5s poll reconciles.
      setItems(prev => prev?.filter(i => i.id !== item.id) ?? null);
      toast({ title: "Marked complete", description: `${item.itemName ?? "Item"} ticked off.` });
      onResolved?.();
    } finally {
      setPendingId(null);
    }
  };

  // Hidden entirely when nothing is outstanding — the banner shouldn't take
  // any space on quiet days.
  if (items == null || groups.length === 0) return null;

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
              {groups.length} deferred {groups.length === 1 ? "item" : "items"} to prep today
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
        // One card per item per recipe per source day. No amounts here —
        // they're inside the opened item.
        <div className="px-3 pb-3 pt-3 border-t border-amber-200 dark:border-amber-800 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {groups.map(group => {
            const sourceLabel = sourceDayLabel(group.sourcePlanDate);
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => setOpenKey(group.key)}
                className="flex items-center gap-3 text-left bg-background border-2 border-amber-300 dark:border-amber-700 rounded-2xl px-4 py-4 min-h-[80px] hover:border-amber-500 hover:shadow-md active:scale-[0.98] transition-all"
              >
                {group.recipeColor ? (
                  <RecipeSwatch recipeId={group.recipeId} color={group.recipeColor} className="w-3.5 h-3.5 rounded-full flex-shrink-0" />
                ) : (
                  <Clock3 className="w-5 h-5 text-amber-600 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold leading-tight break-words">{group.itemName}</p>
                  <p className="text-sm text-muted-foreground leading-snug break-words">
                    {group.recipeName}
                    {sourceLabel && <> · from {sourceLabel} prep</>}
                  </p>
                </div>
                <span className="flex items-center gap-0.5 text-sm font-semibold text-amber-700 dark:text-amber-300 flex-shrink-0">
                  Open <ChevronRight className="w-5 h-5" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {openGroup && (
        <DeferredPrepSheet
          key={openGroup.key}
          group={openGroup}
          station={station}
          pendingId={pendingId}
          onTick={handleTick}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}

/** The opened deferred item: its tins with the amounts; tap a tin when it's
 *  done. Closable (X, Escape, tap outside) and capped to the screen with the
 *  tins scrolling inside, so it fits an iPad either way round. */
function DeferredPrepSheet({ group, station, pendingId, onTick, onClose }: {
  group: DeferredPrepGroup;
  station: PrepSessionStation;
  pendingId: number | null;
  onTick: (item: DeferredPrepItem, afterSave: () => void) => void;
  onClose: () => void;
}) {
  // Invisible prep timing: this item is open while the sheet is (the hook
  // closes it when the sheet goes). Recorded against the SOURCE plan, where
  // the ticks go.
  const timing = usePrepSessionCapture({ planId: group.sourcePlanId, station });
  const timedItem = deferredPrepItemOf(group);
  useEffect(() => {
    timing.focus([timedItem]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sheet is keyed by its group
  }, [timing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sourceLabel = sourceDayLabel(group.sourcePlanDate);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deferred-prep-sheet-title"
        className="bg-card text-foreground rounded-2xl border-2 border-amber-300 dark:border-amber-700 shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-3 flex-shrink-0 border-b border-border/60">
          <div className="flex items-start gap-2.5 min-w-0">
            {group.recipeColor ? (
              <RecipeSwatch recipeId={group.recipeId} color={group.recipeColor} className="w-4 h-4 mt-1.5 rounded-full flex-shrink-0" />
            ) : (
              <Clock3 className="w-6 h-6 mt-0.5 text-amber-600 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <h2 id="deferred-prep-sheet-title" className="font-bold text-2xl leading-tight break-words">{group.itemName}</h2>
              <p className="text-base text-muted-foreground break-words">
                For {group.recipeName}
                {sourceLabel && <> · deferred from {sourceLabel} prep</>}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {group.tins.map(item => {
              const isPending = pendingId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTick(item, () => timing.ticked({
                    ...timedItem,
                    recipeId: item.recipeId,
                    tinNumber: item.tinNumber,
                    subRecipeOriginId: item.isSubRecipe ? null : item.subRecipeOriginId,
                    quantity: item.qtyPerTin,
                    unit: item.itemUnit,
                  }))}
                  disabled={pendingId != null}
                  className={cn(
                    "relative flex flex-col items-center justify-center border-2 rounded-2xl px-3 py-5 min-h-[150px] transition-all active:scale-95",
                    "bg-background border-amber-300 dark:border-amber-700",
                    "hover:border-emerald-400 hover:shadow-md",
                    isPending && "opacity-60 cursor-wait",
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
                    <span className="text-4xl font-bold tabular-nums text-foreground">
                      {fmtPrepQty(item.qtyPerTin, item.itemUnit)}
                    </span>
                  ) : (
                    <span className="text-base font-medium text-muted-foreground italic">
                      quantity n/a
                    </span>
                  )}
                  <span className="text-base text-emerald-700 dark:text-emerald-400 mt-2 leading-tight text-center font-semibold">
                    Tap when done
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
