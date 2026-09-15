import React, { useState, useEffect, useCallback } from "react";
import { getGetProductionPlanQueryKey, getListProductionPlansQueryKey } from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Lock, LockOpen, Plus, Thermometer, Clock,
  UtensilsCrossed, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { useAuth } from "@/contexts/auth-context";
import { isMacCheese, MAC_CHEESE_CATEGORY, type StationPlanItem } from "../shared/constants";
import { NumberInput } from "@/components/ui/number-input";
import { stockCellEdited, planStockWrite } from "@/lib/stock-override-guard";
import { DeferredPrepBanner } from "../shared/deferred-prep-banner";

// ──────────────────────────────────────────────────────────────────────────────
// Macaroni Cheese Station
// ──────────────────────────────────────────────────────────────────────────────

interface TempRecord {
  id: number;
  recordType: string;
  temperatureC: string;
  recordedAt: string;
  userName: string | null;
}

interface MacCheeseCalcRecipe {
  recipeId: number;
  recipeName: string;
  color: string | null;
  isCoreMenu: boolean;
  packsPerBatch: number;
  leftOverStock: number;
  liveStock: number;
  stillToDispatchToday: number;
  salesNextDay: number;
  salesNextDayPlus1: number;
  salesNextDayPlus2: number;
  neededForDispatch: number;
  extraToMake: number;
  toMakePacks: number;
  toMakeBatches: number;
}

function ZeroDayButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? "Restore sales numbers" : "Set this day's sales to 0"}
      className={cn(
        "px-2 py-0.5 text-[10px] font-medium rounded border transition-colors",
        active
          ? "bg-yellow-600 border-yellow-600 text-white hover:bg-yellow-700"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60",
      )}
    >
      {active ? "Restore" : "Zero"}
    </button>
  );
}

function InlineAddMacCheese({ planId, planDate, onSuccess }: { planId: number; planDate: string; onSuccess: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recipes, setRecipes] = useState<MacCheeseCalcRecipe[]>([]);
  // Full mac-cheese list from the endpoint; `recipes` above is the working
  // set shown in the table (core menu only by default). Non-core recipes
  // live here until the operator adds them via the picker.
  const [allRecipes, setAllRecipes] = useState<MacCheeseCalcRecipe[]>([]);
  const [extraOverrides, setExtraOverrides] = useState<Record<number, number>>({});
  const [stockOverrides, setStockOverrides] = useState<Record<number, number>>({});
  const [zeroedDays, setZeroedDays] = useState<{ d1: boolean; d2: boolean; d3: boolean }>({ d1: false, d2: false, d3: false });
  // GUARD (2026-09-15): typing in the Stock cell used to auto-save every
  // keystroke straight into Stock Control with no visible feedback — on
  // 2026-09-14 that silently rewrote both mac cheese fridge counts while a
  // plan was being built, and the next day's stock count was out by exactly
  // those edits. Edits now only affect this calculation; writing Stock
  // Control is a separate explicit step behind a confirmation that states
  // the exact change (see lib/stock-override-guard).
  // The column is LOCKED by default: the figure is Stock Control's and should
  // be accurate now that despatch/wrapping keep it in step. Correcting it is
  // a deliberate three-step: tap the padlock to unlock one row, type the real
  // count, then Save and confirm the exact change being written.
  const [stockUnlockedId, setStockUnlockedId] = useState<number | null>(null);
  const [stockConfirmId, setStockConfirmId] = useState<number | null>(null);
  const [stockSaving, setStockSaving] = useState(false);
  const [stockJustSaved, setStockJustSaved] = useState<Record<number, boolean>>({});

  const relockStockRow = useCallback((recipeId: number, keepOverride: boolean) => {
    if (!keepOverride) {
      setStockOverrides(prev => {
        const next = { ...prev };
        delete next[recipeId];
        return next;
      });
    }
    setStockConfirmId(prev => (prev === recipeId ? null : prev));
    setStockUnlockedId(prev => (prev === recipeId ? null : prev));
  }, []);

  const saveStockToControl = useCallback(async (recipe: MacCheeseCalcRecipe, newLevel: number) => {
    setStockSaving(true);
    try {
      const resp = await fetch(`/api/stock-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipeId: recipe.recipeId,
          ingredientId: null,
          itemType: "recipe",
          quantity: newLevel,
          unit: "packs",
          location: "production_fridge",
          notes: "Mac cheese calculator override (confirmed)",
        }),
      });
      if (!resp.ok) throw new Error(`Save failed (${resp.status})`);
      // The saved figure is the new baseline: the cell is no longer "edited"
      // and the next confirmation compares against the level just written.
      const rebase = (list: MacCheeseCalcRecipe[]) => list.map(r =>
        r.recipeId === recipe.recipeId
          ? { ...r, liveStock: newLevel, leftOverStock: newLevel, stillToDispatchToday: 0 }
          : r,
      );
      setAllRecipes(rebase);
      setRecipes(rebase);
      relockStockRow(recipe.recipeId, false);
      setStockJustSaved(prev => ({ ...prev, [recipe.recipeId]: true }));
      setTimeout(() => {
        setStockJustSaved(prev => ({ ...prev, [recipe.recipeId]: false }));
      }, 2500);
    } catch (e) {
      console.error("Failed to save mac cheese stock override", e);
      toast({ title: "Stock not saved", description: "Could not update Stock Control — the calculation still uses your number.", variant: "destructive" });
    } finally {
      setStockSaving(false);
    }
  }, [relockStockRow]);

  useEffect(() => {
    setLoading(true);
    // Use the dedicated mac-cheese calc endpoint — same working-day dispatch
    // logic the Add-to-Plan dialog on the production plans page uses, so D1/D2/D3
    // here match the rest of the app.
    fetch(`/api/production-plans/calculate-mac-cheese?planDate=${planDate}`, { credentials: "include" })
      .then(r => r.json())
      .then((calcData) => {
        const mapped: MacCheeseCalcRecipe[] = (calcData.recipes ?? []).map((r: any) => ({
          recipeId: r.recipeId,
          recipeName: r.recipeName,
          color: r.color ?? null,
          isCoreMenu: !!r.isCoreMenu,
          packsPerBatch: r.packsPerBatch ?? 5,
          leftOverStock: Math.round(r.leftOverStock ?? 0),
          liveStock: Math.round(r.liveStock ?? r.leftOverStock ?? 0),
          stillToDispatchToday: Math.round(r.stillToDispatchToday ?? 0),
          salesNextDay: r.salesNextDay ?? 0,
          salesNextDayPlus1: r.salesNextDayPlus1 ?? 0,
          salesNextDayPlus2: r.salesNextDayPlus2 ?? 0,
          neededForDispatch: r.neededForDispatch ?? 0,
          extraToMake: r.extraToMake ?? 0,
          toMakePacks: r.toMakePacks ?? 0,
          toMakeBatches: r.toMakeBatches ?? 0,
        }));
        // Seed the extraToMake input with whatever the endpoint already resolved
        // (it applies the per-recipe app-setting override and Thursday rules).
        const overrides: Record<number, number> = {};
        for (const r of mapped) overrides[r.recipeId] = r.extraToMake;
        setExtraOverrides(overrides);
        setAllRecipes(mapped);
        // Default the table to core-menu mac recipes only. If none are
        // flagged core, fall back to showing all so the panel isn't empty.
        const core = mapped.filter(r => r.isCoreMenu);
        setRecipes(core.length > 0 ? core : mapped);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [planDate]);

  const getStock = (r: MacCheeseCalcRecipe) => stockOverrides[r.recipeId] ?? r.leftOverStock;
  const getSalesD1 = (r: MacCheeseCalcRecipe) => zeroedDays.d1 ? 0 : r.salesNextDay;
  const getSalesD2 = (r: MacCheeseCalcRecipe) => zeroedDays.d2 ? 0 : r.salesNextDayPlus1;
  const getSalesD3 = (r: MacCheeseCalcRecipe) => zeroedDays.d3 ? 0 : r.salesNextDayPlus2;
  const getDeficit = (r: MacCheeseCalcRecipe) => Math.max(0, getSalesD1(r) - getStock(r));
  // Raw demand (packs) — before batch rounding.
  const getRawNeed = (r: MacCheeseCalcRecipe) => {
    const extra = extraOverrides[r.recipeId] ?? r.extraToMake;
    const totalNeeded = getSalesD1(r) + getSalesD2(r) + getSalesD3(r) + extra;
    return Math.max(0, totalNeeded - getStock(r));
  };
  // To-make rounds UP to the nearest whole batch — the factory can only
  // produce full batches, so this is what will actually be made. The plan
  // view shows the same number, so users see consistent figures from edit
  // form to plan.
  const getToMake = (r: MacCheeseCalcRecipe) => {
    const raw = getRawNeed(r);
    if (raw === 0) return 0;
    if ((r.packsPerBatch ?? 0) <= 0) return raw;
    const batches = Math.ceil(raw / r.packsPerBatch);
    return batches * r.packsPerBatch;
  };

  const handleSubmit = async () => {
    const items = recipes
      .map(r => ({ recipeId: r.recipeId, packsToMake: getToMake(r) }))
      .filter(i => i.packsToMake > 0);
    // Guard: don't submit an empty list. If the user wants to clear all
    // mac cheese, they have the dedicated "Remove All" button in edit mode.
    if (items.length === 0) {
      toast({ title: "Nothing to save", description: "All recipes are at 0 packs. Use 'Remove All' to clear, or adjust numbers and try again." });
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch(`/api/production-plans/${planId}/add-mac-cheese`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ items }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Failed to save");
      const skipped: number[] = Array.isArray(data?.skippedInProgress) ? data.skippedInProgress : [];
      if (skipped.length > 0) {
        toast({
          title: "Saved with warnings",
          description: `${items.length} recipe(s) saved. ${skipped.length} item(s) couldn't be removed because work has already started — leave them alone or finish them first.`,
        });
      } else {
        toast({ title: "Mac cheese saved", description: `${items.length} recipe(s) on the plan.` });
      }
      onSuccess();
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Calculating…
      </div>
    );
  }

  if (allRecipes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No Macaroni Cheese recipes found.</p>
        <p className="text-sm mt-1">Add recipes with category "Macaroni Cheese" first.</p>
      </div>
    );
  }

  const addableRecipes = allRecipes.filter(r => !recipes.some(x => x.recipeId === r.recipeId));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="text-left text-sm text-muted-foreground uppercase tracking-wider">
              <th className="pb-2 pr-3">Recipe</th>
              <th className="pb-2 px-2 text-right">Stock</th>
              <th className="pb-2 px-2 text-right">Sales D1</th>
              <th className="pb-2 px-2 text-right">Deficit</th>
              <th className="pb-2 px-2 text-right">Sales D2</th>
              <th className="pb-2 px-2 text-right">Sales D3</th>
              <th className="pb-2 px-2 text-right">Extra</th>
              <th className="pb-2 px-2 text-right font-semibold">To Make</th>
              <th className="pb-2 pl-2 text-right">Batches</th>
              <th className="pb-2 pl-2 w-8" />
            </tr>
            <tr className="border-b border-border">
              <th />
              <th />
              <th className="pb-2 px-2 text-right"><ZeroDayButton active={zeroedDays.d1} onClick={() => setZeroedDays(p => ({ ...p, d1: !p.d1 }))} /></th>
              <th />
              <th className="pb-2 px-2 text-right"><ZeroDayButton active={zeroedDays.d2} onClick={() => setZeroedDays(p => ({ ...p, d2: !p.d2 }))} /></th>
              <th className="pb-2 px-2 text-right"><ZeroDayButton active={zeroedDays.d3} onClick={() => setZeroedDays(p => ({ ...p, d3: !p.d3 }))} /></th>
              <th />
              <th />
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {recipes.map(r => {
              const extra = extraOverrides[r.recipeId] ?? r.extraToMake;
              const toMake = getToMake(r);
              const batches = r.packsPerBatch > 0 ? Math.ceil(toMake / r.packsPerBatch) : 0;
              return (
                <tr key={r.recipeId} className="border-b border-border/50">
                  <td className="py-2.5 pr-3 font-medium">
                    <div className="flex items-center gap-2">
                      {r.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />}
                      {r.recipeName}
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    {(() => {
                      const unlocked = stockUnlockedId === r.recipeId;
                      if (!unlocked) {
                        return (
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="tabular-nums">{r.leftOverStock}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  // One row unlocked at a time — moving the
                                  // padlock discards any unsaved edit on the
                                  // previously unlocked row.
                                  if (stockUnlockedId !== null && stockUnlockedId !== r.recipeId) {
                                    relockStockRow(stockUnlockedId, false);
                                  }
                                  setStockUnlockedId(r.recipeId);
                                }}
                                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                                title="Stock is locked — it comes from Stock Control and should be right. Tap to unlock and correct it after a physical count."
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {stockJustSaved[r.recipeId] && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Stock updated ✓</span>
                            )}
                          </div>
                        );
                      }
                      const typed = stockOverrides[r.recipeId];
                      const edited = stockCellEdited(typed, r.leftOverStock);
                      const writePlan = planStockWrite(typed ?? r.leftOverStock, r.liveStock, r.stillToDispatchToday);
                      return (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-1.5">
                            <NumberInput
                              min={0}
                              value={typed ?? r.leftOverStock}
                              onChange={n => {
                                setStockOverrides(prev => ({ ...prev, [r.recipeId]: Math.max(0, n) }));
                                if (stockConfirmId === r.recipeId) setStockConfirmId(null);
                              }}
                              autoFocus
                              className="w-16 px-2 py-1 text-right bg-background border border-amber-400 dark:border-amber-600 rounded text-sm tabular-nums"
                            />
                            <LockOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          </div>
                          {stockConfirmId === r.recipeId ? (
                            <div className="w-48 text-left text-[10px] leading-snug bg-amber-50 dark:bg-amber-950/40 border border-amber-400 dark:border-amber-600 rounded-lg p-2 space-y-1.5">
                              <div className="font-semibold text-amber-900 dark:text-amber-200">
                                Stock Control: {writePlan.currentLevel} → {writePlan.newLevel} packs ({writePlan.delta > 0 ? "+" : ""}{writePlan.delta})
                              </div>
                              {writePlan.dispatchWarning && (
                                <div className="text-amber-800 dark:text-amber-300">{writePlan.dispatchWarning}</div>
                              )}
                              <div className="flex gap-1.5 justify-end">
                                <button
                                  type="button"
                                  disabled={stockSaving}
                                  onClick={() => setStockConfirmId(null)}
                                  className="px-2 py-1 rounded border border-border bg-background hover:bg-secondary/60 disabled:opacity-50"
                                >
                                  Back
                                </button>
                                <button
                                  type="button"
                                  disabled={stockSaving}
                                  onClick={() => saveStockToControl(r, writePlan.newLevel)}
                                  className="px-2 py-1 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1"
                                >
                                  {stockSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                                  Update stock
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => relockStockRow(r.recipeId, false)}
                                className="px-2 py-1 rounded border border-border bg-background text-[10px] hover:bg-secondary/60"
                                title="Discard the edit and lock the column again"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={!edited}
                                onClick={() => setStockConfirmId(r.recipeId)}
                                className="px-2 py-1 rounded bg-primary text-primary-foreground text-[10px] font-semibold hover:bg-primary/90 disabled:opacity-40"
                                title="Review and save this number to Stock Control"
                              >
                                Save…
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className={cn("py-2.5 px-2 text-right tabular-nums", zeroedDays.d1 && "text-muted-foreground line-through")}>{getSalesD1(r)}</td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-amber-600">{getDeficit(r)}</td>
                  <td className={cn("py-2.5 px-2 text-right tabular-nums", zeroedDays.d2 && "text-muted-foreground line-through")}>{getSalesD2(r)}</td>
                  <td className={cn("py-2.5 px-2 text-right tabular-nums", zeroedDays.d3 && "text-muted-foreground line-through")}>{getSalesD3(r)}</td>
                  <td className="py-2.5 px-2 text-right">
                    <NumberInput
                      min={0}
                      value={extra}
                      onChange={n => setExtraOverrides(prev => ({ ...prev, [r.recipeId]: Math.max(0, n) }))}
                      className="w-16 px-2 py-1 text-right bg-background border border-border rounded text-sm tabular-nums"
                    />
                  </td>
                  <td className="py-2.5 px-2 text-right font-bold tabular-nums text-lg">{toMake}</td>
                  <td className="py-2.5 pl-2 text-right tabular-nums text-muted-foreground">{batches}</td>
                  <td className="py-2.5 pl-1">
                    <button
                      type="button"
                      onClick={() => setRecipes(prev => prev.filter(x => x.recipeId !== r.recipeId))}
                      className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                      title="Remove from list"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="pt-3">Total</td>
              <td colSpan={6} />
              <td className="pt-3 px-2 text-right tabular-nums text-lg">{recipes.reduce((s, r) => s + getToMake(r), 0)} packs</td>
              <td className="pt-3 pl-2 text-right tabular-nums">
                {recipes.reduce((s, r) => {
                  const toMake = getToMake(r);
                  return s + (r.packsPerBatch > 0 ? Math.ceil(toMake / r.packsPerBatch) : 0);
                }, 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        Stock = current fridge packs from Stock Control, locked because it should be right. To correct it after a physical count: tap the padlock, type the real number, then Save — you'll be shown exactly what changes before anything is written. Cancel discards the edit. Sales D1/D2/D3 = next 3 dispatch days from Shopify. Deficit = max(0, D1 − Stock). Extra = additional packs. <strong>To Make is rounded up to whole batches</strong> — you can't produce partial batches, so target + rounding-up is what you'll actually make.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {addableRecipes.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Add another recipe:</span>
            <select
              value=""
              onChange={e => {
                const id = Number(e.target.value);
                if (!id) return;
                const rec = allRecipes.find(x => x.recipeId === id);
                if (rec) setRecipes(prev => [...prev, rec]);
              }}
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select a recipe…</option>
              {addableRecipes.map(r => (
                <option key={r.recipeId} value={r.recipeId}>{r.recipeName}</option>
              ))}
            </select>
          </div>
        ) : <span />}
        <button
          onClick={handleSubmit}
          disabled={saving || recipes.every(r => getToMake(r) === 0)}
          className="px-5 py-3 bg-yellow-600 text-white rounded-lg text-base font-semibold hover:bg-yellow-700 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add to Plan
        </button>
      </div>
    </div>
  );
}

export function MacaroniCheeseStation({ plan, isOnBreak = false }: { plan: ProductionPlanDetail; isOnBreak?: boolean }) {
  const { state: authState } = useAuth();
  const queryClient = useQueryClient();
  const authUser = authState.status === "authenticated" ? authState.user : null;

  // Filter to mac cheese items only
  const macItems: StationPlanItem[] = (plan.items ?? []).filter(it => isMacCheese(it as any));

  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Temperature recording
  const [tempRecords, setTempRecords] = useState<TempRecord[]>([]);
  const [tempInputs, setTempInputs] = useState<Record<string, string>>({});
  const [tempSaving, setTempSaving] = useState(false);
  const [runTempAction] = useGuardedAction();

  // Load existing temp records
  useEffect(() => {
    fetch(`/api/temperature-records?planId=${plan.id}`, { credentials: "include" })
      .then(r => r.json())
      .then(records => {
        const macRecords = (records ?? []).filter((r: any) =>
          r.recordType === "mac_sauce_pre_cheese"
          || r.recordType === "mac_sauce_post_cheese"
          || r.recordType === "mac_pigs_in_blankets_cook"
        );
        setTempRecords(macRecords);
      })
      .catch(() => {});
  }, [plan.id]);

  const handleRecordTemp = async (recordType: string, label: string) => {
    const value = tempInputs[recordType];
    const c = parseFloat(value);
    if (isNaN(c)) { toast({ title: "Enter a valid temperature", variant: "destructive" }); return; }
    setTempSaving(true);
    try {
      await runTempAction(async (signal) => {
        const resp = await guardedFetch(`/api/temperature-records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: plan.id,
            planName: plan.name,
            trayIndex: 0,
            temperatureC: c,
            recordType,
          }),
          signal,
        });
        const record = await resp.json();
        setTempRecords(prev => [...prev, record]);
        setTempInputs(prev => ({ ...prev, [recordType]: "" }));
        toast({ title: "Temperature recorded", description: `${c}°C saved for ${label}` });
      });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
    setTempSaving(false);
  };

  const handleRemoveMacCheese = async () => {
    setRemoving(true);
    try {
      const resp = await fetch(`/api/production-plans/${plan.id}/mac-cheese-items`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error ?? "Failed to remove");
      }
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      queryClient.invalidateQueries({ queryKey: getListProductionPlansQueryKey() });
      toast({ title: "Mac cheese removed", description: "Items removed from plan. You can re-add them." });
      setEditing(false);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
    setRemoving(false);
  };

  const totalPacks = macItems.reduce((s, it) => {
    const ppb = (it.portionsPerBatch ?? 10) / (it.packSize ?? 2);
    return s + (it.batchesTarget ?? 0) * ppb;
  }, 0);

  const preCheeseRecords = tempRecords.filter(r => r.recordType === "mac_sauce_pre_cheese");
  const postCheeseRecords = tempRecords.filter(r => r.recordType === "mac_sauce_post_cheese");
  const pigsInBlanketsRecords = tempRecords.filter(r => r.recordType === "mac_pigs_in_blankets_cook");

  // Show the Pigs in Blankets temperature panel only if one of the mac
  // cheese items on this plan actually contains pigs in blankets. Detection
  // is by recipe name (case-insensitive) — any item whose name contains
  // "pigs" counts. This avoids hard-coding recipe IDs.
  const hasPigsInBlankets = macItems.some(it => (it.recipeName ?? "").toLowerCase().includes("pigs"));

  // Show the add form if no mac cheese items OR if editing
  if (macItems.length === 0 || editing) {
    return (
      <div className="space-y-6">
        {/* Deferred-prep banner — only shows when there are mac-cheese
            items owed today (e.g. milk/cream deferred from Friday for
            Monday's sauce). Same single-source-of-truth list as the
            main prep banner, just filtered to mac cheese recipes. */}
        <DeferredPrepBanner category={MAC_CHEESE_CATEGORY} />
        <div className="bg-card border border-yellow-200 dark:border-yellow-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <UtensilsCrossed className="w-5 h-5 text-yellow-600" />
              {macItems.length > 0 ? "Edit Macaroni Cheese" : "Add Macaroni Cheese to this Plan"}
            </h2>
            {macItems.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRemoveMacCheese}
                  disabled={removing}
                  className="px-3 py-1.5 text-sm border border-destructive/30 text-destructive rounded-lg hover:bg-destructive/10 flex items-center gap-1.5"
                >
                  {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  Remove All
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          <InlineAddMacCheese
            planId={plan.id}
            planDate={plan.planDate}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
              queryClient.invalidateQueries({ queryKey: getListProductionPlansQueryKey() });
              setEditing(false);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DeferredPrepBanner category={MAC_CHEESE_CATEGORY} />
      {/* Summary — recipe breakdown with packs, no batch buttons */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-2xl flex items-center gap-2">
            <UtensilsCrossed className="w-6 h-6 text-yellow-600" />
            Macaroni Cheese
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-3.5 py-1.5 rounded-full">
              {Math.round(totalPacks)} packs total
            </span>
            <button
              onClick={() => setEditing(true)}
              className="px-3.5 py-2 text-base border border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400 rounded-lg hover:bg-yellow-50 dark:hover:bg-yellow-900/20 flex items-center gap-1.5"
            >
              Edit
            </button>
          </div>
        </div>

        {/* Recipe breakdown — just name and packs */}
        <div className="space-y-2.5">
          {macItems.map(item => {
            const packs = (item.batchesTarget ?? 0) * ((item.portionsPerBatch ?? 10) / (item.packSize ?? 2));
            return (
              <div key={item.id} className="flex items-center justify-between p-4 rounded-lg border bg-background border-border">
                <div className="flex items-center gap-3">
                  {item.recipeColor && <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.recipeColor ?? undefined }} />}
                  <span className="text-xl font-semibold">{item.recipeName}</span>
                </div>
                <span className="text-2xl font-bold tabular-nums">{Math.round(packs)} packs</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Temperature Records */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-lg flex items-center gap-2 mb-3">
          <Thermometer className="w-5 h-5 text-red-500" />
          Cheese Sauce Temperature Record
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Check 1: 75°C prior to adding cheese. Check 2: 75°C after adding and melting cheese.
        </p>

        <div className="space-y-4">
          {/* Check 1: Pre-cheese */}
          <TempCheckRow
            label="Check 1 — Before adding cheese"
            targetTemp={75}
            recordType="mac_sauce_pre_cheese"
            records={preCheeseRecords}
            inputValue={tempInputs["mac_sauce_pre_cheese"] ?? ""}
            onInputChange={v => setTempInputs(prev => ({ ...prev, mac_sauce_pre_cheese: v }))}
            onRecord={() => handleRecordTemp("mac_sauce_pre_cheese", "Check 1 (pre-cheese)")}
            saving={tempSaving}
          />

          {/* Check 2: Post-cheese */}
          <TempCheckRow
            label="Check 2 — After melting cheese"
            targetTemp={75}
            recordType="mac_sauce_post_cheese"
            records={postCheeseRecords}
            inputValue={tempInputs["mac_sauce_post_cheese"] ?? ""}
            onInputChange={v => setTempInputs(prev => ({ ...prev, mac_sauce_post_cheese: v }))}
            onRecord={() => handleRecordTemp("mac_sauce_post_cheese", "Check 2 (post-cheese)")}
            saving={tempSaving}
          />
        </div>
      </div>

      {/* Pigs in Blankets cook-temperature — only shown when a mac cheese
          recipe containing pigs in blankets is on this plan. The PIB
          sausage is a raw meat product and must hit 75°C core before
          being added to the sauce (CCP per HACCP). */}
      {hasPigsInBlankets && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-lg flex items-center gap-2 mb-3">
            <Thermometer className="w-5 h-5 text-red-500" />
            Pigs in Blankets Cook Temperature
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Record core temperature of the cooked sausage before adding to the mac cheese. Target: <strong>≥75°C</strong>.
          </p>

          <div className="space-y-4">
            <TempCheckRow
              label="Sausage core temperature at cook-out"
              targetTemp={75}
              recordType="mac_pigs_in_blankets_cook"
              records={pigsInBlanketsRecords}
              inputValue={tempInputs["mac_pigs_in_blankets_cook"] ?? ""}
              onInputChange={v => setTempInputs(prev => ({ ...prev, mac_pigs_in_blankets_cook: v }))}
              onRecord={() => handleRecordTemp("mac_pigs_in_blankets_cook", "Pigs in Blankets cook")}
              saving={tempSaving}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TempCheckRow({ label, targetTemp, recordType, records, inputValue, onInputChange, onRecord, saving }: {
  label: string;
  targetTemp: number;
  recordType: string;
  records: TempRecord[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onRecord: () => void;
  saving: boolean;
}) {
  const hasRecord = records.length > 0;
  const lastRecord = records[records.length - 1];
  const lastTemp = lastRecord ? Number(lastRecord.temperatureC) : null;
  const isAboveTarget = lastTemp !== null && lastTemp >= targetTemp;

  return (
    <div className={cn(
      "p-4 rounded-lg border",
      hasRecord && isAboveTarget ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200" :
      hasRecord && !isAboveTarget ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200" :
      "border-border",
    )}>
      <div className="flex items-center justify-between mb-2 gap-3">
        <span className="text-base font-semibold">{label}</span>
        {hasRecord && (
          <span className={cn("text-lg font-bold tabular-nums flex-shrink-0", isAboveTarget ? "text-emerald-600" : "text-amber-600")}>
            {lastTemp}°C {isAboveTarget ? "✓" : `(target: ${targetTemp}°C)`}
          </span>
        )}
      </div>
      {hasRecord ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          Recorded at {new Date(lastRecord.recordedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          {lastRecord.userName && <span>by {lastRecord.userName}</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            value={inputValue}
            onChange={e => onInputChange(e.target.value)}
            placeholder={`${targetTemp}°C`}
            className="w-28 px-3 py-2 bg-background border border-border rounded text-base"
          />
          <button
            onClick={onRecord}
            disabled={saving || !inputValue}
            className="px-4 py-2 bg-red-500 text-white rounded text-base font-semibold hover:bg-red-600 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Thermometer className="w-4 h-4" />}
            Record
          </button>
        </div>
      )}
    </div>
  );
}
