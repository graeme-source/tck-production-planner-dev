import { formatBatches } from "../shared/format-batches";
import { prepTinTileLabel, recipeNameWithTinSize } from "../shared/prep-tin-labels";
import { useModalScrollKeeper } from "@/hooks/use-modal-scroll";
import React from "react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import {
  ClipboardList, Loader2, CheckCircle2, Package, Plus, Minus, Check, Salad, Pencil, RotateCcw, MoreVertical, Clock3, X as XIcon,
  BookOpen, FlaskConical,
} from "lucide-react";
import { SopChips, useSopViewer, type SopLink } from "@/components/sop-link-chips";
import { format, parseISO } from "date-fns";
import { useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { useAuth } from "@/contexts/auth-context";
import { BreakTracker } from "../shared/break-tracker";
import { PrepDateBanner, PrepDraftBanner, useNextActivePlan, fmtPrepQty, toastDraftBlocked } from "../shared/prep-helpers";
import type { NextActivePlan } from "../shared/prep-helpers";
import { MixExtraNote } from "../shared/mix-extra-note";
import { StockCheckButton, StockCheckEntryForm } from "../shared/stock-check-entry";
import { prepTargetOf } from "../shared/stock-check-alarm";
import { DeferredPrepBanner } from "../shared/deferred-prep-banner";
import { CookChillCard } from "@/components/cook-chill/cook-chill-card";
import { usePrepPresence, alsoViewingNames, othersViewing } from "../shared/prep-presence";
import { PrepSectionTabs, PrepStockCheckTabBody, usePrepStockTabOpen } from "../shared/prep-section-tabs";
import { SubRecipeReplenishModal, type ReplenishTarget } from "./sub-recipe-replenish-modal";
import { PrintIngredientLabelButton } from "@/components/print-ingredient-label-button";
import { mainPrepProgress, progressPct, tasksLine } from "@/lib/prep-progress";
import { usePrepSessionCapture, type PrepSessionItem } from "@/hooks/use-prep-session-capture";

export interface MainPrepIngredient {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  category: string | null;
  stockCheckEnabled: boolean;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
  isBottle?: boolean;
  bottleSize?: number | null;
  bottlesNeeded?: number | null;
  stockInPacks?: boolean;
  packWeight?: number | null;
  totalQty: number;
  /** How much of totalQty is the recipes' Mix +g (extra prepped once per
   *  production day for the mixing station), in `unit`. */
  mixExtraQty?: number;
  totalTinCount: number;
  isSubRecipe?: boolean;
  recipes: Array<{
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    qtyForRecipe: number;
    tinSize: string | null;
    maxBatchesPerTin: number | null;
    tinCount: number;
    qtyPerTin: number;
    isOverridden?: boolean;
    isFillingMix?: boolean;
    // Set when this entry was contributed by an expanded sub-recipe
    // (e.g. cheddar coming in via Breadcrumb Topping vs Mac Cheese
    // sauce). Two entries on the same parent recipe with different
    // origins are rendered as separate cards with independent tin ticks.
    subRecipeOriginId?: number | null;
    // Name of that originating sub-recipe — used as the row label so split
    // entries read "Macaroni Cheese Sauce" / "Breadcrumb Topping" rather
    // than the parent recipe name repeated.
    subRecipeOriginName?: string | null;
  }>;
}

interface PrepTinCompletion {
  id: number;
  ingredientId: number;
  isSubRecipe?: boolean;
  // Mirrors the backend column — present on completions for ingredients
  // contributed by an expanded sub-recipe. Used so the tick lights up the
  // right card when multiple sub-recipes feed the same ingredient into the
  // same parent recipe.
  subRecipeOriginId?: number | null;
  recipeId: number;
  tinNumber: number;
  userId: number | null;
  userName: string | null;
  completedAt: string;
}

// Mirrors backend /main-prep response. A deferred tin is one that's been
// pushed from this plan's pre-prep day to the production day itself (e.g.
// milk for mac cheese sauce deferred from Friday prep → Monday morning).
// The tin counts as resolved for the source-day % complete and shows an
// amber "deferred" badge in place of the normal tick state.
interface PrepTinDeferral {
  id: number;
  ingredientId: number;
  isSubRecipe?: boolean;
  subRecipeOriginId?: number | null;
  recipeId: number;
  tinNumber: number;
  deferredToDate: string;
  deferredAt: string;
  userId: number | null;
  userName: string | null;
}


/** Ticks for linked rows (pasta water/salt) — their own tiny endpoint, so
 *  water and salt can be struck off like any other prep task even though
 *  they aren't recipe ingredients (Graeme, 2026-09-09). Polls on the same
 *  cadence as the main prep data. */
function useLinkedCompletions(planId: number | null) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    if (!planId) { setDone(new Set()); return; }
    try {
      const r = await fetch(`/api/prep-linked-completions/${planId}`, { credentials: "include" });
      if (r.ok) {
        const rows = (await r.json()) as Array<{ key: string }>;
        setDone(new Set(rows.map(x => x.key)));
      }
    } catch { /* poll again shortly */ }
  }, [planId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  const toggle = async (key: string) => {
    if (!planId) return;
    const isDone = done.has(key);
    // Optimistic — a bench tap must not wait on the network.
    setDone(prev => {
      const next = new Set(prev);
      if (isDone) next.delete(key); else next.add(key);
      return next;
    });
    const res = await fetch(`/api/prep-linked-completions/${planId}`, {
      method: isDone ? "DELETE" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }).catch(() => null);
    if (!res || (!res.ok && res.status !== 409)) load(); // roll back to server truth
    if (res && res.status === 409) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Couldn't tick that", description: body.error, variant: "destructive" });
      load();
    }
  };
  return { linkedDone: done, toggleLinked: toggle };
}

interface StockCheckEntry {
  id: number;
  ingredientId: number;
  ingredientName: string;
  unit: string;
  quantity: string | null;
  checkedAt: string;
  userId: number | null;
}

export interface LinkedItem {
  /** Present on rows that are tickable tasks (pasta water/salt) — persisted
   *  per plan in prep_linked_completions. Absent = display-only sub-row. */
  key?: string;
  ingredientName: string;
  unit: string;
  totalQty: number;
  recipes?: Array<{
    recipeId: number;
    recipeName: string;
    qtyForRecipe: number;
    tinCount: number;
    qtyPerTin: number;
  }>;
}

export function useMainPrepData(planId: number, station: string = "main_prep") {
  const [data, setData] = useState<{ ingredients: MainPrepIngredient[]; completions: PrepTinCompletion[]; deferrals?: PrepTinDeferral[]; linkedItems?: Record<number, LinkedItem[]> } | null>(null);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setLoading(true);
    fetch(`/api/production-plans/${planId}/main-prep?station=${station}`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setData(d); initialLoadDone.current = true; setLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setLoading(false); } });
  }, [planId, station]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch]);

  const refetch = useCallback(() => doFetch(), [doFetch]);
  return { data, loading, refetch };
}

export function MainPrepStation({ plan, isOnBreak = false }: { plan: ProductionPlanDetail; isOnBreak?: boolean }) {
  const { state: authState } = useAuth();
  const currentUserId = authState.status === "authenticated" ? authState.user.id : null;
  // A sub-recipe row's "Replenish" button opens the make-flow modal for it
  // without leaving the prep list (Graeme, 2026-09-08).
  const [replenishTarget, setReplenishTarget] = useState<ReplenishTarget | null>(null);
  // ?direct=1 means the user navigated here from a calendar prep card for a
  // specific plan — bypass the auto-route to "next active plan" and use the
  // URL plan id as-is. Without this, an explicit click can be redirected past
  // the user's intended plan into an unrelated future one.
  const search = useSearch();
  const isDirect = new URLSearchParams(search).get("direct") === "1";
  // Stock Check is the fourth prep tab (?tab=stock-check) — Graeme, 22 Oct.
  const stockTabOpen = usePrepStockTabOpen();
  const { data: nextPlanData, isLoading: isNextPlanLoading } = useNextActivePlan(isDirect ? undefined : plan.planDate, "prep");
  const nextPlan = isDirect ? null : (nextPlanData as NextActivePlan | null);
  const noFuturePlan = !isDirect && !isNextPlanLoading && nextPlan != null && nextPlan.planId == null;
  const isDraft = !isDirect && nextPlan?.status === "draft";
  const targetPlanId = isDirect
    ? plan.id
    : (noFuturePlan ? plan.id : (nextPlan?.planId ?? plan.id));
  const { data, loading, refetch } = useMainPrepData(targetPlanId);
  const { linkedDone, toggleLinked } = useLinkedCompletions(targetPlanId);
  const [stockValues, setStockValues] = useState<Record<number, string>>({});
  const [stockValuesLoaded, setStockValuesLoaded] = useState(false);
  // Ingredient ids the user has skipped past in the forced modal for this
  // session. Temporary escape hatch while the stock-check flow is being
  // stabilised — resets on page reload.
  const [dismissedStockCheckIds, setDismissedStockCheckIds] = useState<Set<number>>(new Set());
  const dirtyStockIds = useRef<Set<number>>(new Set());
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  // "Also viewing" presence — shared with Bases & Sauces (#64).
  const { presenceData, setViewing } = usePrepPresence(targetPlanId);
  // Prep timing (founder-only report, no screen): the item on screen is timed in the
  // background from opening to its ticks — never shown, never waited on.
  const timing = usePrepSessionCapture({ planId: targetPlanId, station: "main_prep", enabled: !isDraft && !noFuturePlan });
  const stockCheckRef = useRef<HTMLDivElement>(null);
  const prevNeedsStockCheckRef = useRef(false);

  // Tin count override state
  const [editingTinKey, setEditingTinKey] = useState<string | null>(null); // "ingredientId_recipeId"
  const [editTinValue, setEditTinValue] = useState("");
  const [savingTinOverride, setSavingTinOverride] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);

  const setTinOverride = async (recipeId: number, ingredientId: number, isFillingMix: boolean, tinCount: number | null) => {
    setSavingTinOverride(true);
    try {
      const res = await fetch(`/api/production-plans/${targetPlanId}/prep-tin-override`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId, ingredientId, isFillingMix, tinCount }),
      });
      if (!res.ok) throw new Error("Failed to set override");
      setEditingTinKey(null);
      setEditTinValue("");
      refetch();
    } catch (err) {
      toast({ title: "Error", description: "Failed to update tin count", variant: "destructive" });
    } finally {
      setSavingTinOverride(false);
    }
  };

  const checkDate = nextPlan?.planDate ?? plan.planDate;

  useEffect(() => {
    setSelectedItemKey(null);
    setStockValues({});
    setStockValuesLoaded(false);
    dirtyStockIds.current.clear();
  }, [targetPlanId]);

  const fetchStockChecks = useCallback(() => {
    if (!checkDate) return;
    fetch(`/api/production-plans/stock-checks?date=${checkDate}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d?.checks) {
          const serverVals: Record<number, string> = {};
          for (const c of d.checks) {
            // A quantity of 0 is a valid stock reading ("nothing left") — it
            // still counts as checked, so don't treat it as missing.
            if (c.quantity != null && c.quantity !== "") {
              serverVals[c.ingredientId] = String(parseFloat(c.quantity));
            }
          }
          setStockValues(prev => {
            const merged = { ...serverVals };
            for (const id of dirtyStockIds.current) {
              if (id in prev) merged[id] = prev[id];
            }
            return merged;
          });
          setStockValuesLoaded(true);
        }
      })
      .catch((err) => { console.warn("[MainPrep] Stock checks fetch failed:", err); });
  }, [checkDate]);

  useEffect(() => {
    if (!checkDate) return;
    fetchStockChecks();
    const interval = setInterval(fetchStockChecks, 5000);
    return () => clearInterval(interval);
  }, [fetchStockChecks]);

  const ingredients = data?.ingredients ?? [];
  const completions = data?.completions ?? [];
  const deferrals = data?.deferrals ?? [];
  const linkedItems = data?.linkedItems ?? {};

  // subRecipeOriginId: when provided (including `null`), match the completion's
  // origin marker exactly. When `undefined`, ignore origin entirely — used by
  // summary counters that want to count ticks across all origins. Per-tin
  // call sites must pass it so two cards on the same (ingredient, parent
  // recipe) contributed by different sub-recipes don't share tick state.
  const isCompleted = (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean, subRecipeOriginId?: number | null) =>
    completions.some(c =>
      c.ingredientId === ingredientId
      && c.recipeId === recipeId
      && c.tinNumber === tinNumber
      && !!c.isSubRecipe === !!isSubRecipe
      && (subRecipeOriginId === undefined || (c.subRecipeOriginId ?? null) === (subRecipeOriginId ?? null))
    );

  const getCompletion = (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean, subRecipeOriginId?: number | null) =>
    completions.find(c =>
      c.ingredientId === ingredientId
      && c.recipeId === recipeId
      && c.tinNumber === tinNumber
      && !!c.isSubRecipe === !!isSubRecipe
      && (subRecipeOriginId === undefined || (c.subRecipeOriginId ?? null) === (subRecipeOriginId ?? null))
    );

  // Same matching rules as isCompleted/getCompletion — a tin is "deferred"
  // when there's a prep_deferrals row for the same (ingredient, recipe, tin,
  // origin) tuple. The completion takes visual precedence: if a tin is both
  // deferred AND completed (it was prepped on the deferred-to day), it
  // renders as completed.
  const isDeferred = (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean, subRecipeOriginId?: number | null) =>
    deferrals.some(d =>
      d.ingredientId === ingredientId
      && d.recipeId === recipeId
      && d.tinNumber === tinNumber
      && !!d.isSubRecipe === !!isSubRecipe
      && (subRecipeOriginId === undefined || (d.subRecipeOriginId ?? null) === (subRecipeOriginId ?? null))
    );

  const getDeferral = (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean, subRecipeOriginId?: number | null) =>
    deferrals.find(d =>
      d.ingredientId === ingredientId
      && d.recipeId === recipeId
      && d.tinNumber === tinNumber
      && !!d.isSubRecipe === !!isSubRecipe
      && (subRecipeOriginId === undefined || (d.subRecipeOriginId ?? null) === (subRecipeOriginId ?? null))
    );

  const todayDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];

  const stockCheckActiveToday = (ing: MainPrepIngredient): boolean => {
    if (!ing.stockCheckEnabled) return false;
    if (ing.stockCheckFrequency === "weekly") return ing.stockCheckDay === todayDayName;
    return true;
  };

  const ingredientDoneStatus = (ing: MainPrepIngredient) => {
    let totalTinCount = 0;
    let completedTinCount = 0;
    let deferredTinCount = 0;
    for (const r of ing.recipes) {
      totalTinCount += r.tinCount;
      for (let tn = 1; tn <= r.tinCount; tn++) {
        if (isCompleted(ing.ingredientId, r.recipeId, tn, ing.isSubRecipe, r.subRecipeOriginId ?? null)) {
          completedTinCount++;
        } else if (isDeferred(ing.ingredientId, r.recipeId, tn, ing.isSubRecipe, r.subRecipeOriginId ?? null)) {
          // else-if so a deferred-then-completed tin counts as completed only
          deferredTinCount++;
        }
      }
    }
    // resolvedTinCount = completed + deferred. Used by the overall % bar so
    // Friday's view can hit 100% even if some items will actually be prepped
    // on Monday. allTinsDone stays based on actually-completed tins so the
    // forced stock-check modal (which assumes the ingredient has been used)
    // doesn't fire for deferred-only items.
    const resolvedTinCount = completedTinCount + deferredTinCount;
    const allTinsDone = totalTinCount > 0 && completedTinCount >= totalTinCount;
    const allTinsResolved = totalTinCount > 0 && resolvedTinCount >= totalTinCount;
    // "Saved" means confirmed on the server, NOT just typed locally. If the
    // user is mid-type (dirty set has the id), don't treat the in-progress
    // value as saved — otherwise the forced modal closes the instant you
    // type a digit, before Save is even tapped.
    const hasValue = stockValues[ing.ingredientId] !== undefined && stockValues[ing.ingredientId] !== "";
    const stockSaved = hasValue && !dirtyStockIds.current.has(ing.ingredientId);
    const activeStockCheck = stockCheckActiveToday(ing);
    const needsStockCheck = activeStockCheck && allTinsDone;
    // isFullyDone drives the left-list line-through + dimmed styling. We use
    // allTinsResolved so a row with all-deferred or all-mixed (some done +
    // some deferred) tins also dims — otherwise people keep tapping items
    // that have already been dealt with. Stock-check requirement only fires
    // for actually-completed items though (the deferred items haven't been
    // touched yet, so stock count is unchanged).
    const isFullyDone = allTinsResolved && (allTinsDone ? (!activeStockCheck || stockSaved) : true);
    return { allTinsDone, allTinsResolved, needsStockCheck, stockSaved, isFullyDone, totalTinCount, completedTinCount, deferredTinCount, resolvedTinCount };
  };

  const recipeIngredientStatus = (ing: MainPrepIngredient, recipeId: number) => {
    // Sum tins + completions across every recipes[] entry with this parent
    // recipeId. An ingredient that comes in via multiple sub-recipes of the
    // same parent (e.g. cheddar via Breadcrumb Topping AND Macaroni Cheese
    // sauce under Big Nanny's) has multiple entries here — the left-sidebar
    // card should show the combined progress so the operator sees one
    // collapsed status until they drill in.
    const matching = ing.recipes.filter(r => r.recipeId === recipeId);
    if (matching.length === 0) return { completedTins: 0, deferredTins: 0, resolvedTins: 0, totalTins: 0, allDone: false, allResolved: false, anyDeferred: false };
    let totalTins = 0;
    let completedTins = 0;
    let deferredTins = 0;
    for (const r of matching) {
      totalTins += r.tinCount;
      for (let tn = 1; tn <= r.tinCount; tn++) {
        if (isCompleted(ing.ingredientId, recipeId, tn, ing.isSubRecipe, r.subRecipeOriginId ?? null)) {
          completedTins++;
        } else if (isDeferred(ing.ingredientId, recipeId, tn, ing.isSubRecipe, r.subRecipeOriginId ?? null)) {
          deferredTins++;
        }
      }
    }
    const resolvedTins = completedTins + deferredTins;
    return {
      completedTins,
      deferredTins,
      resolvedTins,
      totalTins,
      allDone: totalTins > 0 && completedTins >= totalTins,
      // allResolved counts deferrals — used by the "hide completed" filter
      // and by the left-list "row is done" styling so people don't keep
      // re-clicking deferred items thinking they're outstanding.
      allResolved: totalTins > 0 && resolvedTins >= totalTins,
      anyDeferred: deferredTins > 0,
    };
  };

  const getPreppedByInitials = (ingredientId: number, recipeId?: number, isSubRecipe?: boolean): { initials: string; fullName: string }[] => {
    const seen = new Set<string>();
    const result: { initials: string; fullName: string }[] = [];
    for (const c of completions) {
      if (c.ingredientId !== ingredientId || !c.userName) continue;
      if (!!c.isSubRecipe !== !!isSubRecipe) continue;
      if (recipeId !== undefined && c.recipeId !== recipeId) continue;
      if (seen.has(c.userName)) continue;
      seen.add(c.userName);
      result.push({
        initials: c.userName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2),
        fullName: c.userName,
      });
    }
    return result;
  };

  // Build left-panel groups: recipe → list of {ingredient, qty for that recipe}
  // An ingredient may appear in multiple recipe groups if shared across recipes.
  const leftGroups = useMemo(() => {
    const map = new Map<number, {
      recipeId: number;
      recipeName: string;
      tinSize: string | null;
      batchesTarget: number;
      items: Array<{ ing: MainPrepIngredient; qtyForRecipe: number }>;
    }>();
    for (const ing of ingredients) {
      // An ingredient that's pulled into the same parent recipe via several
      // expanded sub-recipes (e.g. cheddar via both Breadcrumb Topping and
      // the Macaroni Cheese sub-recipe inside one parent) ends up with
      // multiple `recipes` entries that share the same recipeId. Render it
      // once per group — the right-hand panel still breaks the tins down by
      // sub-recipe origin via ing.recipes directly.
      const seenInGroup = new Set<number>();
      for (const r of ing.recipes) {
        if (!map.has(r.recipeId)) {
          map.set(r.recipeId, { recipeId: r.recipeId, recipeName: r.recipeName, tinSize: r.tinSize ?? null, batchesTarget: r.batchesTarget, items: [] });
        }
        if (seenInGroup.has(r.recipeId)) continue;
        seenInGroup.add(r.recipeId);
        // Sum the per-recipe qty across all entries with this recipeId so
        // the displayed quantity reflects the total ingredient demand
        // contributed by this parent recipe, not just the first sub-recipe.
        const qtyForRecipe = ing.recipes
          .filter(rr => rr.recipeId === r.recipeId)
          .reduce((s, rr) => s + rr.qtyForRecipe, 0);
        map.get(r.recipeId)!.items.push({ ing, qtyForRecipe });
      }
    }
    return [...map.values()];
  }, [ingredients]);

  const itemKey = (ing: MainPrepIngredient) => ing.isSubRecipe ? `sub:${ing.ingredientId}` : `ing:${ing.ingredientId}`;

  useEffect(() => {
    if (ingredients.length === 0) return;
    if (selectedItemKey && ingredients.find(i => itemKey(i) === selectedItemKey)) return;
    const firstIncomplete = ingredients.find(ing => !ingredientDoneStatus(ing).isFullyDone);
    setSelectedItemKey(itemKey(firstIncomplete ?? ingredients[0]));
  }, [ingredients]);

  const selectedIngredient = ingredients.find(i => itemKey(i) === selectedItemKey) ?? null;

  // Time the item on screen while it still has tins to prep — a finished
  // item that is only being looked at isn't prep. Same on the Stock Check tab.
  const timedItem: PrepSessionItem | null = selectedIngredient && !stockTabOpen && !ingredientDoneStatus(selectedIngredient).allTinsResolved
    ? (selectedIngredient.isSubRecipe ? { subRecipeId: selectedIngredient.ingredientId } : { ingredientId: selectedIngredient.ingredientId })
    : null;
  const timedKey = timedItem ? `${timedItem.ingredientId ?? ""}/${timedItem.subRecipeId ?? ""}` : "";
  useEffect(() => {
    timing.focus(timedItem ? [timedItem] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timedKey is timedItem's identity
  }, [timing, timedKey]);

  // What one tin holds, in the unit shown on it — the bottles card's tick
  // covers the whole amount.
  const tinQuantity = (ingredientId: number, recipeId: number, isSubRecipe?: boolean, subRecipeOriginId?: number | null) => {
    const ing = ingredients.find(i => i.ingredientId === ingredientId && !!i.isSubRecipe === !!isSubRecipe);
    if (!ing) return { quantity: null, unit: null };
    if (ing.isBottle && ing.bottlesNeeded) return { quantity: ing.totalQty, unit: ing.unit };
    const entry = ing.recipes.find(r => r.recipeId === recipeId && (r.subRecipeOriginId ?? null) === (subRecipeOriginId ?? null));
    return { quantity: entry?.qtyPerTin ?? null, unit: ing.unit };
  };

  // SOPs attached to these ingredients — ingredient-level plus recipe-scoped
  // (burger beef can carry a different SOP per recipe). Sub-recipe rows are
  // skipped: their ids live in a different table, so an ingredient-keyed
  // lookup would collide (follow-up: a 'sub_recipe' target type).
  const sopIngredientIds = [...new Set(ingredients.filter(i => !i.isSubRecipe).map(i => i.ingredientId))].sort((a, b) => a - b);
  const sopLinksKey = ["sop-links-ingredients", sopIngredientIds.join(",")];
  const { data: sopLinksByIngredient } = useQuery<Record<number, Array<SopLink & { scope: "ingredient" | "recipe"; recipeId: number | null }>>>({
    queryKey: sopLinksKey,
    enabled: sopIngredientIds.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/standards/links/for-ingredients?ids=${sopIngredientIds.join(",")}&station=main_prep`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load SOP links");
      return res.json();
    },
  });
  const sopViewer = useSopViewer();
  // Links relevant to a row within one recipe's group: ingredient-level ones
  // plus those scoped to THAT recipe.
  const sopLinksFor = (ingredientId: number, recipeId: number | null, isSubRecipe?: boolean): SopLink[] => {
    if (isSubRecipe) return [];
    const all = sopLinksByIngredient?.[ingredientId] ?? [];
    return all.filter(l => l.scope === "ingredient" || recipeId == null || l.recipeId === recipeId);
  };

  const selectedStatus = selectedIngredient ? ingredientDoneStatus(selectedIngredient) : null;
  useEffect(() => {
    prevNeedsStockCheckRef.current = false;
  }, [selectedItemKey]);

  useEffect(() => {
    if (selectedStatus?.needsStockCheck && !selectedStatus.stockSaved && !prevNeedsStockCheckRef.current) {
      setTimeout(() => {
        stockCheckRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      toast({ title: `Stock check needed for ${selectedIngredient?.ingredientName ?? "this item"}` });
    }
    prevNeedsStockCheckRef.current = selectedStatus?.needsStockCheck ?? false;
  }, [selectedStatus?.needsStockCheck, selectedStatus?.stockSaved, selectedIngredient?.ingredientId]);

  const [runTinAction, tinPending] = useGuardedAction({
    onSuccess: () => refetch(),
  });

  const toggleTin = async (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean, subRecipeOriginId?: number | null) => {
    if (isOnBreak) return;
    if (isDraft) { toastDraftBlocked(); return; }
    setViewing(ingredientId);
    const existing = getCompletion(ingredientId, recipeId, tinNumber, isSubRecipe, subRecipeOriginId);
    const item = isSubRecipe ? { subRecipeId: ingredientId } : { ingredientId };
    await runTinAction(async (signal) => {
      if (existing) {
        await guardedFetch(`/api/production-plans/${targetPlanId}/prep-completions/by-tin`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber, isSubRecipe: !!isSubRecipe, subRecipeOriginId: subRecipeOriginId ?? null }),
          signal,
        });
        timing.unticked(item);
      } else {
        await guardedFetch(`/api/production-plans/${targetPlanId}/prep-completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber, isSubRecipe: !!isSubRecipe, subRecipeOriginId: subRecipeOriginId ?? null }),
          signal,
        });
        // Saved — time it against the session open on this item (background).
        timing.ticked({ ...item, recipeId, tinNumber, subRecipeOriginId: isSubRecipe ? null : subRecipeOriginId ?? null, ...tinQuantity(ingredientId, recipeId, isSubRecipe, subRecipeOriginId) });
      }
    });
  };

  // Per-tin defer/un-defer toggle. Source plan = targetPlanId (the plan being
  // prepped for); deferred_to_date is resolved server-side to that plan's
  // plan_date. The kebab popover above each tin tile calls this.
  const toggleDeferral = async (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean, subRecipeOriginId?: number | null) => {
    if (isOnBreak) return;
    if (isDraft) { toastDraftBlocked(); return; }
    const existing = getDeferral(ingredientId, recipeId, tinNumber, isSubRecipe, subRecipeOriginId);
    try {
      if (existing) {
        await guardedFetch(`/api/production-plans/${targetPlanId}/prep-deferrals/by-tin`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber, isSubRecipe: !!isSubRecipe, subRecipeOriginId: subRecipeOriginId ?? null }),
        });
        toast({ title: "Deferral cancelled", description: "Tin is back on the normal prep list." });
      } else {
        await guardedFetch(`/api/production-plans/${targetPlanId}/prep-deferrals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber, isSubRecipe: !!isSubRecipe, subRecipeOriginId: subRecipeOriginId ?? null }),
        });
        toast({ title: "Deferred", description: "Will appear in the deferred-prep list on production day." });
      }
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update deferral";
      toast({ title: "Couldn't defer", description: msg, variant: "destructive" });
    }
  };

  // Which tin's kebab popover is open. Single string key so only one is
  // open at a time and clicking another auto-closes the prior one.
  const [openTinMenu, setOpenTinMenu] = useState<string | null>(null);
  const tinMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openTinMenu) return;
    const handler = (e: MouseEvent) => {
      if (tinMenuRef.current && !tinMenuRef.current.contains(e.target as Node)) {
        setOpenTinMenu(null);
      }
    };
    // Defer attachment so the click that opened the menu doesn't immediately
    // close it. setTimeout 0 puts us at the end of this event loop turn.
    const t = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handler); };
  }, [openTinMenu]);

  // A count saved through the shared stock-check entry (which POSTs it):
  // show it straight away so the forced pop-up moves on, then refresh from
  // the server so other iPads agree without waiting for the 5s poll.
  const onStockSaved = (ingredientId: number, nativeQty: number) => {
    dirtyStockIds.current.delete(ingredientId);
    setStockValues(prev => ({ ...prev, [ingredientId]: String(nativeQty) }));
    refetch();
    fetchStockChecks();
  };

  // Header progress in TASKS (one row = one task; tins resolved = ticked or
  // deferred) — the shared helper the dashboard tile and Prepping For hub
  // use too, fed the same response, so they can never disagree (13 Oct).
  const progress = mainPrepProgress({ ingredients, completions, deferrals, linkedItems, linkedDone });
  const overallPct = progressPct(progress);
  const deferredTinsTotal = progress.deferredUnits ?? 0;
  const prepTarget = prepTargetOf(nextPlan, plan);
  const tabs = (
    <PrepSectionTabs
      planId={plan.id}
      current="main_prep"
      progressPlanId={targetPlanId}
      currentProgress={noFuturePlan ? null : progress}
      checkDate={checkDate}
      prepTarget={prepTarget}
    />
  );

  if (loading || isNextPlanLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  if (noFuturePlan) {
    return (
      <div className="space-y-4">
        {tabs}
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Salad className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <h2 className="font-semibold text-lg mb-1">No future production plan</h2>
          <p className="text-muted-foreground text-sm">
            There is no upcoming active production plan to prep for.
            Create and activate a future plan to see prep requirements here.
          </p>
        </div>
      </div>
    );
  }

  // Last user to tick off a tin on a given ingredient — used to scope the
  // blocking stock-check modal to the person who actually finished prepping
  // it. Without this, the modal pops for every user on the station the
  // moment any ingredient finishes, interrupting unrelated prep work.
  const lastCompletedByUserId = (ing: MainPrepIngredient): number | null => {
    let latest: PrepTinCompletion | null = null;
    for (const c of completions) {
      if (c.ingredientId !== ing.ingredientId) continue;
      if (!!c.isSubRecipe !== !!ing.isSubRecipe) continue;
      if (!latest || c.completedAt > latest.completedAt) latest = c;
    }
    return latest?.userId ?? null;
  };

  // Stock-check items that have all tins done but no value saved yet. The
  // forced modal (below) only appears to the user who finished prepping the
  // ingredient — other users on the same station keep working uninterrupted.
  // Every pending check is still visible (and actionable) in the non-blocking
  // Stock Check tab, so nothing gets missed.
  const allPendingStockChecks = ingredients.filter(ing => {
    const s = ingredientDoneStatus(ing);
    if (!(stockCheckActiveToday(ing) && s.allTinsDone && !s.stockSaved)) return false;
    if (dismissedStockCheckIds.has(ing.ingredientId)) return false;
    return true;
  });
  // Wait until the server-side stock values have loaded at least once before
  // we consider anything "pending" — otherwise a user who just opened the
  // station sees the forced modal for ingredients that are already checked
  // (we just haven't heard back from the poll yet).
  const pendingStockChecks = (!stockValuesLoaded || currentUserId == null)
    ? []
    : allPendingStockChecks.filter(ing => lastCompletedByUserId(ing) === currentUserId);
  const activeStockCheckModalIng = pendingStockChecks[0] ?? null;

  if (stockTabOpen) {
    return (
      <div className="space-y-4">
        <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />
        {tabs}
        <PrepStockCheckTabBody checkDate={checkDate} prepTarget={prepTarget} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isDraft && nextPlan?.planId != null && nextPlan?.planDate && (
        <PrepDraftBanner
          planId={nextPlan.planId}
          planDate={nextPlan.planDate}
          planName={nextPlan.planName}
        />
      )}
      <PrepDateBanner
        currentPlanDate={plan.planDate}
        targetPlanDate={nextPlan?.planDate ?? null}
        targetPlanName={nextPlan?.planName ?? null}
        isLoading={false}
      />

      {tabs}

      {replenishTarget && (
        <SubRecipeReplenishModal
          target={replenishTarget}
          onClose={() => setReplenishTarget(null)}
          timing={isDraft ? undefined : { planId: targetPlanId, station: "main_prep" }}
        />
      )}

      {/* Deferred-prep banner — hidden when no items are owed today. Ticking
          from here POSTs to the source plan's prep-completions endpoint, so
          a refetch of this station's data picks up the new completion on
          the next 5s poll (clearing the "deferred" badge from the tile). */}
      <DeferredPrepBanner onResolved={refetch} />

      {/* Cook and chill (issue #244): cook-out core temp + into the blast
          chiller for sub-recipes ticked "Cook and chill". Hidden when none. */}
      <CookChillCard station="prep" planId={targetPlanId} />

      {activeStockCheckModalIng && (
        <ForceStockCheckModal
          ingredient={activeStockCheckModalIng}
          checkDate={checkDate}
          isDraft={isDraft}
          onSaved={native => onStockSaved(activeStockCheckModalIng.ingredientId, native)}
          onSkip={() => {
            const id = activeStockCheckModalIng.ingredientId;
            setDismissedStockCheckIds(prev => {
              const next = new Set(prev);
              next.add(id);
              return next;
            });
            toast({ title: "Stock check skipped", description: "You can still log it from the Stock Check tab." });
          }}
          remainingCount={pendingStockChecks.length}
        />
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-6 h-6 text-emerald-600" />
            <div>
              <h2 className="font-semibold text-lg">Main Prep</h2>
              <p className="text-sm text-muted-foreground">
                {tasksLine(progress)} done · {progress.units.done} of {progress.units.total} tins
                {deferredTinsTotal > 0 ? ` (${deferredTinsTotal} deferred)` : ""}
              </p>
            </div>
          </div>
          <span className="text-2xl font-bold font-display">{overallPct}%</span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-emerald-400")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
      </div>

      {ingredients.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <p className="font-medium">No ingredients to prep</p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* LEFT — Ingredients grouped by recipe (menu + sub-items layout) */}
          <div className="lg:w-80 xl:w-96 flex-shrink-0">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center justify-between gap-2">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Ingredients by Recipe</p>
                <button
                  type="button"
                  onClick={() => setHideCompleted(v => !v)}
                  className={cn(
                    "text-xs font-medium px-2 py-1 rounded-md border transition-colors",
                    hideCompleted
                      ? "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )}
                >
                  {hideCompleted ? "Show all" : "Hide completed"}
                </button>
              </div>
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {leftGroups.map((group, gi) => {
                  const visibleItems = hideCompleted
                    ? group.items.filter(({ ing, qtyForRecipe: _q }) => {
                        void _q;
                        const rStatus = recipeIngredientStatus(ing, group.recipeId);
                        return !rStatus.allDone;
                      })
                    : group.items;
                  if (visibleItems.length === 0) return null;
                  return (
                  <div key={group.recipeId} className={cn(gi > 0 && "border-t border-border")}>
                    {/* Recipe section header */}
                    <div className="px-4 py-2 bg-emerald-50/60 dark:bg-emerald-950/20 flex items-center justify-between">
                      <p className="text-sm font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 truncate">
                        {recipeNameWithTinSize(group.recipeName, group.tinSize)}
                      </p>
                      <span className="text-sm text-emerald-600 dark:text-emerald-400 ml-2 whitespace-nowrap">
                        {formatBatches(group.batchesTarget)} batch{group.batchesTarget !== 1 ? "es" : ""}
                      </span>
                    </div>
                    {visibleItems.map(({ ing, qtyForRecipe }) => {
                      const rStatus = recipeIngredientStatus(ing, group.recipeId);
                      const ingStatus = ingredientDoneStatus(ing);
                      const ik = itemKey(ing);
                      const isSelected = ik === selectedItemKey;
                      const presence = othersViewing(presenceData, ing.ingredientId);
                      const ingLinkedItems = linkedItems[ing.ingredientId] ?? [];
                      return (
                        <React.Fragment key={`${group.recipeId}-${ik}`}>
                        <button
                          onClick={() => {
                            setSelectedItemKey(ik);
                            setViewing(ing.ingredientId);
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-t border-border/30",
                            isSelected
                              ? ingStatus.needsStockCheck
                                ? "bg-blue-500/10 border-l-4 border-l-blue-500"
                                : "bg-emerald-500/10 border-l-4 border-l-emerald-500"
                              : "hover:bg-secondary/40 border-l-4 border-l-transparent",
                            ingStatus.isFullyDone && !isSelected && "opacity-60"
                          )}
                        >
                          <div className="flex-shrink-0">
                            {ingStatus.isFullyDone && rStatus.allDone ? (
                              // Truly done — green check.
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            ) : ingStatus.isFullyDone && rStatus.anyDeferred ? (
                              // All resolved but some/all via deferral — amber
                              // clock so the operator instantly sees the row
                              // isn't actually prepped today.
                              <Clock3 className="w-4 h-4 text-amber-500" />
                            ) : ingStatus.needsStockCheck ? (
                              <Package className="w-4 h-4 text-blue-500 animate-pulse" />
                            ) : rStatus.totalTins > 0 ? (
                              // Two-segment progress ring: green = completed,
                              // amber = deferred. They sit end-to-end on the
                              // ring so the operator sees both at a glance.
                              <div className="relative w-4 h-4">
                                <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
                                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-border" />
                                  {rStatus.completedTins > 0 && (
                                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2"
                                      className="text-emerald-500"
                                      strokeDasharray={`${(rStatus.completedTins / rStatus.totalTins) * 37.7} 37.7`}
                                    />
                                  )}
                                  {rStatus.deferredTins > 0 && (
                                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2"
                                      className="text-amber-500"
                                      strokeDasharray={`${(rStatus.deferredTins / rStatus.totalTins) * 37.7} 37.7`}
                                      strokeDashoffset={`-${(rStatus.completedTins / rStatus.totalTins) * 37.7}`}
                                    />
                                  )}
                                </svg>
                              </div>
                            ) : (
                              <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={cn(
                              "text-lg font-medium truncate",
                              isSelected && "font-semibold",
                              // Strike-through only when fully completed AND
                              // no deferrals — purely deferred rows get a
                              // softer dim + amber tint so it's obvious the
                              // tin still needs prepping (just not today).
                              ingStatus.isFullyDone && ingStatus.deferredTinCount === 0 && "line-through text-muted-foreground",
                              ingStatus.isFullyDone && ingStatus.deferredTinCount > 0 && "text-amber-700 dark:text-amber-400"
                            )}>
                              {ing.ingredientName}
                              {presence.length > 0 && <span className="ml-1 text-sm text-blue-500">👁</span>}
                              {sopLinksFor(ing.ingredientId, group.recipeId, ing.isSubRecipe).length > 0 && (
                                <BookOpen className="w-4 h-4 inline ml-1.5 mb-0.5 text-sky-500" aria-label="Has SOP" />
                              )}
                            </p>
                            {ingStatus.needsStockCheck && (
                              <p className="text-sm text-blue-600 font-medium">Stock check needed</p>
                            )}
                            {!ingStatus.needsStockCheck && ing.recipes.length > 1 && (
                              <p className="text-sm text-muted-foreground"><span className="text-amber-500">shared</span></p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {rStatus.completedTins > 0 && getPreppedByInitials(ing.ingredientId, group.recipeId, ing.isSubRecipe).map(({ initials, fullName }) => (
                              <span
                                key={fullName}
                                title={fullName}
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-[9px] font-bold leading-none"
                              >
                                {initials}
                              </span>
                            ))}
                            {ing.isBottle && ing.bottlesNeeded ? (
                              <span className={cn(
                                "text-sm tabular-nums",
                                ingStatus.isFullyDone ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"
                              )}>
                                {ing.bottlesNeeded} btl{ing.bottlesNeeded === 1 ? "" : "s"}
                              </span>
                            ) : rStatus.totalTins > 0 ? (
                              <span className={cn(
                                "text-sm tabular-nums flex items-baseline gap-1",
                                rStatus.allDone
                                  ? "text-emerald-600 font-semibold"
                                  : rStatus.allResolved
                                    ? "text-amber-600 font-semibold"
                                    : "text-muted-foreground"
                              )}>
                                <span>{rStatus.resolvedTins}/{rStatus.totalTins}</span>
                                {rStatus.deferredTins > 0 && (
                                  <span className="text-[10px] text-amber-600 font-medium">+{rStatus.deferredTins} def</span>
                                )}
                              </span>
                            ) : null}
                          </div>
                        </button>
                        {/* Linked ingredient sub-rows. The LEFT list only
                            shows their state — ticking happens in the
                            right-hand detail panel like every other prep
                            item (Graeme, 2026-09-17: water and salt prep
                            exactly like normal items; they just don't end
                            up in the recipe). */}
                        {ingLinkedItems.map((li, liIdx) => {
                          const liDone = li.key != null && linkedDone.has(li.key);
                          return (
                            <div
                              key={`linked-${ing.ingredientId}-${liIdx}`}
                              className={cn(
                                "flex items-center justify-between pl-10 pr-4 py-1.5 border-t border-border/20 text-sm text-muted-foreground",
                                liDone ? "bg-emerald-50/40 dark:bg-emerald-950/10" : "bg-secondary/10",
                              )}
                            >
                              <span className="flex items-center gap-2">
                                {li.key != null ? (
                                  liDone
                                    ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                    : <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 flex-shrink-0" />
                                ) : (
                                  <span className="text-primary/60">↳</span>
                                )}
                                <span className={cn(liDone && "line-through")}>{li.ingredientName}</span>
                              </span>
                              <span className={cn("tabular-nums font-medium", liDone ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                                {fmtPrepQty(li.totalQty, li.unit)}
                              </span>
                            </div>
                          );
                        })}
                        </React.Fragment>
                      );
                    })}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT — Detail card for selected ingredient */}
          <div className="flex-1 min-w-0">
            {selectedIngredient ? (() => {
              const ing = selectedIngredient;
              const status = ingredientDoneStatus(ing);
              const alsoViewing = alsoViewingNames(presenceData, ing.ingredientId);
              const isShared = ing.recipes.length > 1;
              return (
              <div
                className={cn(
                  "bg-card border-2 rounded-2xl p-5 transition-colors",
                  status.isFullyDone
                    ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/20 dark:bg-emerald-950/10"
                    : status.needsStockCheck
                      ? "border-blue-300 dark:border-blue-700"
                      : "border-border"
                )}
              >
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {status.isFullyDone ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                            ) : status.needsStockCheck ? (
                              <Package className="w-5 h-5 text-blue-500 flex-shrink-0 animate-pulse" />
                            ) : null}
                            <h3 className={cn(
                              "font-bold text-2xl leading-tight",
                              status.isFullyDone && "line-through text-muted-foreground"
                            )}>
                              {ing.ingredientName}
                            </h3>
                            {/* This row IS a sub-recipe (ingredientId = the
                                sub-recipe id) — offer to make more of it in a
                                popup, prep list stays put. */}
                            {ing.isSubRecipe && (
                              <button
                                onClick={() => setReplenishTarget({ subRecipeId: ing.ingredientId, name: ing.ingredientName })}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/10 transition-colors"
                                title={`Replenish ${ing.ingredientName} without leaving this screen`}
                              >
                                <FlaskConical className="w-4 h-4" /> Replenish
                              </button>
                            )}
                            {/* One-tap opened-ingredient label — for real
                                ingredients only: a sub-recipe row's id is a
                                sub-recipe id, not an ingredient id. */}
                            {!ing.isSubRecipe && (
                              <PrintIngredientLabelButton ingredientId={ing.ingredientId} itemName={ing.ingredientName} />
                            )}
                          </div>
                          <p className="text-base text-muted-foreground mt-0.5">
                            <span className="font-semibold text-foreground">{fmtPrepQty(ing.totalQty, ing.unit)}</span>
                            {ing.isBottle && ing.bottlesNeeded
                              ? ` total · ${ing.bottlesNeeded} bottle${ing.bottlesNeeded === 1 ? "" : "s"} needed`
                              : ` total · ${status.completedTinCount}/${status.totalTinCount} tins done`
                            }
                          </p>
                          <MixExtraNote qty={ing.mixExtraQty} unit={ing.unit} className="mt-0.5" />
                          {isShared && (
                            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                              <span className="font-medium">Shared —</span>
                              {" in: "}{[...new Set(ing.recipes.map(r => r.subRecipeOriginName ?? r.recipeName))].join(", ")}
                            </p>
                          )}
                          {alsoViewing && (
                            <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                              👁 <span className="font-medium">{alsoViewing}</span> also viewing this
                            </p>
                          )}
                          {/* Linked SOPs — the how-to travels with the prep
                              item. Recipe-scoped chips carry the recipe name;
                              attach offers Everywhere or a single recipe. */}
                          {!ing.isSubRecipe && (
                            <div className="mt-2">
                              <SopChips
                                links={sopLinksByIngredient?.[ing.ingredientId] ?? []}
                                onOpen={sopViewer.open}
                                attach={[
                                  { targetType: "ingredient", a: ing.ingredientId, text: "main_prep", label: "Everywhere", subject: ing.ingredientName },
                                  ...[...new Map(ing.recipes.map(r => [r.recipeId, r.recipeName])).entries()].map(([recipeId, recipeName]) => ({
                                    targetType: "recipe_ingredient" as const,
                                    a: recipeId,
                                    b: ing.ingredientId,
                                    text: "main_prep",
                                    label: `Only ${recipeName}`,
                                  })),
                                ]}
                                queryKeysToInvalidate={[sopLinksKey]}
                              />
                            </div>
                          )}
                        </div>
                        {ing.isBottle && ing.bottlesNeeded ? (
                          <div className="ml-4 flex-shrink-0 text-right">
                            <p className={cn(
                              "text-3xl font-bold font-display tabular-nums",
                              status.isFullyDone ? "text-emerald-600" : "text-amber-600"
                            )}>
                              {ing.bottlesNeeded}
                            </p>
                            <p className="text-sm text-muted-foreground">bottle{ing.bottlesNeeded === 1 ? "" : "s"}</p>
                          </div>
                        ) : status.totalTinCount > 0 ? (
                          <div className="ml-4 flex-shrink-0 text-right">
                            <p className={cn(
                              "text-3xl font-bold font-display tabular-nums",
                              status.isFullyDone ? "text-emerald-600" : "text-foreground"
                            )}>
                              {status.completedTinCount}
                              <span className="text-base text-muted-foreground font-normal">/{status.totalTinCount}</span>
                            </p>
                            <p className="text-sm text-muted-foreground">tins</p>
                          </div>
                        ) : null}
                      </div>

                      {status.totalTinCount > 1 && (
                        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
                          <div
                            className={cn("h-full rounded-full transition-all", status.allTinsDone ? "bg-emerald-500" : "bg-emerald-400")}
                            style={{ width: `${status.totalTinCount > 0 ? Math.min((status.completedTinCount / status.totalTinCount) * 100, 100) : 0}%` }}
                          />
                        </div>
                      )}

                      {/* Linked prep tasks (pasta cooking water + salt):
                          ticked HERE like any other prep item. Same
                          persisted per-plan completion as before. */}
                      {(linkedItems[ing.ingredientId] ?? []).some(li => li.key != null) && (
                        <div className="space-y-2 mb-4">
                          {(linkedItems[ing.ingredientId] ?? []).filter(li => li.key != null).map(li => {
                            const liDone = linkedDone.has(li.key!);
                            return (
                              <button
                                key={li.key}
                                onClick={() => toggleLinked(li.key!)}
                                disabled={isOnBreak}
                                className={cn(
                                  "w-full flex items-center justify-between gap-3 border-2 rounded-2xl px-4 py-3.5 transition-all active:scale-95 text-left",
                                  isOnBreak && "opacity-50 cursor-not-allowed",
                                  liDone
                                    ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20"
                                    : "border-border bg-secondary/20 hover:bg-secondary/40",
                                )}
                              >
                                <span className="flex items-center gap-3 min-w-0">
                                  {liDone
                                    ? <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                                    : <span className="w-6 h-6 rounded-full border-2 border-muted-foreground/40 flex-shrink-0" />}
                                  <span className={cn("text-base font-semibold truncate", liDone && "line-through text-muted-foreground")}>
                                    {li.ingredientName}
                                  </span>
                                </span>
                                <span className={cn("text-lg font-bold tabular-nums flex-shrink-0", liDone ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                                  {fmtPrepQty(li.totalQty, li.unit)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {ing.isBottle && ing.bottlesNeeded ? (() => {
                        const recipe = ing.recipes[0];
                        if (!recipe) return null;
                        const done = isCompleted(ing.ingredientId, recipe.recipeId, 1, ing.isSubRecipe, recipe.subRecipeOriginId ?? null);
                        const completion = getCompletion(ing.ingredientId, recipe.recipeId, 1, ing.isSubRecipe, recipe.subRecipeOriginId ?? null);
                        return (
                          <div>
                            <div className={cn(
                              "flex items-center justify-between px-3 py-2 rounded-lg mb-3",
                              done ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-secondary/40"
                            )}>
                              <div className="flex items-center gap-2 min-w-0">
                                {done && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                                <p className={cn(
                                  "text-sm font-semibold truncate",
                                  done ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"
                                )}>
                                  {recipe.subRecipeOriginName ?? recipe.recipeName}
                                </p>
                              </div>
                              <span className="text-sm text-muted-foreground tabular-nums ml-2 flex-shrink-0">
                                {fmtPrepQty(ing.totalQty, ing.unit)}
                              </span>
                            </div>

                            <div className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700 rounded-2xl p-5 text-center">
                              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 uppercase tracking-wider mb-2">
                                Bottles Required
                              </p>
                              <p className="text-5xl font-bold text-amber-700 dark:text-amber-300 tabular-nums mb-1">
                                {ing.bottlesNeeded}
                              </p>
                              <p className="text-sm text-amber-600 dark:text-amber-400 mb-1">
                                bottle{ing.bottlesNeeded === 1 ? "" : "s"} × {fmtPrepQty(ing.bottleSize ?? 0, ing.unit)} each
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {fmtPrepQty(ing.totalQty, ing.unit)} total needed
                              </p>
                            </div>

                            <button
                              onClick={() => toggleTin(ing.ingredientId, recipe.recipeId, 1, ing.isSubRecipe, recipe.subRecipeOriginId ?? null)}
                              disabled={isOnBreak}
                              className={cn(
                                "mt-3 w-full flex items-center justify-center gap-2 border-2 rounded-2xl px-4 py-3.5 transition-all active:scale-95 text-base font-bold",
                                isOnBreak ? "opacity-50 cursor-not-allowed" : "",
                                done
                                  ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300"
                                  : "bg-background border-border hover:border-emerald-400 hover:shadow-md text-foreground"
                              )}
                            >
                              {done ? (
                                <>
                                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                  Bottles Collected
                                </>
                              ) : (
                                <>
                                  <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/40" />
                                  Mark Bottles as Collected
                                </>
                              )}
                            </button>
                            {done && completion && (
                              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 text-center">
                                {completion.userName ?? "User"} · {format(new Date(completion.completedAt), "HH:mm")}
                              </p>
                            )}
                          </div>
                        );
                      })() : ing.recipes.map((recipe, ri) => {
                        const rTins = Array.from({ length: recipe.tinCount }, (_, i) => i + 1);
                        const rDone = rTins.filter(tn => isCompleted(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null)).length;
                        const rDeferred = rTins.filter(tn =>
                          !isCompleted(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null)
                          && isDeferred(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null)
                        ).length;
                        // Row goes "done" when every tin is either ticked off
                        // OR deferred (deferred = accounted for, just not on
                        // today's checklist).
                        const allRecipeDone = rTins.length > 0 && (rDone + rDeferred) >= rTins.length;
                        // Include origin in the edit/key so two panels under
                        // the same (ingredient, parent recipe) don't collide.
                        const tinEditKey = `${ing.ingredientId}_${recipe.recipeId}_${recipe.subRecipeOriginId ?? "x"}`;
                        const isEditingTins = editingTinKey === tinEditKey;
                        return (
                          <div key={`${recipe.recipeId}_${recipe.subRecipeOriginId ?? "x"}_${ri}`} className={cn(ri > 0 && "mt-4")}>
                            <div className={cn(
                              "flex items-center justify-between px-3 py-2 rounded-lg mb-2",
                              allRecipeDone
                                ? "bg-emerald-50 dark:bg-emerald-900/20"
                                : "bg-secondary/40"
                            )}>
                              <div className="flex items-center gap-2 min-w-0">
                                {allRecipeDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                                <p className={cn(
                                  "text-sm font-semibold truncate",
                                  allRecipeDone ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"
                                )}>
                                  {recipe.subRecipeOriginName ?? recipe.recipeName}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <span className="text-sm text-muted-foreground tabular-nums">
                                  {fmtPrepQty(recipe.qtyForRecipe, ing.unit)}
                                </span>
                                {isEditingTins ? (
                                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      autoFocus
                                      className="w-12 px-1.5 py-0.5 text-sm text-center border border-primary rounded-md bg-background tabular-nums"
                                      value={editTinValue}
                                      onChange={e => setEditTinValue(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === "Enter") {
                                          const v = parseInt(editTinValue);
                                          if (v >= 1) setTinOverride(recipe.recipeId, ing.ingredientId, !!recipe.isFillingMix, v);
                                        }
                                        if (e.key === "Escape") { setEditingTinKey(null); setEditTinValue(""); }
                                      }}
                                    />
                                    <button
                                      disabled={savingTinOverride}
                                      onClick={() => {
                                        const v = parseInt(editTinValue);
                                        if (v >= 1) setTinOverride(recipe.recipeId, ing.ingredientId, !!recipe.isFillingMix, v);
                                      }}
                                      className="p-1 text-primary hover:bg-primary/10 rounded"
                                    >
                                      {savingTinOverride ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    </button>
                                    <button
                                      onClick={() => { setEditingTinKey(null); setEditTinValue(""); }}
                                      className="p-1 text-muted-foreground hover:bg-secondary rounded"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <span className={cn(
                                      "text-sm font-semibold tabular-nums",
                                      recipe.isOverridden ? "text-blue-600" : (allRecipeDone ? "text-emerald-600" : "text-muted-foreground")
                                    )}>
                                      {rDone + rDeferred}/{rTins.length}
                                      {rDeferred > 0 && (
                                        <span className="ml-1 text-xs text-amber-600 font-medium">({rDeferred} def)</span>
                                      )}
                                    </span>
                                    {recipe.isOverridden && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setTinOverride(recipe.recipeId, ing.ingredientId, !!recipe.isFillingMix, null); }}
                                        className="p-0.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                        title="Reset to auto"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setEditingTinKey(tinEditKey); setEditTinValue(String(recipe.tinCount)); }}
                                      className="p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded"
                                      title="Edit tin count"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {recipe.isFillingMix && recipe.isOverridden && (
                              <p className="text-xs text-blue-600 dark:text-blue-400 px-3 -mt-1 mb-2">Mixing tin count overridden for this recipe</p>
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                              {rTins.map(tn => {
                                const done = isCompleted(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null);
                                const completion = getCompletion(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null);
                                // A tin is shown as "deferred" only when it's
                                // been deferred AND not yet completed. Once
                                // it's completed (on the deferred-to day) the
                                // green completion state wins so the source
                                // plan's view can reflect 100%.
                                const deferred = !done && isDeferred(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null);
                                const deferral = deferred ? getDeferral(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null) : null;
                                const tinKey = `${ing.ingredientId}_${recipe.recipeId}_${tn}_${recipe.subRecipeOriginId ?? "x"}_${ing.isSubRecipe ? "s" : "i"}`;
                                const menuOpen = openTinMenu === tinKey;
                                const targetDateLabel = nextPlan?.planDate
                                  ? format(parseISO(nextPlan.planDate), "EEE d MMM")
                                  : "production day";
                                return (
                                  <div key={tn} className="relative">
                                    <button
                                      onClick={() => toggleTin(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null)}
                                      disabled={isOnBreak || deferred}
                                      title={deferred ? "Deferred — use the menu to cancel" : undefined}
                                      className={cn(
                                        "w-full relative flex flex-col items-center border-2 rounded-2xl px-3 py-3.5 transition-all active:scale-95",
                                        isOnBreak ? "opacity-50 cursor-not-allowed" : "",
                                        done
                                          ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600 shadow-sm"
                                          : deferred
                                            ? "bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-600 shadow-sm cursor-default"
                                            : "bg-background border-border hover:border-emerald-400 hover:shadow-md"
                                      )}
                                    >
                                      <div className="flex items-center gap-1.5 mb-1.5">
                                        {done ? (
                                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                        ) : deferred ? (
                                          <Clock3 className="w-4 h-4 text-amber-600" />
                                        ) : (
                                          <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40" />
                                        )}
                                        <span className="text-base font-bold">{prepTinTileLabel(tn)}</span>
                                      </div>
                                      <span className={cn(
                                        "text-2xl font-bold tabular-nums",
                                        done ? "text-emerald-700 dark:text-emerald-300"
                                          : deferred ? "text-amber-700 dark:text-amber-300"
                                          : "text-foreground"
                                      )}>
                                        {fmtPrepQty(recipe.qtyPerTin, ing.unit)}
                                      </span>
                                      {done && completion && (
                                        <span className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 leading-tight text-center">
                                          {completion.userName ?? "User"} · {format(new Date(completion.completedAt), "HH:mm")}
                                        </span>
                                      )}
                                      {deferred && deferral && (
                                        <span className="text-xs text-amber-700 dark:text-amber-400 mt-1 leading-tight text-center font-semibold">
                                          → {format(parseISO(deferral.deferredToDate), "EEE d MMM")}
                                        </span>
                                      )}
                                    </button>
                                    {/* Kebab menu trigger — sits outside the
                                        main button to avoid nested-button HTML
                                        violations. Opens a small popover with
                                        defer / cancel-defer. Hidden when the
                                        tin is already completed (defer makes
                                        no sense for done items). */}
                                    {!done && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenTinMenu(menuOpen ? null : tinKey);
                                        }}
                                        className={cn(
                                          "absolute top-1.5 right-1.5 p-1 rounded-md transition-colors",
                                          menuOpen
                                            ? "bg-secondary text-foreground"
                                            : "text-muted-foreground/60 hover:text-foreground hover:bg-secondary/80"
                                        )}
                                        title="More options"
                                      >
                                        <MoreVertical className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {menuOpen && (
                                      <div
                                        ref={tinMenuRef}
                                        className="absolute z-20 top-full right-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg overflow-hidden"
                                      >
                                        {deferred ? (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setOpenTinMenu(null);
                                              toggleDeferral(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null);
                                            }}
                                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-secondary flex items-center gap-2"
                                          >
                                            <XIcon className="w-4 h-4 text-muted-foreground" />
                                            Cancel deferral
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setOpenTinMenu(null);
                                              toggleDeferral(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe, recipe.subRecipeOriginId ?? null);
                                            }}
                                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-secondary flex items-start gap-2"
                                          >
                                            <Clock3 className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                            <span>
                                              <span className="block font-medium">Defer to {targetDateLabel}</span>
                                              <span className="block text-xs text-muted-foreground leading-snug">Prep this tin on production day instead</span>
                                            </span>
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* Stock check */}
                      {stockCheckActiveToday(ing) && !status.allTinsDone && (
                        <div className="mt-4 bg-blue-50/30 dark:bg-blue-950/10 border border-blue-200/50 dark:border-blue-800/50 rounded-xl p-3 opacity-60">
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-blue-400" />
                            <p className="text-sm text-blue-600 dark:text-blue-400">Stock check required after all tins are completed</p>
                          </div>
                        </div>
                      )}
                      {status.needsStockCheck && (() => {
                        const savedStr = stockValues[ing.ingredientId];
                        const currentNative = status.stockSaved && savedStr !== undefined ? Number(savedStr) : null;
                        return (
                        <div ref={stockCheckRef} className="mt-4 bg-blue-50/70 dark:bg-blue-950/30 border-2 border-blue-400 dark:border-blue-600 rounded-xl p-4 shadow-md">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Package className={cn("w-5 h-5 text-blue-600", !status.stockSaved && "animate-pulse")} />
                            <div className="flex-1 min-w-[10rem]">
                              <p className="text-lg font-bold text-blue-800 dark:text-blue-200">Stock Check</p>
                              <p className="text-sm text-blue-600 dark:text-blue-400">
                                {status.stockSaved ? "Counted — tap to recount if it's changed." : `How much ${ing.ingredientName.toLowerCase()} is left?`}
                              </p>
                            </div>
                            <StockCheckButton
                              ingredient={{ id: ing.ingredientId, name: ing.ingredientName, unit: ing.unit, packWeight: ing.packWeight }}
                              checkDate={checkDate}
                              isDraft={isDraft}
                              currentNative={currentNative}
                              planNeedNative={ing.totalQty}
                              onSaved={native => onStockSaved(ing.ingredientId, native)}
                            />
                          </div>
                        </div>
                        );
                      })()}

              </div>
              );
            })() : (
              <div className="bg-card border-2 border-dashed border-border rounded-2xl p-12 flex flex-col items-center justify-center text-muted-foreground">
                <ClipboardList className="w-12 h-12 mb-3 opacity-40" />
                <p className="font-medium">Select an ingredient to view its tins</p>
              </div>
            )}
          </div>
        </div>
      )}
      {sopViewer.dialog}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ForceStockCheckModal — shown to the person who just finished prepping an
// ingredient with a stock check due and no count yet. The count itself is
// the shared two-step entry (amount, then a unit they tap — Graeme, 15 Oct
// 2026). Skip (or the X) puts it off; it can still be logged from the Stock
// Check Status panel.
// ─────────────────────────────────────────────────────────────────────────
function ForceStockCheckModal({
  ingredient,
  checkDate,
  isDraft,
  onSaved,
  onSkip,
  remainingCount,
}: {
  ingredient: MainPrepIngredient;
  checkDate: string;
  isDraft: boolean;
  onSaved: (nativeQty: number) => void;
  onSkip: () => void;
  remainingCount: number;
}) {
  // This component IS the modal: pin the page behind it for its lifetime
  // (the ovens weight-modal bug, same cure — Graeme, 2026-09-07).
  useModalScrollKeeper();
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Stock check required: ${ingredient.ingredientName}`}
        className="bg-card border-2 border-blue-500 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border/60">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-xl">Stock check required</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Prep of <span className="font-semibold text-foreground">{ingredient.ingredientName}</span> is done.
              Record what&rsquo;s left in stock before moving on.
            </p>
            {remainingCount > 1 && (
              <p className="text-xs text-amber-600 mt-1.5 font-medium">
                +{remainingCount - 1} more stock check{remainingCount - 1 === 1 ? "" : "s"} waiting after this one.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Skip for now"
            title="Skip this stock check for now — you can still log it from the Stock Check tab"
            className="w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <StockCheckEntryForm
            ingredient={{ id: ingredient.ingredientId, name: ingredient.ingredientName, unit: ingredient.unit, packWeight: ingredient.packWeight }}
            checkDate={checkDate}
            isDraft={isDraft}
            planNeedNative={ingredient.totalQty}
            onSaved={onSaved}
            onCancel={onSkip}
            cancelLabel="Skip"
          />
          <p className="text-xs text-muted-foreground mt-3">
            Enter <span className="font-semibold">0</span> if there&rsquo;s nothing left — this is still a valid record.
          </p>
        </div>
      </div>
    </div>
  );
}
