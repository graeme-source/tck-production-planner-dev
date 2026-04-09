import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useListSubRecipes,
  useGetSubRecipe,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, SubRecipe } from "@workspace/api-client-react";
import {
  Loader2, CheckCircle2, Layers, Square, ArrowLeft, Beaker, Search,
  FlaskConical, ChevronRight, Minus, Plus, PackageSearch,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { BreakTracker } from "../shared/break-tracker";
import { PrepDateBanner, PrepDraftBanner, useNextActivePlan, fmtQty, toastDraftBlocked } from "../shared/prep-helpers";
import type { NextActivePlan } from "../shared/prep-helpers";
import { PrepSubNav } from "./prep-hub";
import { useMainPrepData } from "./main-prep-station";
import type { MainPrepIngredient } from "./main-prep-station";

interface SubRecipePlanRequirement {
  subRecipeId: number;
  subRecipeName: string;
  yield: number;
  yieldUnit: string;
  shelfLifeDays: number | null;
  isBase?: boolean | null;
  totalRequired: number;
  ingredients: Array<{
    id: number;
    ingredientId: number;
    ingredientName: string;
    unit: string;
    quantity: number;
    packWeight?: number | null;
  }>;
  subRecipeComponents: Array<{
    id: number;
    componentSubRecipeId: number;
    componentSubRecipeName: string;
    componentYieldUnit: string;
    quantity: number;
  }>;
}

function fmtScaledQty(qty: number, unit: string, batches: number): string {
  const scaled = qty * batches;
  if (unit === "g" && scaled >= 1000) return `${(scaled / 1000).toFixed(3)} kg`;
  if (unit === "ml" && scaled >= 1000) return `${(scaled / 1000).toFixed(3)} l`;
  return `${scaled % 1 === 0 ? scaled : scaled.toFixed(3)} ${unit}`;
}

function ScaledIngredientChecklist({
  ingredients,
  subRecipeComponents,
  batches,
  checked,
  onToggle,
}: {
  ingredients: SubRecipePlanRequirement["ingredients"];
  subRecipeComponents: SubRecipePlanRequirement["subRecipeComponents"];
  batches: number;
  checked: Set<string>;
  onToggle: (key: string) => void;
}) {
  const allItems = [
    ...ingredients.map(i => ({ key: `ing-${i.id}`, label: i.ingredientName, qty: i.quantity, unit: i.unit, isComponent: false, packWeight: i.packWeight ?? null })),
    ...subRecipeComponents.map(c => ({ key: `comp-${c.id}`, label: c.componentSubRecipeName, qty: c.quantity, unit: c.componentYieldUnit, isComponent: true, packWeight: null as number | null })),
  ];

  if (allItems.length === 0) {
    return <p className="text-base text-muted-foreground italic py-4 text-center">No ingredients defined for this sub-recipe.</p>;
  }

  return (
    <div className="space-y-2">
      {allItems.map(item => {
        const isDone = checked.has(item.key);
        return (
          <button
            key={item.key}
            onClick={() => onToggle(item.key)}
            className={cn(
              "w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 text-left transition-all active:scale-[0.99]",
              isDone
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20"
                : item.isComponent
                  ? "border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10"
                  : "border-border bg-background hover:bg-secondary/30"
            )}
          >
            {isDone
              ? <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />
              : item.isComponent
                ? <Layers className="w-6 h-6 text-primary/70 flex-shrink-0" />
                : <Square className="w-6 h-6 text-muted-foreground/40 flex-shrink-0" />
            }
            <span className={cn("flex-1 font-medium text-base", isDone && "line-through text-muted-foreground")}>
              {item.label}
            </span>
            <div className="text-right flex-shrink-0">
              {item.packWeight && item.packWeight > 0 && (() => {
                const scaledQty = item.qty * batches;
                // Convert to same unit as packWeight (g) for comparison
                const scaledG = item.unit === "kg" ? scaledQty * 1000 : scaledQty;
                const packs = Math.ceil(scaledG / item.packWeight);
                return (
                  <span className={cn("text-sm tabular-nums block", isDone ? "text-emerald-600/70 dark:text-emerald-400/70" : "text-muted-foreground")}>
                    {packs} {packs === 1 ? "pack" : "packs"}
                  </span>
                );
              })()}
              <span className={cn("text-xl font-bold tabular-nums", isDone ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                {fmtScaledQty(item.qty, item.unit, batches)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

type SubReplenishMode = "plan" | "standalone";

interface SubReplenishState {
  phase: "pick" | "stock_check" | "batch_pick" | "checklist" | "done";
  sr: SubRecipePlanRequirement | null;
  batchMultiplier: 1 | 2 | 4 | "custom";
  customBatches: number;
  stockOnHand: string;
  batches: number;
  checked: Set<string>;
}

export function SubRecipeMakeFlow({
  mode,
  planRequirements,
  allSubRecipes,
  onClose,
  onDone,
}: {
  mode: SubReplenishMode;
  planRequirements: SubRecipePlanRequirement[];
  allSubRecipes: SubRecipe[];
  onClose?: () => void;
  onDone?: (subRecipeId: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<SubReplenishState>({
    phase: "pick",
    sr: null,
    batchMultiplier: 1,
    customBatches: 1,
    stockOnHand: "",
    batches: 1,
    checked: new Set(),
  });

  const selectSr = (sr: SubRecipePlanRequirement) => {
    setLoadedDetail(null);
    if (mode === "plan") {
      setState(s => ({ ...s, phase: "stock_check", sr }));
    } else {
      setState(s => ({ ...s, phase: "batch_pick", sr, batchMultiplier: 1, customBatches: 1 }));
    }
  };

  const resolveStandaloneSr = (sr: SubRecipe): SubRecipePlanRequirement => ({
    subRecipeId: sr.id,
    subRecipeName: sr.name,
    yield: Number(sr.yield),
    yieldUnit: sr.yieldUnit,
    shelfLifeDays: null,
    totalRequired: 0,
    ingredients: [],
    subRecipeComponents: [],
  });

  const [loadedDetail, setLoadedDetail] = useState<SubRecipePlanRequirement | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (!state.sr || state.phase === "pick") return;
    if (state.sr.ingredients.length > 0 || state.sr.subRecipeComponents.length > 0) {
      setLoadedDetail(state.sr);
      return;
    }
    setLoadingDetail(true);
    fetch(`/api/sub-recipes/${state.sr.subRecipeId}`, { credentials: "include" })
      .then(r => r.json())
      .then((d: {
        id: number; name: string; yield: number; yieldUnit: string; shelfLifeDays: number | null;
        ingredients: Array<{ id: number; ingredientId: number; ingredientName: string; unit: string; quantity: number; packWeight?: number | null }>;
        subRecipeComponents: Array<{ id: number; componentSubRecipeId: number; componentSubRecipeName: string; componentYieldUnit: string; quantity: number }>;
      }) => {
        setLoadedDetail({
          subRecipeId: d.id,
          subRecipeName: d.name,
          yield: Number(d.yield),
          yieldUnit: d.yieldUnit,
          shelfLifeDays: d.shelfLifeDays,
          totalRequired: state.sr?.totalRequired ?? 0,
          ingredients: (d.ingredients ?? []).map(i => ({ id: i.id, ingredientId: i.ingredientId, ingredientName: i.ingredientName ?? "", unit: i.unit ?? "kg", quantity: Number(i.quantity), packWeight: i.packWeight ? Number(i.packWeight) : null })),
          subRecipeComponents: (d.subRecipeComponents ?? []).map(c => ({ id: c.id, componentSubRecipeId: c.componentSubRecipeId, componentSubRecipeName: c.componentSubRecipeName ?? "", componentYieldUnit: c.componentYieldUnit ?? "kg", quantity: Number(c.quantity) })),
        });
        setLoadingDetail(false);
      })
      .catch((err) => { console.warn("[PrepBases] Detail fetch failed:", err); setLoadingDetail(false); });
  }, [state.sr, state.phase]);

  const sr = loadedDetail ?? state.sr;
  const effectiveBatches = state.batchMultiplier === "custom" ? state.customBatches : state.batchMultiplier;
  const yieldPerBatch = sr?.yield ?? 1;
  const totalYield = yieldPerBatch * effectiveBatches;

  const netNeeded = (() => {
    if (mode !== "plan" || !sr) return null;
    const stock = parseFloat(state.stockOnHand);
    if (isNaN(stock)) return null;
    return Math.max(0, sr.totalRequired - stock);
  })();

  const autoBatches = (() => {
    if (netNeeded == null || yieldPerBatch <= 0) return null;
    return Math.ceil(netNeeded / yieldPerBatch);
  })();

  const checkedCount = state.checked.size;
  const totalItems = (sr?.ingredients?.length ?? 0) + (sr?.subRecipeComponents?.length ?? 0);

  const startChecklist = () => {
    if (mode === "plan") {
      const batches = autoBatches ?? 1;
      setState(s => ({ ...s, phase: "checklist", batches, checked: new Set() }));
    } else {
      setState(s => ({ ...s, phase: "checklist", batches: effectiveBatches, checked: new Set() }));
    }
  };

  const toggleItem = (key: string) => {
    setState(s => {
      const next = new Set(s.checked);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...s, checked: next };
    });
  };

  const filteredList = mode === "plan"
    ? planRequirements
        .filter(r => r.isBase !== false)
        .filter(r => r.subRecipeName.toLowerCase().includes(search.toLowerCase()))
    : allSubRecipes
        .filter(r => !r.isBase)
        .filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
        .map(resolveStandaloneSr);

  const back = () => {
    setLoadedDetail(null);
    setState(s => ({ ...s, phase: "pick", sr: null, stockOnHand: "", batchMultiplier: 1, customBatches: 1, checked: new Set() }));
  };

  if (state.phase === "done") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-6">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        </div>
        <div className="text-center">
          <h3 className="font-bold text-2xl">{sr?.subRecipeName} Complete!</h3>
          <p className="text-muted-foreground mt-1">
            {state.batches} batch{state.batches !== 1 ? "es" : ""} made · {(yieldPerBatch * state.batches).toFixed(3)} {sr?.yieldUnit} ready
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={back} className="px-6 py-3 rounded-xl border border-border hover:bg-secondary/60 font-medium transition-colors">
            Make Another
          </button>
          {onClose && (
            <button onClick={onClose} className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
              Done
            </button>
          )}
        </div>
      </div>
    );
  }

  if (state.phase === "checklist") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={back} className="p-2 rounded-lg hover:bg-secondary/60 transition-colors">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex-1">
            <h3 className="font-bold text-xl">{sr?.subRecipeName}</h3>
            <p className="text-base text-muted-foreground">
              {state.batches} batch{state.batches !== 1 ? "es" : ""} · Total yield: {(yieldPerBatch * state.batches).toFixed(3)} {sr?.yieldUnit}
            </p>
          </div>
          <div className={cn(
            "px-3 py-1.5 rounded-xl text-base font-semibold",
            checkedCount === totalItems && totalItems > 0
              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
              : "bg-secondary/50 text-muted-foreground"
          )}>
            {checkedCount}/{totalItems} done
          </div>
        </div>

        {loadingDetail ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <ScaledIngredientChecklist
              ingredients={sr?.ingredients ?? []}
              subRecipeComponents={sr?.subRecipeComponents ?? []}
              batches={state.batches}
              checked={state.checked}
              onToggle={toggleItem}
            />

            {checkedCount === totalItems && totalItems > 0 && (
              <button
                onClick={() => {
                  if (state.sr) onDone?.(state.sr.subRecipeId);
                  setState(s => ({ ...s, phase: "done" }));
                }}
                className="w-full py-4 mt-4 rounded-2xl bg-emerald-500 text-white font-bold text-base hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" />
                Mark Complete
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  if (state.phase === "stock_check" && sr) {
    const stock = parseFloat(state.stockOnHand);
    const stockValid = !isNaN(stock) && stock >= 0;
    const net = stockValid ? Math.max(0, sr.totalRequired - stock) : null;
    const batchCount = (net != null && yieldPerBatch > 0) ? Math.ceil(net / yieldPerBatch) : null;
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={back} className="p-2 rounded-lg hover:bg-secondary/60 transition-colors">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div>
            <h3 className="font-bold text-xl">{sr.subRecipeName}</h3>
            <p className="text-base text-muted-foreground">Stock check before production</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-secondary/30 rounded-xl px-4 py-3">
              <p className="text-sm text-muted-foreground mb-1">Required by plan</p>
              <p className="text-2xl font-bold tabular-nums">{sr.totalRequired.toFixed(3)} <span className="text-base font-medium text-muted-foreground">{sr.yieldUnit}</span></p>
            </div>
            <div className="bg-secondary/30 rounded-xl px-4 py-3">
              <p className="text-sm text-muted-foreground mb-1">Yield per batch</p>
              <p className="text-2xl font-bold tabular-nums">{yieldPerBatch.toFixed(3)} <span className="text-base font-medium text-muted-foreground">{sr.yieldUnit}</span></p>
            </div>
          </div>

          <div>
            <label className="text-base font-semibold block mb-2">How much is currently in stock?</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={0.1}
                value={state.stockOnHand}
                onChange={e => setState(s => ({ ...s, stockOnHand: e.target.value }))}
                placeholder={`0.00`}
                autoFocus
                className="flex-1 px-4 py-3 border-2 border-border rounded-xl text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              <span className="text-base font-medium text-muted-foreground">{sr.yieldUnit}</span>
            </div>
          </div>

          {stockValid && net != null && (
            <div className="space-y-2">
              <div className={cn(
                "rounded-xl px-4 py-3 flex items-center justify-between",
                net === 0 ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800"
                  : "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"
              )}>
                <span className="text-base font-medium">Net needed</span>
                <span className="text-xl font-bold tabular-nums">{net.toFixed(3)} {sr.yieldUnit}</span>
              </div>
              {batchCount !== null && (
                <div className={cn(
                  "rounded-xl px-4 py-4 flex items-center justify-between",
                  batchCount === 0
                    ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800"
                    : "bg-primary/10 border border-primary/30"
                )}>
                  <div>
                    <p className="text-base font-medium text-muted-foreground">Batches to make</p>
                    <p className="text-sm text-muted-foreground mt-0.5">⌈{net.toFixed(3)} ÷ {yieldPerBatch.toFixed(3)}⌉ = {batchCount}</p>
                  </div>
                  <span className="text-4xl font-bold tabular-nums text-primary">{batchCount}</span>
                </div>
              )}
            </div>
          )}

          {stockValid && batchCount !== null && batchCount === 0 ? (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              <p className="text-emerald-700 dark:text-emerald-300 font-semibold">Stock is sufficient — no batches needed</p>
            </div>
          ) : (
            <button
              disabled={!stockValid || batchCount == null || batchCount <= 0}
              onClick={startChecklist}
              className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Beaker className="w-5 h-5" />
              Start Making {batchCount != null && batchCount > 0 ? `${batchCount} Batch${batchCount !== 1 ? "es" : ""}` : ""}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (state.phase === "batch_pick" && sr) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={back} className="p-2 rounded-lg hover:bg-secondary/60 transition-colors">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div>
            <h3 className="font-bold text-xl">{sr.subRecipeName}</h3>
            <p className="text-base text-muted-foreground">Choose how many batches to make</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="bg-secondary/30 rounded-xl px-4 py-3">
            <p className="text-sm text-muted-foreground mb-1">Yield per batch</p>
            <p className="text-xl font-bold tabular-nums">{yieldPerBatch.toFixed(3)} {sr.yieldUnit}</p>
          </div>

          <div>
            <p className="text-base font-semibold mb-3">Number of batches</p>
            <div className="flex items-center gap-2 flex-wrap">
              {([1, 2, 4] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setState(s => ({ ...s, batchMultiplier: m }))}
                  className={cn(
                    "px-5 py-3 rounded-xl text-base font-bold border-2 transition-all",
                    state.batchMultiplier === m
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-secondary/60"
                  )}
                >
                  {m}×
                </button>
              ))}
              <button
                onClick={() => setState(s => ({ ...s, batchMultiplier: "custom" }))}
                className={cn(
                  "px-5 py-3 rounded-xl text-base font-bold border-2 transition-all",
                  state.batchMultiplier === "custom"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-secondary/60"
                )}
              >
                Custom
              </button>
            </div>

            {state.batchMultiplier === "custom" && (
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() => setState(s => ({ ...s, customBatches: Math.max(1, s.customBatches - 1) }))}
                  className="w-10 h-10 rounded-xl border-2 border-border flex items-center justify-center hover:bg-secondary/60 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min={1}
                  value={state.customBatches}
                  onChange={e => setState(s => ({ ...s, customBatches: Math.max(1, Number(e.target.value) || 1) }))}
                  className="w-20 text-center px-3 py-2.5 border-2 border-border rounded-xl text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  onClick={() => setState(s => ({ ...s, customBatches: s.customBatches + 1 }))}
                  className="w-10 h-10 rounded-xl border-2 border-border flex items-center justify-center hover:bg-secondary/60 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <span className="text-base text-muted-foreground">batches</span>
              </div>
            )}

            <div className="mt-3 bg-primary/10 rounded-xl px-4 py-2.5">
              <p className="text-base font-semibold text-primary">Total yield: {totalYield.toFixed(3)} {sr.yieldUnit}</p>
            </div>
          </div>

          <button
            onClick={startChecklist}
            className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Beaker className="w-5 h-5" />
            Start Making {effectiveBatches} Batch{effectiveBatches !== 1 ? "es" : ""}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {onClose && (
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary/60 transition-colors">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={mode === "plan" ? "Search plan sub-recipes…" : "Search all sub-recipes…"}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {filteredList.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <PackageSearch className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No sub-recipes found</p>
          {mode === "plan" && (
            <p className="text-base mt-1">No sub-recipe components are linked to this production plan's recipes.</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        {filteredList.map(sr => {
          const batchsNeeded = mode === "plan" && sr.totalRequired > 0 && sr.yield > 0
            ? Math.ceil(sr.totalRequired / sr.yield)
            : null;
          return (
            <button
              key={sr.subRecipeId}
              onClick={() => selectSr(sr)}
              className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 border-border bg-card hover:border-primary/40 hover:bg-primary/5 text-left transition-all active:scale-[0.99]"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                <FlaskConical className="w-5 h-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-base truncate">{sr.subRecipeName}</p>
                <p className="text-base text-muted-foreground">
                  {sr.yield.toFixed(3)} {sr.yieldUnit} per batch
                  {mode === "plan" && sr.totalRequired > 0 && ` · ${sr.totalRequired.toFixed(3)} ${sr.yieldUnit} required`}
                </p>
              </div>
              {batchsNeeded !== null && (
                <div className="text-right flex-shrink-0">
                  <p className="text-2xl font-bold text-primary tabular-nums">{batchsNeeded}</p>
                  <p className="text-sm text-muted-foreground">batch{batchsNeeded !== 1 ? "es" : ""}</p>
                </div>
              )}
              <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Bases & Sauces Prep Station
// Left: recipe list overview. Right: focused ingredient detail for selected recipe.
// ──────────────────────────────────────────────────────────────────────────────
function usePlanSubRecipeRequirements(planId: number) {
  const [data, setData] = useState<SubRecipePlanRequirement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/production-plans/${planId}/sub-recipe-requirements`, { credentials: "include" })
      .then(r => r.json())
      .then((d: { subRecipes?: SubRecipePlanRequirement[] }) => {
        setData(d.subRecipes ?? []);
        setLoading(false);
      })
      .catch((err) => { console.warn("[PrepBases] Sub-recipes fetch failed:", err); setLoading(false); });
  }, [planId]);

  return { subRecipes: data, loading };
}

export function PrepBasesStation({ plan }: { plan: ProductionPlanDetail }) {
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [selectedItem, setSelectedItem] = useState<"tomato_base" | number>("tomato_base");
  const [completedSubRecipeIds, setCompletedSubRecipeIds] = useState<Set<number>>(new Set());
  const { data: nextPlanData, isLoading: isNextPlanLoading } = useNextActivePlan(plan.planDate);
  const nextPlan = nextPlanData as NextActivePlan | null;
  const noFuturePlan = !isNextPlanLoading && nextPlan != null && nextPlan.planId == null;
  const isDraft = nextPlan?.status === "draft";
  const targetPlanId = noFuturePlan ? plan.id : (nextPlan?.planId ?? plan.id);
  const { subRecipes: planSubRecipes, loading: subRecipesLoading } = usePlanSubRecipeRequirements(targetPlanId);
  const { data: allSubRecipesData } = useListSubRecipes();
  const allSubRecipes = (allSubRecipesData ?? []) as SubRecipe[];

  const handleSubRecipeDone = (subRecipeId: number) => {
    if (isDraft) { toastDraftBlocked(); return; }
    setCompletedSubRecipeIds(prev => new Set([...prev, subRecipeId]));
  };

  // Tomato Base is "done" when every base sub-recipe in the plan has been completed
  const baseSubRecipes = planSubRecipes.filter(r => r.isBase !== false);
  const tomatoBaseDone = baseSubRecipes.length > 0 && baseSubRecipes.every(r => completedSubRecipeIds.has(r.subRecipeId));
  const { data, loading, refetch } = useMainPrepData(targetPlanId, "prep_bases");

  // "Normal Base" is represented by the top-level Tomato Base item — exclude from sauce list
  const ingredients = (data?.ingredients ?? []).filter(
    i => !i.ingredientName.toLowerCase().includes("normal base")
  );
  const completions = data?.completions ?? [];

  const isCompleted = (ingredientId: number, recipeId: number, tinNumber: number) =>
    completions.some(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === tinNumber);

  const getCompletion = (ingredientId: number, recipeId: number, tinNumber: number) =>
    completions.find(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === tinNumber);

  const ingredientDoneStatus = (ing: MainPrepIngredient) => {
    let totalTinCount = 0;
    let completedTinCount = 0;
    for (const r of ing.recipes) {
      totalTinCount += r.tinCount;
      for (let tn = 1; tn <= r.tinCount; tn++) {
        if (isCompleted(ing.ingredientId, r.recipeId, tn)) completedTinCount++;
      }
    }
    const allTinsDone = totalTinCount > 0 && completedTinCount >= totalTinCount;
    return { allTinsDone, isFullyDone: allTinsDone, totalTinCount, completedTinCount };
  };

  const recipeIngredientStatus = (ing: MainPrepIngredient, recipeId: number) => {
    const recipe = ing.recipes.find(r => r.recipeId === recipeId);
    if (!recipe) return { completedTins: 0, totalTins: 0, allDone: false };
    const totalTins = recipe.tinCount;
    const completedTins = Array.from({ length: totalTins }, (_, i) => i + 1)
      .filter(tn => isCompleted(ing.ingredientId, recipeId, tn)).length;
    return { completedTins, totalTins, allDone: totalTins > 0 && completedTins >= totalTins };
  };

  const getPreppedByInitials = (ingredientId: number, recipeId?: number): { initials: string; fullName: string }[] => {
    const seen = new Set<string>();
    const result: { initials: string; fullName: string }[] = [];
    for (const c of completions) {
      if (c.ingredientId !== ingredientId || !c.userName) continue;
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

  const leftGroups = useMemo(() => {
    const map = new Map<number, {
      recipeId: number;
      recipeName: string;
      batchesTarget: number;
      items: Array<{ ing: MainPrepIngredient; qtyForRecipe: number }>;
    }>();
    for (const ing of ingredients) {
      for (const r of ing.recipes) {
        if (!map.has(r.recipeId)) {
          map.set(r.recipeId, { recipeId: r.recipeId, recipeName: r.recipeName, batchesTarget: r.batchesTarget, items: [] });
        }
        map.get(r.recipeId)!.items.push({ ing, qtyForRecipe: r.qtyForRecipe });
      }
    }
    return [...map.values()];
  }, [ingredients]);

  const selectedIngredient = typeof selectedItem === "number"
    ? ingredients.find(i => i.ingredientId === selectedItem) ?? null
    : null;

  const toggleTin = async (ingredientId: number, recipeId: number, tinNumber: number) => {
    if (isOnBreak) return;
    if (isDraft) { toastDraftBlocked(); return; }
    const existing = getCompletion(ingredientId, recipeId, tinNumber);
    if (existing) {
      await fetch(`/api/production-plans/${targetPlanId}/prep-completions/by-tin`, {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, recipeId, tinNumber }),
      });
    } else {
      await fetch(`/api/production-plans/${targetPlanId}/prep-completions`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, recipeId, tinNumber }),
      });
    }
    refetch();
  };

  const totalTins = ingredients.reduce((s, ing) => s + ing.totalTinCount, 0);
  const completedTins = ingredients.reduce((s, ing) => {
    const status = ingredientDoneStatus(ing);
    return s + status.completedTinCount;
  }, 0);
  const overallPct = totalTins > 0 ? Math.round((Math.min(completedTins, totalTins) / totalTins) * 100) : 0;

  if (loading || isNextPlanLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  if (noFuturePlan) {
    return (
      <div className="space-y-4">
        <PrepSubNav planId={plan.id} current="prep_bases" />
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <h2 className="font-semibold text-lg mb-1">No future production plan</h2>
          <p className="text-muted-foreground text-sm">
            There is no upcoming active production plan to prep for.
            Create and activate a future plan to see prep requirements here.
          </p>
        </div>
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
          onActivated={refetch}
        />
      )}
      <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />

      <PrepSubNav planId={plan.id} current="prep_bases" />

      {/* Sauce progress bar (excludes Tomato Base which tracks via sub-recipe) */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-yellow-500" />
            <div>
              <h2 className="font-semibold text-base">Sauces</h2>
              <p className="text-sm text-muted-foreground">
                {ingredients.length > 0 ? `${completedTins} of ${totalTins} tins completed` : "No sauces to prep"}
              </p>
            </div>
          </div>
          <span className="text-2xl font-bold font-display">{ingredients.length > 0 ? `${overallPct}%` : "—"}</span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden mb-3">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 && ingredients.length > 0 ? "bg-yellow-500" : "bg-yellow-400")}
            style={{ width: `${ingredients.length > 0 ? Math.min(overallPct, 100) : 0}%` }}
          />
        </div>
        <div className="pt-3 border-t border-border/50">
          <BreakTracker planId={targetPlanId} stationType="prep_bases" onBreakActiveChange={setIsOnBreak} />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* LEFT — Tomato Base pinned at top, then sauce ingredients by recipe */}
        <div className="lg:w-80 xl:w-96 flex-shrink-0">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Prep Items</p>
            </div>
            <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
              {/* Tomato Base — special pinned item */}
              <button
                onClick={() => setSelectedItem("tomato_base")}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border",
                  selectedItem === "tomato_base"
                    ? "bg-primary/10 border-l-4 border-l-primary"
                    : "hover:bg-secondary/40 border-l-4 border-l-transparent",
                  tomatoBaseDone && selectedItem !== "tomato_base" && "opacity-60"
                )}
              >
                {tomatoBaseDone ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-500" />
                ) : (
                  <FlaskConical className={cn("w-4 h-4 flex-shrink-0", selectedItem === "tomato_base" ? "text-primary" : "text-muted-foreground")} />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    "text-base font-semibold",
                    selectedItem === "tomato_base" && "text-primary",
                    tomatoBaseDone && "line-through text-muted-foreground"
                  )}>
                    Tomato Base
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {tomatoBaseDone ? "Complete" : "Sub-recipe production"}
                  </p>
                </div>
                {!tomatoBaseDone && <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </button>

              {/* Sauce ingredients grouped by recipe */}
              {leftGroups.map((group, gi) => (
                <div key={group.recipeId} className={cn(gi > 0 && "border-t border-border")}>
                  <div className="px-4 py-2 bg-yellow-50/60 dark:bg-yellow-950/20 flex items-center justify-between">
                    <p className="text-sm font-bold uppercase tracking-wider text-yellow-800 dark:text-yellow-300 truncate">
                      {group.recipeName}
                    </p>
                    <span className="text-sm text-yellow-600 dark:text-yellow-400 ml-2 whitespace-nowrap">
                      {group.batchesTarget} batch{group.batchesTarget !== 1 ? "es" : ""}
                    </span>
                  </div>
                  {group.items.map(({ ing }) => {
                    const rStatus = recipeIngredientStatus(ing, group.recipeId);
                    const isSelected = selectedItem === ing.ingredientId;
                    return (
                      <button
                        key={`${group.recipeId}-${ing.ingredientId}`}
                        onClick={() => setSelectedItem(ing.ingredientId)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-t border-border/30",
                          isSelected
                            ? "bg-yellow-500/10 border-l-4 border-l-yellow-500"
                            : "hover:bg-secondary/40 border-l-4 border-l-transparent",
                          rStatus.allDone && !isSelected && "opacity-60"
                        )}
                      >
                        <div className="flex-shrink-0">
                          {rStatus.allDone ? (
                            <CheckCircle2 className="w-4 h-4 text-yellow-500" />
                          ) : rStatus.totalTins > 0 ? (
                            <div className="relative w-4 h-4">
                              <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
                                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-border" />
                                {rStatus.completedTins > 0 && (
                                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2"
                                    className="text-yellow-500"
                                    strokeDasharray={`${(rStatus.completedTins / rStatus.totalTins) * 37.7} 37.7`}
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
                            "text-base font-medium truncate",
                            isSelected && "font-semibold",
                            rStatus.allDone && "line-through text-muted-foreground"
                          )}>
                            {ing.ingredientName}
                          </p>
                          {ing.recipes.length > 1 && (
                            <p className="text-sm text-amber-500">shared</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {rStatus.completedTins > 0 && getPreppedByInitials(ing.ingredientId, group.recipeId).map(({ initials, fullName }) => (
                            <span
                              key={fullName}
                              title={fullName}
                              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-500 text-white text-[9px] font-bold leading-none"
                            >
                              {initials}
                            </span>
                          ))}
                          {rStatus.totalTins > 0 && (
                            <span className={cn(
                              "text-sm tabular-nums",
                              rStatus.allDone ? "text-yellow-600 font-semibold" : "text-muted-foreground"
                            )}>
                              {rStatus.completedTins}/{rStatus.totalTins}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Sub-recipe flow for Tomato Base, tin view for sauces */}
        <div className="flex-1 min-w-0">
          {selectedItem === "tomato_base" ? (
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <FlaskConical className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="font-semibold">Tomato Base — Sub-Recipe Production</h3>
                  <p className="text-sm text-muted-foreground">Stock check → auto-calculate batches → ingredient checklist</p>
                </div>
              </div>
              {subRecipesLoading ? (
                <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <SubRecipeMakeFlow
                  mode="plan"
                  planRequirements={planSubRecipes}
                  allSubRecipes={allSubRecipes}
                  onDone={handleSubRecipeDone}
                />
              )}
            </div>
          ) : selectedIngredient ? (() => {
            const ing = selectedIngredient;
            const status = ingredientDoneStatus(ing);
            const isShared = ing.recipes.length > 1;
            return (
              <div
                className={cn(
                  "bg-card border-2 rounded-2xl p-5 transition-colors",
                  status.isFullyDone
                    ? "border-yellow-300 dark:border-yellow-700 bg-yellow-50/20 dark:bg-yellow-950/10"
                    : "border-border"
                )}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {status.isFullyDone && <CheckCircle2 className="w-5 h-5 text-yellow-500 flex-shrink-0" />}
                      <h3 className={cn(
                        "font-bold text-lg leading-tight",
                        status.isFullyDone && "line-through text-muted-foreground"
                      )}>
                        {ing.ingredientName}
                      </h3>
                    </div>
                    <p className="text-base text-muted-foreground mt-0.5">
                      <span className="font-semibold text-foreground">{fmtQty(ing.totalQty, ing.unit)}</span>
                      {" total · "}{status.completedTinCount}/{status.totalTinCount} tins done
                    </p>
                    {isShared && (
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                        <span className="font-medium">Shared —</span>
                        {" in: "}{ing.recipes.map(r => r.recipeName).join(", ")}
                      </p>
                    )}
                  </div>
                  {status.totalTinCount > 0 && (
                    <div className="ml-4 flex-shrink-0 text-right">
                      <p className={cn(
                        "text-3xl font-bold font-display tabular-nums",
                        status.isFullyDone ? "text-yellow-600" : "text-foreground"
                      )}>
                        {status.completedTinCount}
                        <span className="text-base text-muted-foreground font-normal">/{status.totalTinCount}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">tins</p>
                    </div>
                  )}
                </div>

                {status.totalTinCount > 1 && (
                  <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
                    <div
                      className={cn("h-full rounded-full transition-all", status.allTinsDone ? "bg-yellow-500" : "bg-yellow-400")}
                      style={{ width: `${status.totalTinCount > 0 ? Math.min((status.completedTinCount / status.totalTinCount) * 100, 100) : 0}%` }}
                    />
                  </div>
                )}

                {ing.recipes.map((recipe, ri) => {
                  const rTins = Array.from({ length: recipe.tinCount }, (_, i) => i + 1);
                  const rDone = rTins.filter(tn => isCompleted(ing.ingredientId, recipe.recipeId, tn)).length;
                  const allRecipeDone = rTins.length > 0 && rDone >= rTins.length;
                  return (
                    <div key={recipe.recipeId} className={cn(ri > 0 && "mt-4")}>
                      <div className={cn(
                        "flex items-center justify-between px-3 py-2 rounded-lg mb-2",
                        allRecipeDone ? "bg-yellow-50 dark:bg-yellow-900/20" : "bg-secondary/40"
                      )}>
                        <div className="flex items-center gap-2 min-w-0">
                          {allRecipeDone && <CheckCircle2 className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />}
                          <p className={cn(
                            "text-base font-bold uppercase tracking-wider truncate",
                            allRecipeDone ? "text-yellow-700 dark:text-yellow-300" : "text-yellow-800 dark:text-yellow-300"
                          )}>
                            {recipe.recipeName}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className="text-sm text-muted-foreground tabular-nums">{fmtQty(recipe.qtyForRecipe, ing.unit)}</span>
                          <span className={cn("text-sm font-semibold tabular-nums", allRecipeDone ? "text-yellow-600" : "text-muted-foreground")}>
                            {rDone}/{rTins.length}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                        {rTins.map(tn => {
                          const done = isCompleted(ing.ingredientId, recipe.recipeId, tn);
                          const completion = getCompletion(ing.ingredientId, recipe.recipeId, tn);
                          return (
                            <button
                              key={tn}
                              onClick={() => toggleTin(ing.ingredientId, recipe.recipeId, tn)}
                              disabled={isOnBreak}
                              className={cn(
                                "relative flex flex-col items-center border-2 rounded-2xl px-3 py-3.5 transition-all active:scale-95",
                                isOnBreak ? "opacity-50 cursor-not-allowed" : "",
                                done
                                  ? "bg-yellow-50 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-600 shadow-sm"
                                  : "bg-background border-border hover:border-yellow-400 hover:shadow-md"
                              )}
                            >
                              <div className="flex items-center gap-1.5 mb-1.5">
                                {done ? (
                                  <CheckCircle2 className="w-4 h-4 text-yellow-600" />
                                ) : (
                                  <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40" />
                                )}
                                <span className="text-base font-bold">Tin {tn}</span>
                              </div>
                              <span className={cn("text-xl font-bold tabular-nums", done ? "text-yellow-700 dark:text-yellow-300" : "text-foreground")}>
                                {fmtQty(recipe.qtyPerTin, ing.unit)}
                              </span>
                              {done && completion && (
                                <span className="text-xs text-yellow-600 dark:text-yellow-400 mt-1 leading-tight text-center">
                                  {completion.userName ?? "User"} · {format(new Date(completion.completedAt), "HH:mm")}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })() : (
            <div className="bg-card border-2 border-dashed border-border rounded-2xl p-12 flex flex-col items-center justify-center text-muted-foreground">
              <Layers className="w-12 h-12 mb-3 opacity-40" />
              <p className="font-medium">Select an item from the list</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}