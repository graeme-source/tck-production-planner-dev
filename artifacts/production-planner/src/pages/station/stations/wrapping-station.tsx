import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  useListTimingStandards,
  useGetStationKpi,
  getGetStationKpiQueryKey,
  getGetProductionPlanQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Plus, Minus, CheckCircle2, Snowflake, AlertCircle, Gift, Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
import { BreakTracker } from "../shared/break-tracker";
import { KpiBar } from "../shared/kpi-bar";
import { getStationCount, getAvailableFromPrev } from "../shared/constants";

interface ShopifyWrapConfirmState {
  item: ProductionPlanItem;
  productTitle: string;
  variantTitle: string | null;
  displayDelta: number;
}

type PostOvenItem = { name: string; unit: string; weightPerBatch: number; weightHalfBatch: number };
type PostOvenMap = Record<number, PostOvenItem[]>;

export function WrappingStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const [wrappingLoading, setWrappingLoading] = useState<number | null>(null);
  const [storageLoading, setStorageLoading] = useState<number | null>(null);
  const [wonlyLoading, setWonlyLoading] = useState<number | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [customAmounts, setCustomAmounts] = useState<Record<number, string>>({});
  const [showCustom, setShowCustom] = useState<Record<number, boolean>>({});
  const [shopifyConfirm, setShopifyConfirm] = useState<ShopifyWrapConfirmState | null>(null);
  const [wonkyTransferResult, setWonkyTransferResult] = useState<{
    transferred: Array<{ recipeName: string | null; qty: number }>;
    totalQty: number;
  } | null>(null);
  const [postOvenMap, setPostOvenMap] = useState<PostOvenMap>({});
  const addingRef = useRef(false);

  const [runWonlyAction, wonlyBusy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/production-plans/${plan.id}`] }),
  });
  const [runWonkyTransfer, wonkyTransferLoading] = useGuardedAction();
  const [runWrappingAction, wrappingBusy] = useGuardedAction();
  const [runStorageAction, storageBusy] = useGuardedAction();

  useEffect(() => {
    fetch(`/api/production-plans/${plan.id}/assembly-items`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.items) {
          const map: PostOvenMap = {};
          for (const it of d.items) {
            if (it.postOvenItems && it.postOvenItems.length > 0) {
              map[it.itemId] = it.postOvenItems;
            }
          }
          setPostOvenMap(map);
        }
      })
      .catch((err) => { console.warn("[WrappingStation] Post-oven map fetch failed:", err); });
  }, [plan.id]);

  const addWonly = async (item: ProductionPlanItem) => {
    // Prevent adding wonky if all gross packs are already accounted for
    const gross = grossPacks(item);
    const wonky = item.wonlyCount ?? 0;
    const fridge = item.fridgeQty ?? 0;
    const freezer = item.freezerQty ?? 0;
    const totalAccountedFor = fridge + freezer + wonky;
    if (totalAccountedFor >= gross) {
      toast({ title: "No stock available", description: `All ${gross} packs are already accounted for (${fridge} fridge, ${wonky} wonky). Remove fridge stock first if packs need reclassifying.`, variant: "destructive" });
      return;
    }
    setWonlyLoading(item.id);
    await runWonlyAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/wonly`, {
        method: "POST", signal,
      });
    });
    setWonlyLoading(null);
  };

  const removeWonly = async (item: ProductionPlanItem) => {
    if ((item.wonlyCount ?? 0) <= 0) return;
    setWonlyLoading(item.id);
    await runWonlyAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/wonly`, {
        method: "DELETE", signal,
      });
    });
    setWonlyLoading(null);
  };

  const wonkyToFreezer = async () => {
    await runWonkyTransfer(async (signal) => {
      const res = await guardedFetch(`/api/production-plans/${plan.id}/wonky-to-freezer`, {
        method: "POST", signal,
      });
      const data = await res.json() as {
        transferred: Array<{ recipeName: string | null; qty: number }>;
        totalQty: number;
      };
      setWonkyTransferResult(data);
      await queryClient.invalidateQueries({ queryKey: [`/api/production-plans/${plan.id}`] });
      toast({
        title: `${data.totalQty} wonky pack${data.totalQty !== 1 ? "s" : ""} → Product Freezer`,
        description: data.transferred.map(t => `${t.recipeName ?? "Recipe"}: ${t.qty}`).join(" · "),
      });
    });
  };

  const STACK_SIZE = 24;

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const plannedPacks = (item: ProductionPlanItem) =>
    Math.floor(((item.batchesTarget ?? 0) * (item.portionsPerBatch ?? 10)) / 2);
  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const eightPackDeduction = (item: ProductionPlanItem) => (item.eightPackBagCount ?? 0) * 4;
  const netTwoPacks = (item: ProductionPlanItem) =>
    Math.max(0, grossPacks(item) - eightPackDeduction(item) - (item.wonlyCount ?? 0) - (item.shortCount ?? 0)) + (item.extraPacksBuilt ?? 0);
  // netPacks for backward compat (total items including 8-pack bags for storage calcs)
  const netPacks = (item: ProductionPlanItem) =>
    netTwoPacks(item) + (item.eightPackBagCount ?? 0);

  const totalWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
  const totalShort = items.reduce((s, it) => s + (it.shortCount ?? 0), 0);
  const totalNet = items.reduce((s, it) => s + netTwoPacks(it), 0);
  const totalEightPackBags = items.reduce((s, it) => s + (it.eightPackBagCount ?? 0), 0);
  const wrappedCount = items.filter(it => it.wrappingComplete).length;
  const allWrapped = items.length > 0 && items.every(it => it.wrappingComplete);

  const [shopifyMappings, setShopifyMappings] = useState<Record<number, { productTitle: string; variantTitle: string | null; variantId: string }>>({});
  useEffect(() => {
    fetch("/api/shopify/recipe-mappings", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Array<{ recipe_id: number; shopify_variant_id: string; shopify_product_title: string | null; shopify_variant_title: string | null }>) => {
        const map: Record<number, { productTitle: string; variantTitle: string | null; variantId: string }> = {};
        for (const row of rows) {
          map[row.recipe_id] = {
            productTitle: row.shopify_product_title ?? "Shopify product",
            variantTitle: row.shopify_variant_title ?? null,
            variantId: row.shopify_variant_id,
          };
        }
        setShopifyMappings(map);
      })
      .catch((err) => { console.warn("[WrappingStation] Shopify mappings fetch failed:", err); });
  }, []);

  const sendWrappingComplete = async (item: ProductionPlanItem, complete: boolean) => {
    setWrappingLoading(item.id);
    await runWrappingAction(async (signal) => {
      const res = await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/wrapping-complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete }),
        signal,
      });
      const data = await res.json() as { wonkyFrozen?: number; shopifyProductTitle?: string | null; shopifyNewQty?: number | null; shopifyError?: string | null };
      if (complete) {
        if (data.wonkyFrozen && data.wonkyFrozen > 0) {
          toast({ title: `${data.wonkyFrozen} wonky pack${data.wonkyFrozen !== 1 ? "s" : ""} → Production Freezer`, description: `Auto-frozen for ${item.recipeName ?? "recipe"}` });
        }
        if (data.shopifyNewQty !== null && data.shopifyNewQty !== undefined && data.shopifyProductTitle) {
          toast({ title: `Shopify updated`, description: `${data.shopifyProductTitle}: inventory now ${data.shopifyNewQty}` });
        }
        if (data.shopifyError) {
          toast({ title: "Shopify sync failed", description: data.shopifyError, variant: "destructive" });
        }
      }
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    });
    setWrappingLoading(null);
  };

  const toggleWrapping = async (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    const newValue = !item.wrappingComplete;
    if (newValue) {
      const mapping = item.recipeId ? shopifyMappings[item.recipeId] : undefined;
      if (mapping) {
        const displayDelta = item.freezerQty + (item.wonlyCount ?? 0);
        setShopifyConfirm({ item, productTitle: mapping.productTitle, variantTitle: mapping.variantTitle, displayDelta });
        return;
      }
      await sendWrappingComplete(item, true);
    } else {
      await sendWrappingComplete(item, false);
    }
  };

  const STORAGE_LOCATIONS = [
    { key: "fridge", label: "Production Fridge", endpoint: "fridge", color: "blue" },
    { key: "freezer", label: "Product Freezer", endpoint: "freezer", color: "cyan" },
  ] as const;

  const getStorageQty = (item: ProductionPlanItem, key: string): number => {
    if (key === "fridge") return item.fridgeQty ?? 0;
    if (key === "freezer") return item.freezerQty ?? 0;
    return 0;
  };

  const markWrappingComplete = async (itemId: number, complete: boolean) => {
    try {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${itemId}/wrapping-complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete }),
      });
    } catch (err) {
      console.warn("[WrappingStation] Failed to toggle wrapping:", err);
    }
  };

  const addToStorage = async (item: ProductionPlanItem, qty: number, storageKey: string, packSize: number = 2) => {
    if (isOnBreak || qty < 1 || addingRef.current) return;
    const loc = STORAGE_LOCATIONS.find(l => l.key === storageKey);
    if (!loc) return;
    addingRef.current = true;
    setStorageLoading(item.id);
    await runStorageAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/${loc.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty, packSize }),
        signal,
      });
      const net = netPacks(item);
      const currentStored = STORAGE_LOCATIONS.reduce((s, l) => s + getStorageQty(item, l.key), 0);
      const eightPackStored = item.fridgeEightPackQty ?? 0;
      const newRemaining = net - currentStored - eightPackStored - qty;
      if (newRemaining <= 0 && !item.wrappingComplete) {
        await markWrappingComplete(item.id, true);
      }
      await queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      setCustomAmounts(prev => ({ ...prev, [item.id]: "" }));
      setShowCustom(prev => ({ ...prev, [item.id]: false }));
      const packLabel = packSize === 8 ? "8-pack bags" : "packs";
      toast({ title: `+${qty} ${packLabel} → ${loc.label}`, description: `${item.recipeName ?? "Recipe"}` });
    });
    setStorageLoading(null);
    addingRef.current = false;
  };

  const undoStorage = async (item: ProductionPlanItem, qty: number, storageKey: string) => {
    if (qty < 1) return;
    const loc = STORAGE_LOCATIONS.find(l => l.key === storageKey);
    if (!loc) return;
    setStorageLoading(item.id);
    await runStorageAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/${loc.endpoint}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty }),
        signal,
      });
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      toast({ title: `−${qty} packs from ${loc.label}`, description: `${item.recipeName ?? "Recipe"}` });
    });
    setStorageLoading(null);
  };

  return (
    <div className="space-y-4">
      {shopifyConfirm && (
        <ShopifyConfirmDialog
          title="Update Shopify inventory?"
          description={`This will update ${shopifyConfirm.variantTitle ? `${shopifyConfirm.productTitle} – ${shopifyConfirm.variantTitle}` : shopifyConfirm.productTitle} inventory on Shopify by +${shopifyConfirm.displayDelta} pack${shopifyConfirm.displayDelta !== 1 ? "s" : ""}. Are you sure?`}
          products={[{
            name: shopifyConfirm.variantTitle
              ? `${shopifyConfirm.productTitle} – ${shopifyConfirm.variantTitle}`
              : shopifyConfirm.productTitle,
            quantity: shopifyConfirm.displayDelta,
            quantityLabel: "packs",
          }]}
          confirmLabel="Confirm & sync"
          onConfirm={async () => {
            const { item } = shopifyConfirm;
            setShopifyConfirm(null);
            await sendWrappingComplete(item, true);
          }}
          onCancel={() => setShopifyConfirm(null)}
        />
      )}

      {/* Session summary */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <Gift className="w-6 h-6 text-purple-500" />
          <div>
            <h2 className="font-semibold text-lg">Wrapping Station</h2>
            <p className="text-sm text-muted-foreground">
              {wrappedCount} of {items.length} recipes wrapped · {totalNet} in chiller · {totalWonly} wonky
              {totalShort > 0 && <span className="text-red-500"> · {totalShort} short</span>}
            </p>
          </div>
          {allWrapped && (
            <div className="ml-auto flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">All wrapped!</span>
            </div>
          )}
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden mb-3">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              allWrapped ? "bg-emerald-500" : "bg-purple-500"
            )}
            style={{ width: `${items.length > 0 ? Math.min(Math.round((wrappedCount / items.length) * 100), 100) : 0}%` }}
          />
        </div>
        <BreakTracker planId={plan.id} stationType="wrapping" onBreakActiveChange={setIsOnBreak} />
      </div>

      {/* ── Top: Net production cards (no wonky counts or freezer transfers here) ── */}
      <div className="space-y-2">
        {items.map(item => {
          const planned = plannedPacks(item);
          const gross = grossPacks(item);
          const net = netTwoPacks(item);
          const eightPkCount = item.eightPackBagCount ?? 0;
          const eightPkFridge = item.fridgeEightPackQty ?? 0;
          const eightPkRemaining = eightPkCount - eightPkFridge;
          const fridge = item.fridgeQty ?? 0;
          const freezer = item.freezerQty ?? 0;
          const totalStored = fridge + freezer;
          const remaining = net - totalStored;
          const isWrapped = item.wrappingComplete;
          const isLoading = wrappingLoading === item.id;
          const isStorageLoading = storageLoading === item.id;
          const isCustomOpen = showCustom[item.id] ?? false;
          const customVal = customAmounts[item.id] ?? "";
          const customNum = parseInt(customVal, 10);
          const postOvenItems = postOvenMap[item.id] ?? [];

          return (
            <div
              key={item.id}
              className={cn(
                "bg-card border rounded-xl p-4 transition-all",
                isWrapped
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10"
                  : gross > 0
                    ? "border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10"
                    : "border-border"
              )}
            >
              {/* Recipe header + wrapping toggle */}
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className={cn("font-semibold text-xl", isWrapped ? "line-through text-muted-foreground" : "")}>
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </h3>
                    {isWrapped && <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-3 text-base">
                    <div className="text-center">
                      <span className="text-sm text-muted-foreground block">Planned</span>
                      <span className="text-lg font-bold tabular-nums">{planned}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-sm text-purple-600 dark:text-purple-400 block">In Chiller</span>
                      <span className="text-2xl font-bold tabular-nums text-purple-700 dark:text-purple-300">{net}</span>
                    </div>
                    <div className="text-center border-l border-border/50 pl-3">
                      <span className="text-sm text-primary block">Wrapped</span>
                      <span className="text-2xl font-bold tabular-nums text-primary">{fridge}</span>
                    </div>
                    {(item.wonlyCount ?? 0) > 0 && (
                      <div className="text-center">
                        <span className="text-sm text-red-500 block">Wonky</span>
                        <span className="text-lg font-bold tabular-nums text-red-500">{item.wonlyCount}</span>
                      </div>
                    )}
                    {eightPkCount > 0 && (
                      <div className="text-center border-l border-border/50 pl-3">
                        <span className="text-sm text-indigo-600 dark:text-indigo-400 block">8-Packs</span>
                        <span className="text-lg font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{eightPkFridge}/{eightPkCount}</span>
                      </div>
                    )}
                    {remaining > 0 && (
                      <div className="text-center">
                        <span className="text-sm text-amber-600 dark:text-amber-400 block">Left</span>
                        <span className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{remaining}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {getStationCount(item, "ovens")} / {item.batchesTarget ?? 0} oven loads
                    {(item.shortCount ?? 0) > 0 && <span className="text-red-500"> · {item.shortCount} short</span>}
                  </p>
                </div>
                <button
                  onClick={() => toggleWrapping(item)}
                  disabled={isLoading || wrappingBusy || isOnBreak}
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                    isWrapped
                      ? "bg-emerald-500 text-white shadow-md"
                      : "bg-secondary border-2 border-purple-300 dark:border-purple-700 text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                  )}
                  title={isWrapped ? "Mark as not wrapped" : "Mark wrapping complete"}
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                </button>
              </div>

              {/* Post-oven items (garlic butter) */}
              {postOvenItems.length > 0 && (
                <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Flame className="w-4 h-4 text-amber-500" />
                    <span className="text-sm font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">After Oven</span>
                  </div>
                  <div className="space-y-1.5">
                    {postOvenItems.map((poi, idx) => {
                      const totalWeight = poi.weightPerBatch * (item.batchesTarget ?? 0);
                      return (
                        <div key={idx} className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                          <span className="text-base font-medium text-amber-800 dark:text-amber-200">{poi.name}</span>
                          <div className="text-right">
                            <span className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">{Math.round(totalWeight)}g</span>
                            <span className="text-sm text-muted-foreground ml-1">total</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Storage controls — always targets Production Fridge */}
              <div className="mt-3 pt-3 border-t border-border/40">
                {fridge > 0 && (
                  <p className="text-xs text-muted-foreground mb-2">Wrapped: <span className="font-bold">{fridge}</span> in Production Fridge</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {remaining > 0 && (
                  <button
                    onClick={() => addToStorage(item, Math.min(STACK_SIZE, remaining), "fridge")}
                    disabled={isStorageLoading || isOnBreak || addingRef.current || storageBusy}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {isStorageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {remaining < STACK_SIZE ? `Add ${remaining} to Fridge` : `Add ${STACK_SIZE}`}
                  </button>
                  )}

                  {!isCustomOpen ? (
                    <button
                      onClick={() => setShowCustom(prev => ({ ...prev, [item.id]: true }))}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-base text-muted-foreground hover:bg-secondary/50 transition-colors"
                    >
                      Custom
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={customVal}
                        onChange={e => setCustomAmounts(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter" && customNum > 0) addToStorage(item, customNum, "fridge"); }}
                        className="w-20 h-10 rounded-lg border border-border bg-background px-2 text-base tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                      <button
                        onClick={() => { if (customNum > 0) addToStorage(item, customNum, "fridge"); }}
                        disabled={isStorageLoading || !(customNum > 0) || isOnBreak || addingRef.current || storageBusy}
                        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-base font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setShowCustom(prev => ({ ...prev, [item.id]: false })); setCustomAmounts(prev => ({ ...prev, [item.id]: "" })); }}
                        className="px-2 py-2 rounded-lg text-muted-foreground hover:bg-secondary/50 text-base transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {fridge > 0 && (() => {
                    const undoAmt = Math.min(STACK_SIZE, fridge);
                    return (
                    <button
                      onClick={() => undoStorage(item, undoAmt, "fridge")}
                      disabled={isStorageLoading || storageBusy}
                      className="ml-auto inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-base hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                      Undo {undoAmt}
                    </button>
                    );
                  })()}
                </div>

                {/* 8-Pack Bag fridge controls */}
                {eightPkCount > 0 && (
                  <div className="flex items-center gap-2 flex-wrap mt-2 pt-2 border-t border-indigo-200/50 dark:border-indigo-800/50">
                    <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">8-Pack Bags:</span>
                    {eightPkRemaining > 0 && (
                      <button
                        onClick={() => addToStorage(item, eightPkRemaining, "fridge", 8)}
                        disabled={isStorageLoading || isOnBreak || addingRef.current || storageBusy}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                      >
                        {isStorageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add {eightPkRemaining} to Fridge
                      </button>
                    )}
                    {eightPkFridge > 0 && (
                      <span className="text-sm text-muted-foreground">{eightPkFridge} in fridge</span>
                    )}
                    {eightPkRemaining <= 0 && eightPkFridge > 0 && (
                      <span className="text-sm text-emerald-600 font-medium">All 8-packs stored ✓</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Bottom: Wonky Rack dedicated panel ── */}
      <div className="rounded-xl border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-red-100 dark:bg-red-900/40 border-b border-red-200 dark:border-red-800">
          <div className="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg text-red-800 dark:text-red-200">Wonky Rack</p>
            <p className="text-sm text-red-600 dark:text-red-400">Bottom of rack 1 — rejected packs by recipe</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums text-red-600 dark:text-red-400">{totalWonly}</p>
            <p className="text-xs text-red-500 dark:text-red-500">total wonky</p>
          </div>
        </div>

        <div className="divide-y divide-red-200 dark:divide-red-800">
          {items.map(item => {
            const wonlys = item.wonlyCount ?? 0;
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-medium text-foreground truncate">{item.recipeName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => removeWonly(item)}
                    disabled={wonlyLoading === item.id || wonlyBusy || wonlys <= 0 || isOnBreak || !!wonkyTransferResult}
                    className="w-9 h-9 flex items-center justify-center rounded-full border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className={cn(
                    "text-xl font-bold tabular-nums w-8 text-center",
                    wonlys > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                  )}>
                    {wonlyLoading === item.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                      : wonlys}
                  </span>
                  <button
                    type="button"
                    onClick={() => addWonly(item)}
                    disabled={wonlyLoading === item.id || wonlyBusy || isOnBreak || !!wonkyTransferResult}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-red-200 dark:border-red-800">
          {wonkyTransferResult ? (
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">{wonkyTransferResult.totalQty} packs transferred to Product Freezer</p>
                <p className="text-xs text-muted-foreground">
                  {wonkyTransferResult.transferred.map(t => `${t.recipeName ?? "Recipe"}: ${t.qty}`).join(" · ")}
                </p>
              </div>
            </div>
          ) : (
            <button
              onClick={wonkyToFreezer}
              disabled={wonkyTransferLoading || totalWonly === 0 || isOnBreak}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium text-sm disabled:opacity-50 transition-colors"
            >
              {wonkyTransferLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Transferring…</>
                : <><Snowflake className="w-4 h-4" />
              {totalWonly === 0
                ? "No wonky packs to transfer"
                : `Transfer ${totalWonly} wonky pack${totalWonly !== 1 ? "s" : ""} to Product Freezer`}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
