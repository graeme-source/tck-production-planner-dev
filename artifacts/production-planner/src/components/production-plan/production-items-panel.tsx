import { useState } from "react";
import { getGetProductionPlanQueryKey, useGetProductionPlan } from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { ClipboardList, Drumstick, ExternalLink, Loader2, Lock, Package, Plus, Unlock } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AddRecipeToPlanDialog } from "@/components/add-recipe-to-plan-dialog";
import { AddDoughToPlanDialog } from "@/components/add-dough-to-plan-dialog";
import { AddFriedChickenDialog } from "@/components/fried-chicken/add-fried-chicken-dialog";
import { FriedChickenPrepSheetDialog } from "@/components/fried-chicken/prep-sheet";
import { BagsInFridgeNote } from "@/components/eight-pack-bags-on-hand";
import { useRecipeColourLookup } from "@/components/recipe-swatch";
import { FRIED_CHICKEN_CATEGORY } from "@/pages/station/shared/constants";
import { chickenOnPlan as chickenOnPlanFor, itemGrossPacks, itemNetPacks, itemProgressPct, itemTinCount, planItemsTotals } from "@/lib/plan-items-totals";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isItemBuilt, type DayItem } from "@/lib/dashboard-day-totals";

// The generated ProductionPlanItem type predates these columns, though the
// API does return them (the detail route spreads the full DB row).
export type PlanItemApi = ProductionPlanItem & {
  packSize?: number;
  eightPackBagCount?: number;
  shortCount?: number;
};

// A plan's Production Items table: every recipe with its batches, packs,
// done / wonky / dog bin, 8-pack bags, tins, status and progress, plus the
// Add recipe / Add dough / Fried chicken / Chicken prep buttons and the
// lock. Lifted out of the plan detail page (28 Nov 2026) so the Production
// Plans week view can show the same table for the selected day. It reads the
// plan through the same React Query key as the plan page, so a change made
// in either place shows in the other.
export function ProductionItemsPanel({ planId, onChanged, refetchInterval, embedded = false, strikeBuilt = false }: {
  planId: number;
  /** Called after every change made here (batches, 8-pack bags, a recipe or
   *  fried chicken added) — the week view refreshes its plan list with it. */
  onChanged?: () => void;
  /** Keep the table fresh while it's on screen (the week view: 30 s, so
   *  Done / Progress move as the stations work). Off by default. */
  refetchInterval?: number;
  /** Sits inside another card (the week view's plan card): no outer border. */
  embedded?: boolean;
  /** Strike through and fade a recipe's name once it's built at the building
   *  tables — the week view's rule (Graeme, 17 Nov 2026), same as the
   *  dashboard's Today's Production (isItemBuilt). */
  strikeBuilt?: boolean;
}) {
  const colourStyle = useRecipeColourLookup();
  const { data: plan, isLoading, refetch: refetchPlan } = useGetProductionPlan(planId, {
    query: { queryKey: getGetProductionPlanQueryKey(planId), refetchInterval: refetchInterval ?? false },
  }) as {
    data: ProductionPlanDetail | undefined;
    isLoading: boolean;
    refetch: () => void;
  };
  const refetch = () => { refetchPlan(); onChanged?.(); };
  const { state: authState } = useAuth();
  const userRole = authState.status === "authenticated" ? authState.user.role : undefined;
  const canEditPlan = userRole === "admin" || userRole === "manager";
  // Production Items table is locked by default — managers/admins can unlock to
  // adjust batches and 8-pack bag counts on an active plan without resetting it.
  const [itemsTableUnlocked, setItemsTableUnlocked] = useState(false);
  const [addRecipeOpen, setAddRecipeOpen] = useState(false);
  const [addDoughOpen, setAddDoughOpen] = useState(false);
  const [addChickenOpen, setAddChickenOpen] = useState(false);
  const [chickenPrepOpen, setChickenPrepOpen] = useState(false);
  const itemsEditable = canEditPlan && itemsTableUnlocked;

  if (!plan) {
    return isLoading ? (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading production items...
      </div>
    ) : null;
  }

  const {
    totalBatchesTarget, totalBatchesComplete, calzoneBatchesTarget,
    macPacksTarget, chickenBagsTarget, totalPacks,
  } = planItemsTotals((plan.items ?? []) as PlanItemApi[]);
  const chickenOnPlan = chickenOnPlanFor((plan.items ?? []) as PlanItemApi[]);

  return (
      <div className={cn("bg-card overflow-hidden", embedded ? "border-t border-border" : "border border-border rounded-xl")}>
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            Production Items
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-muted-foreground">
              {plan.items?.length ?? 0} recipes · {calzoneBatchesTarget} batches
              {macPacksTarget > 0 && <> + {macPacksTarget} mac packs</>}
              {chickenBagsTarget > 0 && <> + {chickenBagsTarget} chicken bags</>}
              {" · "}{totalPacks.toLocaleString()} packs
            </span>
            {canEditPlan && plan.status !== "complete" && (
              <button
                onClick={() => setAddRecipeOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-secondary/50 transition-colors"
                title="Add a recipe to this plan without resetting it"
              >
                <Plus className="w-3.5 h-3.5" /> Add recipe
              </button>
            )}
            {canEditPlan && plan.status !== "complete" && (
              <button
                onClick={() => setAddDoughOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-secondary/50 transition-colors"
                title="Add extra/test dough to this day's production"
              >
                <Plus className="w-3.5 h-3.5" /> Add dough
              </button>
            )}
            {canEditPlan && plan.status !== "complete" && (
              <button
                onClick={() => setAddChickenOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-secondary/50 transition-colors"
                title="Plan this day's fried chicken run"
              >
                <Drumstick className="w-3.5 h-3.5" />
                {chickenOnPlan.length > 0 ? "Fried chicken" : "Add fried chicken"}
              </button>
            )}
            {/* The prep sheet is for the day BEFORE, so it stays reachable
                even on a finished plan — someone prepping tonight opens
                tomorrow's plan to get the pull list. */}
            {chickenOnPlan.length > 0 && (
              <button
                onClick={() => setChickenPrepOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-secondary/50 transition-colors"
                title="What to pull and defrost for this chicken run"
              >
                <ClipboardList className="w-3.5 h-3.5" /> Chicken prep
              </button>
            )}
            {canEditPlan && (
              <AddFriedChickenDialog
                planId={plan.id}
                open={addChickenOpen}
                onClose={() => setAddChickenOpen(false)}
                existing={chickenOnPlan}
                onSaved={refetch}
              />
            )}
            <FriedChickenPrepSheetDialog
              planId={plan.id}
              open={chickenPrepOpen}
              onClose={() => setChickenPrepOpen(false)}
            />
            {canEditPlan && (
              <AddDoughToPlanDialog
                planId={plan.id}
                open={addDoughOpen}
                onClose={() => setAddDoughOpen(false)}
              />
            )}
            {canEditPlan && (
              <AddRecipeToPlanDialog
                planId={plan.id}
                open={addRecipeOpen}
                onClose={() => setAddRecipeOpen(false)}
                onAdded={refetch}
                existingRecipeIds={(plan.items ?? []).map(i => i.recipeId)}
              />
            )}
            {canEditPlan && (
              <button
                onClick={() => setItemsTableUnlocked(v => !v)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                  itemsTableUnlocked
                    ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                    : "border-border text-muted-foreground hover:bg-secondary/50"
                )}
                title={itemsTableUnlocked ? "Lock the table to prevent changes" : "Unlock to adjust batches & 8-packs"}
              >
                {itemsTableUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                {itemsTableUnlocked ? "Unlocked" : "Locked"}
              </button>
            )}
          </div>
        </div>
        {/* Scrolls sideways rather than clipping columns on a narrow screen. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border">
              <th className="py-2.5 px-2.5 xl:px-4 text-left font-medium text-muted-foreground">#</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-left font-medium text-muted-foreground">Recipe</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-center font-medium text-muted-foreground">Batches</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-center font-medium text-muted-foreground">Packs</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-center font-medium text-muted-foreground">Done</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-center font-medium text-muted-foreground">Wonky</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-center font-medium text-muted-foreground">Dog bin</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-center font-medium text-indigo-600 dark:text-indigo-400">8-Pack</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-right font-medium text-muted-foreground">Tin Size</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-right font-medium text-muted-foreground">Tins</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-center font-medium text-muted-foreground">Status</th>
              <th className="py-2.5 px-2.5 xl:px-4 text-center font-medium text-muted-foreground">Progress</th>
            </tr>
          </thead>
          <tbody>
            {(plan.items ?? []).map((item: PlanItemApi) => {
              const itemProgress = itemProgressPct(item);
              const itemStatusConfig = {
                pending: { color: "bg-secondary text-secondary-foreground", label: "Pending" },
                "in-progress": { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "In Progress" },
                complete: { color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", label: "Done" },
              }[item.status ?? "pending"] ?? { color: "bg-secondary text-secondary-foreground", label: item.status };

              const tinCount = itemTinCount(item);
              const built = strikeBuilt && isItemBuilt(item as unknown as DayItem);

              return (
                <tr key={item.id} className="border-b border-border/50 last:border-0">
                  <td className="py-3 px-2.5 xl:px-4 text-muted-foreground text-sm">{item.orderPosition}</td>
                  <td className="py-3 px-2.5 xl:px-4 min-w-[9rem]">
                    <div className="flex items-center gap-2">
                      {built && <span className="sr-only">Built: </span>}
                      <span className={cn("font-medium", built && "line-through opacity-50")} style={item.recipeColor ? colourStyle(item.recipeId, item.recipeColor, "text") : undefined}>{item.recipeName ?? `Recipe #${item.recipeId}`}</span>
                      {item.sopUrl && (
                        <a href={item.sopUrl} target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary transition-colors" title="Open SOP">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-2.5 xl:px-4 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if ((item.batchesTarget ?? 0) <= (item.batchesComplete ?? 0)) return;
                          const r = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/batches-target`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ delta: -1 }),
                          });
                          if (!r.ok) {
                            const body = await r.json().catch(() => ({}));
                            toast({ title: "Couldn't reduce batches", description: body.error ?? "Try again.", variant: "destructive" });
                          }
                          refetch();
                        }}
                        disabled={!itemsEditable || (item.batchesTarget ?? 0) <= (item.batchesComplete ?? 0)}
                        className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full border border-border text-xs hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={!itemsEditable ? "Unlock the table to edit" : "Reduce by one batch"}
                      >−</button>
                      <span className="font-medium tabular-nums w-6 text-center">{item.batchesTarget ?? 0}</span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const r = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/batches-target`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ delta: 1 }),
                          });
                          if (!r.ok) {
                            const body = await r.json().catch(() => ({}));
                            toast({ title: "Couldn't add batch", description: body.error ?? "Try again.", variant: "destructive" });
                          }
                          refetch();
                        }}
                        disabled={!itemsEditable}
                        className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={!itemsEditable ? "Unlock the table to edit" : "Add one batch"}
                      >+</button>
                    </div>
                  </td>
                  <td className="py-3 px-2.5 xl:px-4 text-center font-mono text-muted-foreground">
                    {(() => {
                      const grossPacks = itemGrossPacks(item);
                      const bags = item.eightPackBagCount ?? 0;
                      // Each 8-pack bag commits 4 two-packs. Show the net so
                      // adding a bag here visibly drops the "Packs" figure
                      // and the operator can sanity-check at a glance.
                      const netPacks = itemNetPacks(item);
                      if (bags > 0) {
                        return (
                          <span className="inline-flex flex-col leading-tight">
                            <span className="tabular-nums whitespace-nowrap">{netPacks.toLocaleString()} packs</span>
                            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-normal whitespace-nowrap">
                              + {bags} × 8-pack bag
                            </span>
                          </span>
                        );
                      }
                      return grossPacks.toLocaleString();
                    })()}
                  </td>
                  <td className="py-3 px-2.5 xl:px-4 text-center">{item.batchesComplete ?? 0}</td>
                  <td className="py-3 px-2.5 xl:px-4 text-center">
                    {(item.wonlyCount ?? 0) > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">{item.wonlyCount}</span>
                    ) : (
                      <span className="text-muted-foreground opacity-40">0</span>
                    )}
                  </td>
                  <td className="py-3 px-2.5 xl:px-4 text-center">
                    {(item.dogBinCount ?? 0) > 0 ? (
                      <span className="text-slate-700 dark:text-slate-200 font-medium">{item.dogBinCount}</span>
                    ) : (
                      <span className="text-muted-foreground opacity-40">0</span>
                    )}
                  </td>
                  <td className="py-3 px-2.5 xl:px-4 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={async (e) => { e.stopPropagation(); if ((item.eightPackBagCount ?? 0) > 0) { await fetch(`/api/production-plans/${plan.id}/items/${item.id}/eight-pack-bag-count`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ delta: -1 }) }); refetch(); } }}
                        disabled={!itemsEditable || (item.eightPackBagCount ?? 0) === 0}
                        className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full border border-border text-xs hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={!itemsEditable ? "Unlock the table to edit" : "Remove one 8-pack bag"}
                      >−</button>
                      <span className={cn("font-bold tabular-nums w-6 text-center", (item.eightPackBagCount ?? 0) > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground opacity-40")}>
                        {item.eightPackBagCount ?? 0}
                      </span>
                      <button
                        onClick={async (e) => { e.stopPropagation(); await fetch(`/api/production-plans/${plan.id}/items/${item.id}/eight-pack-bag-count`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ delta: 1 }) }); refetch(); }}
                        disabled={!itemsEditable}
                        className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full bg-indigo-500 text-white text-xs hover:bg-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={!itemsEditable ? "Unlock the table to edit" : "Add one 8-pack bag"}
                      >+</button>
                    </div>
                    <BagsInFridgeNote recipeId={item.recipeId} className="mt-0.5" />
                  </td>
                  <td className="py-3 px-2.5 xl:px-4 text-right text-muted-foreground text-xs">
                    {item.tinSize ?? <span className="opacity-40">—</span>}
                  </td>
                  <td className="py-3 px-2.5 xl:px-4 text-right">
                    {tinCount !== null ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{tinCount}</span>
                    ) : (
                      <span className="text-muted-foreground opacity-40">—</span>
                    )}
                  </td>
                  <td className="py-3 px-2.5 xl:px-4 text-center">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs", itemStatusConfig.color)}>
                      {itemStatusConfig.label}
                    </span>
                  </td>
                  <td className="py-3 px-2.5 xl:px-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", itemProgress >= 100 ? "bg-emerald-500" : "bg-primary")}
                          style={{ width: `${Math.min(itemProgress, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-9 text-right">{itemProgress}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totalBatchesTarget > 0 && (
            <tfoot>
              <tr className="bg-secondary/10 border-t border-border font-medium text-sm">
                <td colSpan={2} className="py-2.5 px-2.5 xl:px-4 text-right text-muted-foreground">
                  Totals
                  {macPacksTarget > 0 && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {calzoneBatchesTarget} calzone + {macPacksTarget} mac packs
                    </span>
                  )}
                  {chickenBagsTarget > 0 && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {FRIED_CHICKEN_CATEGORY}: {chickenBagsTarget} bags, made separately — not in these totals
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-2.5 xl:px-4 text-center">{totalBatchesTarget}</td>
                <td className="py-2.5 px-2.5 xl:px-4 text-center font-mono">{totalPacks.toLocaleString()}</td>
                <td className="py-2.5 px-2.5 xl:px-4 text-center">{totalBatchesComplete}</td>
                <td colSpan={6} />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>
  );
}
