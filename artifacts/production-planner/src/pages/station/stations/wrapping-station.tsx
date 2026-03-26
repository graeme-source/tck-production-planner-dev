import React, { useState, useEffect, useCallback } from "react";
import {
  useListTimingStandards,
  useGetStationKpi,
  getGetStationKpiQueryKey,
  getGetProductionPlanQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Plus, Minus, CheckCircle2, Snowflake, AlertCircle, Gift,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { withRetry, ClientError } from "@/lib/with-retry";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
import { BreakTracker } from "../shared/break-tracker";
import { KpiBar } from "../shared/kpi-bar";
import { getStationCount, getAvailableFromPrev } from "../shared/constants";

// ── Shopify confirm dialog for wrapping-complete ──────────────────────────────
interface ShopifyWrapConfirmState {
  item: ProductionPlanItem;
  productTitle: string;
  variantTitle: string | null;
  displayDelta: number;
}

// Per-recipe pack count display (read from oven completions) + wrapping-complete toggle
// ──────────────────────────────────────────────────────────────────────────────
export function WrappingStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const [wrappingLoading, setWrappingLoading] = useState<number | null>(null);
  const [storageLoading, setStorageLoading] = useState<number | null>(null);
  const [wonlyLoading, setWonlyLoading] = useState<number | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [customAmounts, setCustomAmounts] = useState<Record<number, string>>({});
  const [showCustom, setShowCustom] = useState<Record<number, boolean>>({});
  const [activeStorage, setActiveStorage] = useState<string>("fridge");
  const [shopifyConfirm, setShopifyConfirm] = useState<ShopifyWrapConfirmState | null>(null);
  const [wonkyTransferLoading, setWonkyTransferLoading] = useState(false);
  const [wonkyTransferResult, setWonkyTransferResult] = useState<{
    transferred: Array<{ recipeName: string | null; qty: number }>;
    totalQty: number;
  } | null>(null);

  const addWonly = async (item: ProductionPlanItem) => {
    setWonlyLoading(item.id);
    try {
      await fetch(`/api/production-plans/${plan.id}/items/${item.id}/wonly`, {
        method: "POST", credentials: "include",
      });
      await queryClient.invalidateQueries({ queryKey: [`/api/production-plans/${plan.id}`] });
    } catch {
    } finally {
      setWonlyLoading(null);
    }
  };

  const removeWonly = async (item: ProductionPlanItem) => {
    if ((item.wonlyCount ?? 0) <= 0) return;
    setWonlyLoading(item.id);
    try {
      await fetch(`/api/production-plans/${plan.id}/items/${item.id}/wonly`, {
        method: "DELETE", credentials: "include",
      });
      await queryClient.invalidateQueries({ queryKey: [`/api/production-plans/${plan.id}`] });
    } catch {
    } finally {
      setWonlyLoading(null);
    }
  };

  const wonkyToFreezer = async () => {
    setWonkyTransferLoading(true);
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/wonky-to-freezer`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
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
    } catch (err: unknown) {
      toast({ title: "Transfer failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setWonkyTransferLoading(false);
    }
  };

  const STACK_SIZE = 24;

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const netPacks = (item: ProductionPlanItem) =>
    Math.max(0, grossPacks(item) - (item.wonlyCount ?? 0)) + (item.extraPacksBuilt ?? 0);

  const totalGross = items.reduce((s, it) => s + grossPacks(it), 0);
  const totalWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
  const totalNet = items.reduce((s, it) => s + netPacks(it), 0);
  const totalExtraPacks = items.reduce((s, it) => s + (it.extraPacksBuilt ?? 0), 0);
  const totalFridge = items.reduce((s, it) => s + (it.fridgeQty ?? 0), 0);
  const wrappedCount = items.filter(it => it.wrappingComplete).length;
  const allWrapped = items.length > 0 && items.every(it => it.wrappingComplete);

  // Load all recipe→Shopify mappings so we can show the confirm dialog
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
      .catch(() => {});
  }, []);

  const sendWrappingComplete = async (item: ProductionPlanItem, complete: boolean) => {
    setWrappingLoading(item.id);
    try {
      const data = await withRetry(async () => {
        const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/wrapping-complete`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ complete }),
        });
        if (!res.ok) {
          const msg = `Server error ${res.status}`;
          if (res.status >= 400 && res.status < 500) throw new ClientError(res.status, msg);
          throw new Error(msg);
        }
        return res.json() as Promise<{ wonkyFrozen?: number; shopifyProductTitle?: string | null; shopifyNewQty?: number | null; shopifyError?: string | null }>;
      });
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
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not update wrapping status.", variant: "destructive" });
    } finally {
      setWrappingLoading(null);
    }
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
      await withRetry(async () => {
        const res = await fetch(`/api/production-plans/${plan.id}/items/${itemId}/wrapping-complete`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ complete }),
        });
        if (!res.ok) {
          const msg = `Server error ${res.status}`;
          if (res.status >= 400 && res.status < 500) throw new ClientError(res.status, msg);
          throw new Error(msg);
        }
      });
    } catch {}
  };

  const addToStorage = async (item: ProductionPlanItem, qty: number, storageKey: string) => {
    if (isOnBreak || qty < 1) return;
    const loc = STORAGE_LOCATIONS.find(l => l.key === storageKey);
    if (!loc) return;
    setStorageLoading(item.id);
    try {
      await withRetry(async () => {
        const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/${loc.endpoint}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qty }),
        });
        if (!res.ok) {
          const msg = `Server error ${res.status}`;
          if (res.status >= 400 && res.status < 500) throw new ClientError(res.status, msg);
          throw new Error(msg);
        }
      });
      const net = netPacks(item);
      const currentStored = STORAGE_LOCATIONS.reduce((s, l) => s + getStorageQty(item, l.key), 0);
      const newRemaining = net - currentStored - qty;
      if (newRemaining <= 0 && !item.wrappingComplete) {
        await markWrappingComplete(item.id, true);
      }
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      setCustomAmounts(prev => ({ ...prev, [item.id]: "" }));
      setShowCustom(prev => ({ ...prev, [item.id]: false }));
      toast({ title: `+${qty} packs → ${loc.label}`, description: `${item.recipeName ?? "Recipe"}` });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : `Could not add to ${loc.label}.`, variant: "destructive" });
    } finally {
      setStorageLoading(null);
    }
  };

  const undoStorage = async (item: ProductionPlanItem, qty: number, storageKey: string) => {
    if (qty < 1) return;
    const loc = STORAGE_LOCATIONS.find(l => l.key === storageKey);
    if (!loc) return;
    setStorageLoading(item.id);
    try {
      await withRetry(async () => {
        const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/${loc.endpoint}`, {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qty }),
        });
        if (!res.ok) {
          const msg = `Server error ${res.status}`;
          if (res.status >= 400 && res.status < 500) throw new ClientError(res.status, msg);
          throw new Error(msg);
        }
      });
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      toast({ title: `−${qty} packs from ${loc.label}`, description: `${item.recipeName ?? "Recipe"}` });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : `Could not undo from ${loc.label}.`, variant: "destructive" });
    } finally {
      setStorageLoading(null);
    }
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
            <h2 className="font-semibold text-base">Wrapping Station</h2>
            <p className="text-xs text-muted-foreground">
              {wrappedCount} of {items.length} recipes wrapped · {totalNet} net packs
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

      {/* Per-recipe wrapping cards */}
      <div className="space-y-2">
        {items.map(item => {
          const gross = grossPacks(item);
          const wonlys = item.wonlyCount ?? 0;
          const net = netPacks(item);
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
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className={cn("font-semibold", isWrapped ? "line-through text-muted-foreground" : "")}>
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </h3>
                    {isWrapped && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">Gross</span>
                      <span className="font-semibold tabular-nums">{gross}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-purple-600 dark:text-purple-400 block">Net</span>
                      <span className="text-xl font-bold tabular-nums text-purple-700 dark:text-purple-300">{net}</span>
                    </div>
                    <div className="text-center border-l border-border/50 pl-3">
                      <span className="text-xs text-blue-600 dark:text-blue-400 block">Stored</span>
                      <span className="text-xl font-bold tabular-nums text-blue-700 dark:text-blue-300">{totalStored}</span>
                    </div>
                    {remaining > 0 && (
                      <div className="text-center">
                        <span className="text-xs text-amber-600 dark:text-amber-400 block">Left</span>
                        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{remaining}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getStationCount(item, "ovens")} / {item.batchesTarget ?? 0} oven loads
                    {totalStored > 0 && ` · ${fridge} fridge · ${freezer} freezer`}
                  </p>
                </div>
                <button
                  onClick={() => toggleWrapping(item)}
                  disabled={isLoading || isOnBreak}
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

              {/* Storage controls — tabbed for Production Fridge / Product Freezer */}
              <div className="mt-3 pt-3 border-t border-border/40">
                <div className="flex gap-1 mb-2">
                  {STORAGE_LOCATIONS.map(loc => {
                    const qty = getStorageQty(item, loc.key);
                    const colorMap: Record<string, string> = {
                      blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700",
                      cyan: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700",
                      teal: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700",
                    };
                    const inactiveColor = "bg-secondary/30 text-muted-foreground border-border";
                    const isActive = activeStorage === loc.key;
                    return (
                      <button
                        key={loc.key}
                        onClick={() => setActiveStorage(loc.key)}
                        className={cn(
                          "flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                          isActive ? colorMap[loc.color] : inactiveColor
                        )}
                      >
                        {loc.label} {qty > 0 && <span className="font-bold ml-0.5">({qty})</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {remaining > 0 && (
                  <button
                    onClick={() => addToStorage(item, Math.min(STACK_SIZE, remaining), activeStorage)}
                    disabled={isStorageLoading || isOnBreak}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isStorageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {remaining < STACK_SIZE ? `Add ${remaining} remaining` : `Add ${STACK_SIZE}`}
                  </button>
                  )}

                  {!isCustomOpen ? (
                    <button
                      onClick={() => setShowCustom(prev => ({ ...prev, [item.id]: true }))}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-secondary/50 transition-colors"
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
                        onKeyDown={e => { if (e.key === "Enter" && customNum > 0) addToStorage(item, customNum, activeStorage); }}
                        className="w-20 h-9 rounded-lg border border-border bg-background px-2 text-sm tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                      <button
                        onClick={() => { if (customNum > 0) addToStorage(item, customNum, activeStorage); }}
                        disabled={isStorageLoading || !(customNum > 0) || isOnBreak}
                        className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setShowCustom(prev => ({ ...prev, [item.id]: false })); setCustomAmounts(prev => ({ ...prev, [item.id]: "" })); }}
                        className="px-2 py-2 rounded-lg text-muted-foreground hover:bg-secondary/50 text-sm transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {getStorageQty(item, activeStorage) > 0 && (() => {
                    const storageQty = getStorageQty(item, activeStorage);
                    const undoAmt = Math.min(STACK_SIZE, storageQty);
                    return (
                    <button
                      onClick={() => undoStorage(item, undoAmt, activeStorage)}
                      disabled={isStorageLoading}
                      className="ml-auto inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                      Undo {undoAmt}
                    </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}

        {/* ── Wonky Rack dedicated card ── */}
        <div className="rounded-xl border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-red-100 dark:bg-red-900/40 border-b border-red-200 dark:border-red-800">
            <div className="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-red-800 dark:text-red-200">Wonky Rack</p>
              <p className="text-xs text-red-600 dark:text-red-400">Bottom of rack 1 — rejected packs by recipe</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{totalWonly}</p>
              <p className="text-[10px] text-red-500 dark:text-red-500">total wonky</p>
            </div>
          </div>

          {/* Per-recipe rows */}
          <div className="divide-y divide-red-200 dark:divide-red-800">
            {items.map(item => {
              const wonlys = item.wonlyCount ?? 0;
              return (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.recipeName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => removeWonly(item)}
                      disabled={wonlyLoading === item.id || wonlys <= 0 || isOnBreak || !!wonkyTransferResult}
                      className="w-7 h-7 flex items-center justify-center rounded-full border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className={cn(
                      "text-lg font-bold tabular-nums w-7 text-center",
                      wonlys > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                    )}>
                      {wonlyLoading === item.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                        : wonlys}
                    </span>
                    <button
                      type="button"
                      onClick={() => addWonly(item)}
                      disabled={wonlyLoading === item.id || isOnBreak || !!wonkyTransferResult}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Transfer action */}
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
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Snowflake className="w-4 h-4" />}
                {totalWonly === 0
                  ? "No wonky packs to transfer"
                  : `Transfer ${totalWonly} wonky pack${totalWonly !== 1 ? "s" : ""} to Product Freezer`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}