import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  getGetProductionPlanQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Loader2, Plus, Minus, CheckCircle2, Snowflake, AlertCircle, Gift, Flame, ChevronDown, ThermometerSnowflake, ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
import { BreakTracker } from "../shared/break-tracker";
import { PaceKpiStrip, type PaceBands } from "../shared/pace-kpi-strip";
import { getStationCount, getAvailableFromPrev, compareItemsForDisplay, type StationPlanItem } from "../shared/constants";
import { netTwoPacks as computeNetTwoPacks, effectiveBatchesTarget } from "../shared/recipe-completion";
import { SopChips, useSopViewer, type SopLink } from "@/components/sop-link-chips";

// Case-order freezer split — new columns not yet in the generated API client
// (openapi.yaml codegen deliberately deferred; see project_api_spec_drift).
type ItemWithFreezer = ProductionPlanItem & {
  freezerEightPackBagCount?: number;
  freezerEightPackQty?: number;
  caseOrderId?: number | null;
};
const freezerBagTarget = (item: ProductionPlanItem) => (item as ItemWithFreezer).freezerEightPackBagCount ?? 0;
const freezerBagDone = (item: ProductionPlanItem) => (item as ItemWithFreezer).freezerEightPackQty ?? 0;
const itemCaseOrderId = (item: ProductionPlanItem) => (item as ItemWithFreezer).caseOrderId ?? null;

interface CaseOrderSummary {
  id: number;
  supplierName: string | null;
  reference: string | null;
  targetCollectionDate: string;
  status: string;
  caseLines: Array<{ caseTypeName: string | null; casesOrdered: number }>;
  totals: { cases: number; bagsRequired: number; bagsMade: number; bagsRemaining: number };
}

interface ShopifyWrapConfirmState {
  item: ProductionPlanItem;
  productTitle: string;
  variantTitle: string | null;
  displayDelta: number;
}

type PostOvenItem = { name: string; unit: string; weightPerBatch: number; weightHalfBatch: number };
type PostOvenMap = Record<number, PostOvenItem[]>;

/**
 * How much topping goes on ONE pack — the only number that's actionable with
 * a pack in your hand.
 *
 * The server sends weights per BATCH: the recipe's per-PORTION quantity times
 * portionsPerBatch. To get back to a pack we divide by packs-per-batch, and
 * that must use the recipe's OWN pack size — `portionsPerBatch / packSize`,
 * the same formula the server uses everywhere it counts packs.
 *
 * Kept separate from the shared packsPerBatch() helper deliberately. That
 * helper floors to whole packs, which is right for counting output and wrong
 * for a dose: a recipe whose portions don't divide evenly into packs would
 * get its topping rounded up. Here the division stays exact.
 *
 * (The helper itself hardcoded a two-pack until 2026-08-21 — the calzone
 * convention, silently wrong for anything else, and on Cinnamon Buns it put a
 * third of the real dose on screen. Both read pack size now.) Wrong here
 * means wrong icing on real product, so the pack size is read, never assumed.
 */
function postOvenGramsPerPack(poi: PostOvenItem, item: ProductionPlanItem): number {
  // packSize arrives as a numeric string ("1.0000") from the plan API.
  const packSize = Number((item as { packSize?: number | string }).packSize) || 1;
  const portions = Number(item.portionsPerBatch) || 1;
  const packs = Math.max(1, portions / packSize);
  return poi.weightPerBatch / packs;
}

// Wrapping pace bands, from 2 weeks of live submission data (5–19 Aug 2026):
// active-interval pace median 163 packs/hr, p75 212, p90 281. Standard 180
// = a 24-stack every 8 minutes; stretch 240 = every 6 minutes (Graeme's own
// fast-day bursts, deliberately above the bar). Idle gaps over 20 minutes
// are excluded server-side, so this judges pace only while wrapping.
const WRAPPING_PACE_BANDS: PaceBands = { green: 180, amber: 120, stretch: 240 };

interface WrappingSpeed {
  packs: number;
  activeMinutes: number | null;
  packsPerHour: number | null;
}

export function WrappingStation({ plan, isOnBreak = false }: { plan: ProductionPlanDetail; isOnBreak?: boolean }) {
  const queryClient = useQueryClient();

  // Today's wrapping pace — refreshed every minute; each fridge/freezer add
  // lands in fridge_stock_changes, so the number moves as the team works.
  const { data: wrappingSpeed } = useQuery<WrappingSpeed>({
    queryKey: ["wrapping-speed"],
    queryFn: async () => {
      const res = await fetch(`/api/reports/wrapping-speed`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load wrapping speed");
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const [wrappingLoading, setWrappingLoading] = useState<number | null>(null);
  const [storageLoading, setStorageLoading] = useState<number | null>(null);
  const [wonlyLoading, setWonlyLoading] = useState<number | null>(null);
  const [customAmounts, setCustomAmounts] = useState<Record<number, string>>({});
  // Where this item's wrapped packs are being stored. Defaults to the
  // Production Fridge (the calzone flow, unchanged); the wrapper flips it to
  // Product Freezer for freezer-stored products like Cinnamon Buns. The
  // freezer count is what wrapping-complete offers to push to the linked
  // Shopify variant, so storing buns "in the fridge" silently pushed nothing
  // — and until 2026-08-21 the freezer had no button here at all, despite
  // the endpoint and the count both existing.
  const [storageDest, setStorageDest] = useState<Record<number, "fridge" | "freezer">>({});
  const [showCustom, setShowCustom] = useState<Record<number, boolean>>({});
  const [shopifyConfirm, setShopifyConfirm] = useState<ShopifyWrapConfirmState | null>(null);
  const [wonkyTransferResult, setWonkyTransferResult] = useState<{
    transferred: Array<{ recipeName: string | null; qty: number }>;
    totalQty: number;
  } | null>(null);
  const [postOvenMap, setPostOvenMap] = useState<PostOvenMap>({});
  // One-shot reminder shown the first time a recipe with post-oven items
  // (e.g. garlic butter) is opened in this session, so wrappers don't forget
  // to brush before sealing. Tracked in-memory so it resets per page load,
  // dismissed per item via the modal's Complete button.
  const [garlicReminderItem, setGarlicReminderItem] = useState<ProductionPlanItem | null>(null);
  const dismissedGarlicReminders = useRef<Set<number>>(new Set());
  const addingRef = useRef(false);
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const userOverrideRef = useRef(false);

  // Recipe-level SOPs, shown as chips on the open recipe so the wrapper can
  // read the method at the bench — and attach one on the spot when a step
  // turns out to be undocumented. Recipe-scoped, not station-scoped, so the
  // same SOP follows the recipe onto any other screen that hangs chips off it.
  const recipeIds = useMemo(
    () => Array.from(new Set((plan.items ?? []).map(i => i.recipeId).filter((v): v is number => v != null))),
    [plan.items],
  );
  const sopLinksKey = useMemo(() => ["sop-links-recipes", recipeIds.join(",")], [recipeIds]);
  const { data: sopLinksByRecipe } = useQuery<Record<number, SopLink[]>>({
    queryKey: sopLinksKey,
    enabled: recipeIds.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/standards/links/for-recipes?ids=${recipeIds.join(",")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load SOP links");
      return res.json();
    },
  });
  const sopViewer = useSopViewer("wrapping");

  const [runWonlyAction, wonlyBusy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/production-plans/${plan.id}`] }),
  });
  const [runWonkyTransfer, wonkyTransferLoading] = useGuardedAction();
  const [runWrappingAction, wrappingBusy] = useGuardedAction();
  const [runStorageAction, storageBusy] = useGuardedAction();
  const [runFreezerBagAction, freezerBagBusy] = useGuardedAction();

  // Case orders linked to today's items — drives the banner that tells the
  // wrapper how many cases they're building and the bags-per-case breakdown.
  const [caseOrders, setCaseOrders] = useState<CaseOrderSummary[]>([]);
  const linkedCaseOrderIds = useMemo(
    () => Array.from(new Set((plan.items ?? []).map(itemCaseOrderId).filter((v): v is number => v != null))),
    [plan.items],
  );
  useEffect(() => {
    if (linkedCaseOrderIds.length === 0) { setCaseOrders([]); return; }
    fetch(`/api/case-orders`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((all: CaseOrderSummary[]) => {
        setCaseOrders(all.filter(o => linkedCaseOrderIds.includes(o.id)));
      })
      .catch((err) => { console.warn("[WrappingStation] Case orders fetch failed:", err); });
  }, [linkedCaseOrderIds]);

  /** Count freezer bags in/out. Also writes the case-order ledger server-side,
   *  so the order's made-vs-remaining can't drift from what was counted. */
  const adjustFreezerBags = async (item: ProductionPlanItem, delta: number) => {
    if (isOnBreak || delta === 0) return;
    await runFreezerBagAction(async (signal) => {
      await guardedFetch(`/api/case-orders/plan-items/${item.id}/freezer-bags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta }),
        signal,
      });
      await queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      toast({
        title: delta > 0 ? `+${delta} freezer bag${delta === 1 ? "" : "s"}` : `${delta} freezer bag${delta === -1 ? "" : "s"}`,
        description: `${item.recipeName ?? "Recipe"} → walk-in product freezer`,
      });
    });
  };

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

  const items: StationPlanItem[] = [...(plan.items ?? [])].sort(compareItemsForDisplay);

  const plannedPacks = (item: ProductionPlanItem) =>
    Math.floor(((item.batchesTarget ?? 0) * (item.portionsPerBatch ?? 10)) / 2);
  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const eightPackDeduction = (item: StationPlanItem) => (item.eightPackBagCount ?? 0) * 4;
  const combinedBuildingCount = (item: ProductionPlanItem) =>
    getStationCount(item, "building_1") + getStationCount(item, "building_2");
  const effBatches = (item: ProductionPlanItem) =>
    effectiveBatchesTarget(item, combinedBuildingCount(item));
  const netTwoPacks = (item: ProductionPlanItem) =>
    computeNetTwoPacks(item, getStationCount(item, "ovens"), effBatches(item), combinedBuildingCount(item));
  // netPacks for backward compat (total items including 8-pack bags for storage calcs)
  const netPacks = (item: StationPlanItem) =>
    netTwoPacks(item) + (item.eightPackBagCount ?? 0);

  const totalWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
  // After a transfer, the success banner replaces the transfer button and
  // disables every +/− wonky button. If the oven operator adds fresh wonky
  // afterwards, those new packs would be stuck — visible but unactionable.
  // Clear the banner whenever the total goes back above zero so the controls
  // re-enable and a second transfer becomes possible.
  useEffect(() => {
    if (wonkyTransferResult && totalWonly > 0) setWonkyTransferResult(null);
  }, [totalWonly, wonkyTransferResult]);
  // Only tally shorts for in-flight plans that haven't been marked complete by
  // the builder — once marked, shortCount becomes historical and should no
  // longer influence visible totals.
  const totalShort = items.reduce(
    (s, it) => s + (it.builderMarkedCompleteAt ? 0 : (it.shortCount ?? 0)),
    0,
  );
  const totalNet = items.reduce((s, it) => s + netTwoPacks(it), 0);
  const totalEightPackBags = items.reduce((s, it) => s + (it.eightPackBagCount ?? 0), 0);
  const totalFridge = items.reduce((s, it) => s + (it.fridgeQty ?? 0), 0);
  const wrappedCount = items.filter(it => it.wrappingComplete).length;
  const allWrapped = items.length > 0 && items.every(it => it.wrappingComplete);
  const wrappingPct = totalNet > 0 ? Math.min(Math.round((totalFridge / totalNet) * 100), 100) : 0;

  // Current item = first non-wrapped recipe with stock in chiller
  const currentWrappingItem = useMemo(() =>
    items.find(it => !it.wrappingComplete && netPacks(it) > 0), [items]);

  // Auto-expand
  const [prevCurrentWrappingId, setPrevCurrentWrappingId] = useState<number | null>(null);
  useEffect(() => {
    const curId = currentWrappingItem?.id ?? null;
    if (prevCurrentWrappingId !== null && curId !== prevCurrentWrappingId) {
      setExpandedItemId(curId);
      userOverrideRef.current = false;
    }
    setPrevCurrentWrappingId(curId);
  }, [currentWrappingItem?.id]);

  useEffect(() => {
    if (expandedItemId === null && currentWrappingItem) {
      setExpandedItemId(currentWrappingItem.id);
    }
  }, [currentWrappingItem?.id]);

  const toggleExpanded = (itemId: number) => {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      userOverrideRef.current = false;
    } else {
      setExpandedItemId(itemId);
      userOverrideRef.current = itemId !== currentWrappingItem?.id;
      // Pop the post-oven reminder the first time this recipe is opened
      // in the current session — surfaces garlic butter before wrapping
      // starts, when it's still actionable.
      if ((postOvenMap[itemId]?.length ?? 0) > 0 && !dismissedGarlicReminders.current.has(itemId)) {
        const item = items.find(it => it.id === itemId);
        if (item) setGarlicReminderItem(item);
      }
    }
  };

  // HACCP chill state for the Mark as Chilled button. One entry per recipe:
  // tracks whether the last-batch weight record exists (enables the button)
  // and whether chill_end_at has already been stamped (disables once done).
  const [chillByRecipe, setChillByRecipe] = useState<Record<number, { chillStartAt: string | null; chillEndAt: string | null; chilledVia: string | null }>>({});
  const [chillTargetTempC, setChillTargetTempC] = useState<number>(4);
  const [chillingRecipeId, setChillingRecipeId] = useState<number | null>(null);

  const refetchChillState = useCallback(async () => {
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/weight-targets`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json() as {
        settings: { chillTargetTempC: number };
        records: Array<{ recipeId: number; isLastBatchOfRecipe: boolean; recordedAt: string; chillEndAt: string | null; chilledVia: string | null }>;
      };
      setChillTargetTempC(data.settings.chillTargetTempC);
      const map: Record<number, { chillStartAt: string | null; chillEndAt: string | null; chilledVia: string | null }> = {};
      for (const r of data.records) {
        if (!r.isLastBatchOfRecipe) continue;
        map[r.recipeId] = { chillStartAt: r.recordedAt, chillEndAt: r.chillEndAt, chilledVia: r.chilledVia };
      }
      setChillByRecipe(map);
    } catch (err) {
      console.warn("[WrappingStation] chill state fetch failed:", err);
    }
  }, [plan.id]);

  useEffect(() => { refetchChillState(); }, [refetchChillState]);

  const markChilled = async (item: ProductionPlanItem) => {
    if (!item.recipeId) return;
    setChillingRecipeId(item.recipeId);
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/mark-chilled`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "wrapping_station" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        toast({ title: "Could not mark chilled", description: err.error ?? "Failed", variant: "destructive" });
        return;
      }
      const data = await res.json() as { alreadyChilled: boolean };
      toast({
        title: data.alreadyChilled ? "Already chilled" : "Chilled",
        description: data.alreadyChilled
          ? `${item.recipeName ?? "Recipe"} was already marked chilled.`
          : `${item.recipeName ?? "Recipe"} cooling time logged.`,
      });
      await refetchChillState();
    } finally {
      setChillingRecipeId(null);
    }
  };

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

  const addToStorage = async (item: StationPlanItem, qty: number, storageKey: string, packSize: number = 2) => {
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

  const undoStorage = async (item: ProductionPlanItem, qty: number, storageKey: string, packSize: number = 2) => {
    if (qty < 1) return;
    const loc = STORAGE_LOCATIONS.find(l => l.key === storageKey);
    if (!loc) return;
    setStorageLoading(item.id);
    await runStorageAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/${loc.endpoint}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty, packSize }),
        signal,
      });
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      const packLabel = packSize === 8 ? "8-pack bags" : "packs";
      toast({ title: `−${qty} ${packLabel} from ${loc.label}`, description: `${item.recipeName ?? "Recipe"}` });
    });
    setStorageLoading(null);
  };

  return (
    <div className="space-y-4">
      {/* Case-order banner — the wrapper's brief: how many cases to build,
          what goes in each, and the running made-vs-remaining. Only rendered
          when today's items carry a freezer allocation. */}
      {caseOrders.map(order => (
        <div key={order.id} className="rounded-xl border-2 border-sky-300 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/30 px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Snowflake className="w-5 h-5 text-sky-600 dark:text-sky-400 flex-shrink-0" />
            <span className="font-bold text-sky-900 dark:text-sky-100">
              Case order #{order.id}{order.supplierName ? ` — ${order.supplierName}` : ""}
            </span>
            <span className="text-xs text-sky-800/80 dark:text-sky-200/80">
              collect {order.targetCollectionDate}
            </span>
            <span className="ml-auto text-sm font-bold tabular-nums text-sky-800 dark:text-sky-200">
              {order.totals.bagsMade}/{order.totals.bagsRequired} bags in freezer · {order.totals.bagsRemaining} to go
            </span>
          </div>
          <p className="text-sm text-sky-900/90 dark:text-sky-100/90 mt-1">
            {order.totals.cases} cases to build:{" "}
            {order.caseLines.map((l, i) => (
              <span key={i}>
                {i > 0 ? " · " : ""}
                <span className="font-semibold">{l.casesOrdered}×</span> {l.caseTypeName ?? "case"}
              </span>
            ))}
            <span className="text-sky-800/70 dark:text-sky-200/70"> — bags below go to the walk-in product freezer, not the fridge.</span>
          </p>
        </div>
      ))}

      {garlicReminderItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border-2 border-amber-500 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                <Flame className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                {(() => {
                  // Name the actual post-oven item(s) — garlic butter on
                  // calzones, cream cheese icing on cinnamon buns, whatever
                  // the recipe carries.
                  const pois = postOvenMap[garlicReminderItem.id] ?? [];
                  const names = pois.map(i => i.name);
                  const label = names.length > 0 ? names.join(" and ") : "post-oven topping";
                  return (
                    <>
                      <h2 className="font-display font-bold text-xl">Don't forget the {label.toLowerCase()}</h2>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Add <span className="font-semibold text-foreground">{label}</span> to every <span className="font-semibold text-foreground">{garlicReminderItem.recipeName ?? "recipe"}</span> before wrapping. Tap Complete once you've done this batch.
                      </p>
                      {/* The dose, at the moment the instruction is read —
                          "add the icing" is not actionable without it. The
                          same figures stay on the recipe card afterwards. */}
                      {pois.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {pois.map((poi, idx) => {
                            const perPack = postOvenGramsPerPack(poi, garlicReminderItem);
                            return (
                              <div key={idx} className="flex items-baseline justify-between gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5">
                                <span className="text-sm font-medium text-amber-800 dark:text-amber-200">{poi.name}</span>
                                <span className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300 flex-shrink-0">
                                  {perPack >= 10 ? Math.round(perPack) : Math.round(perPack * 10) / 10}g
                                  <span className="text-xs font-medium ml-1">per pack</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Read the method before starting, not after. */}
                      {garlicReminderItem.recipeId != null && (sopLinksByRecipe?.[garlicReminderItem.recipeId]?.length ?? 0) > 0 && (
                        <div className="mt-3">
                          <SopChips
                            links={sopLinksByRecipe?.[garlicReminderItem.recipeId] ?? []}
                            onOpen={sopViewer.open}
                            queryKeysToInvalidate={[sopLinksKey]}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            <button
              onClick={() => {
                if (garlicReminderItem) dismissedGarlicReminders.current.add(garlicReminderItem.id);
                setGarlicReminderItem(null);
              }}
              className="w-full py-3 rounded-xl text-base font-bold bg-amber-600 text-white hover:bg-amber-700 active:scale-95 transition-colors"
            >
              Complete
            </button>
          </div>
        </div>
      )}
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
              {totalEightPackBags > 0 && <span className="text-indigo-500"> · {totalEightPackBags} 8-packs</span>}
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
            style={{ width: `${allWrapped ? 100 : wrappingPct}%` }}
          />
        </div>
        <PaceKpiStrip
          className="pt-3 border-t border-border"
          rate={wrappingSpeed?.packsPerHour ?? null}
          rateUnit="Packs / hour"
          count={wrappingSpeed?.packs ?? 0}
          countLabel="Wrapped today"
          activeMinutes={wrappingSpeed?.activeMinutes ?? null}
          bands={WRAPPING_PACE_BANDS}
          unitNoun="pack"
        />
      </div>

      {/* Unified accordion queue */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-base">Wrapping Queue</h3>
          {allWrapped && (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> All wrapped
            </span>
          )}
        </div>

        <div className="divide-y divide-border/50">
          {items.map(item => {
            const planned = plannedPacks(item);
            const gross = grossPacks(item);
            const net = netTwoPacks(item);
            // "Produced" is the full two-pack output coming off the ovens —
            // wonky packs count toward it, they're just tracked separately
            // afterwards. Matches the oven station's Net + Wonky = Total.
            // Use wonlyTotal (cumulative) so the count survives wonky-to-freezer
            // transfer and the auto-freeze on wrapping-complete. Falls back to
            // wonlyCount if the field isn't present (older API client cache).
            const wonkiesRecorded = ((item as ProductionPlanItem & { wonlyTotal?: number }).wonlyTotal ?? item.wonlyCount ?? 0);
            const produced = net + wonkiesRecorded;
            const eightPkCount = item.eightPackBagCount ?? 0;
            const eightPkFridge = item.fridgeEightPackQty ?? 0;
            // Of the total bags, the case-order freezer split. Fridge bags are
            // what's left after the freezer allocation — the two destinations
            // are counted separately because they're physically different jobs
            // (fridge = normal wholesale; freezer = blast-freeze + case).
            const fzTarget = freezerBagTarget(item);
            const fzDone = freezerBagDone(item);
            const fridgeBagTargetCount = Math.max(0, eightPkCount - fzTarget);
            const eightPkRemaining = Math.max(0, fridgeBagTargetCount - eightPkFridge);
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
            const isExpanded = expandedItemId === item.id;
            const isCurrent = item.id === currentWrappingItem?.id;
            const recipeColour = item.recipeColor || undefined;

            return (
              <div key={item.id}>
                {/* Collapsed summary row */}
                <button
                  onClick={() => toggleExpanded(item.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors",
                    isExpanded
                      ? isCurrent
                        ? "bg-purple-50/60 dark:bg-purple-900/15"
                        : "bg-blue-50/60 dark:bg-blue-900/15"
                      : isCurrent
                        ? "bg-purple-50/40 dark:bg-purple-900/10"
                        : isWrapped
                          ? "bg-emerald-50/30 dark:bg-emerald-900/10"
                          : "hover:bg-secondary/20"
                  )}
                >
                  <span
                    className={cn(
                      "flex-1 font-bold text-sm truncate",
                      isWrapped && !isExpanded ? "line-through opacity-60" : ""
                    )}
                    style={{ color: recipeColour }}
                  >
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                  </span>

                  {/* Key stats */}
                  <span className="text-xs tabular-nums text-purple-600 dark:text-purple-400 font-semibold flex-shrink-0">
                    {net > 0 ? net : "—"}
                  </span>
                  <span className="text-xs tabular-nums text-primary font-semibold flex-shrink-0">
                    {fridge > 0 ? fridge : "—"}
                  </span>

                  {isWrapped ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className={cn(
                      "w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform",
                      isExpanded ? "rotate-180" : ""
                    )} />
                  )}
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className={cn(
                    "border-t-2 px-4 py-4 space-y-3",
                    isCurrent
                      ? "border-purple-400 dark:border-purple-600"
                      : "border-blue-300 dark:border-blue-700"
                  )}>
                    {/* Header + wrapping toggle */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className={cn("font-semibold text-xl", isWrapped ? "line-through opacity-60" : "")} style={{ color: recipeColour }}>
                            {item.recipeName ?? `Recipe #${item.recipeId}`}
                          </h3>
                          {isWrapped && <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {getStationCount(item, "ovens")} / {effBatches(item)} oven loads
                          {item.builderMarkedCompleteAt && (
                            <span className="text-amber-600 dark:text-amber-400"> · builder marked complete</span>
                          )}
                          {!item.builderMarkedCompleteAt && (item.shortCount ?? 0) > 0 && (
                            <span className="text-red-500"> · {item.shortCount} short</span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleWrapping(item); }}
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

                    {/* From Chiller — Net + Wonky = Produced. Mirrors the
                        oven station's blast chiller card so the hand-off is
                        obvious: everything that came out of the chiller, split
                        between good and wonky. The "=" column is suppressed
                        when 8-pack bags change the arithmetic (same rule the
                        oven card uses). */}
                    <div className="rounded-xl border border-cyan-300 dark:border-cyan-800 bg-cyan-50/40 dark:bg-cyan-950/20 p-4">
                      <div className="flex items-center gap-2 text-base font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wider mb-3">
                        <Snowflake className="w-5 h-5" /> From Chiller
                      </div>
                      <div className="flex items-stretch justify-center gap-3">
                        <div className="flex-1 text-center bg-background rounded-lg border border-border py-2">
                          <p className="text-xs text-muted-foreground font-medium mb-0.5">Net packs</p>
                          <p className="text-3xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400 leading-tight">
                            {net}
                          </p>
                        </div>
                        <div className="flex items-center text-2xl text-muted-foreground font-light">+</div>
                        <div className="flex-1 text-center bg-background rounded-lg border border-border py-2">
                          <p className="text-xs text-muted-foreground font-medium mb-0.5">Wonky</p>
                          <p className={cn(
                            "text-3xl font-bold tabular-nums leading-tight",
                            wonkiesRecorded > 0 ? "text-red-500" : "text-muted-foreground/60",
                          )}>
                            {wonkiesRecorded}
                          </p>
                        </div>
                        {eightPkCount === 0 && (
                          <>
                            <div className="flex items-center text-2xl text-muted-foreground font-light">=</div>
                            <div className="flex-1 text-center bg-cyan-100/60 dark:bg-cyan-900/30 rounded-lg border border-cyan-300 dark:border-cyan-700 py-2">
                              <p className="text-xs text-cyan-700 dark:text-cyan-300 font-medium mb-0.5">Produced</p>
                              <p className="text-3xl font-bold tabular-nums text-cyan-700 dark:text-cyan-200 leading-tight">
                                {produced}
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                      {eightPkCount > 0 && (
                        <div className="mt-3 pt-3 border-t border-cyan-200 dark:border-cyan-800/60 flex items-center justify-center gap-6 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">{fzTarget > 0 ? "Fridge 8-packs" : "8-packs"}</span>
                            <span className="text-lg font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{eightPkFridge}/{fridgeBagTargetCount}</span>
                          </div>
                          {fzTarget > 0 && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground font-medium">Freezer 8-packs</span>
                              <span className="text-lg font-bold tabular-nums text-sky-600 dark:text-sky-400">{fzDone}/{fzTarget}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-medium">Produced</span>
                            <span className="text-lg font-bold tabular-nums text-cyan-700 dark:text-cyan-200">{produced}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Flow arrow — From Chiller → Production Fridge */}
                    <div className="flex justify-center -my-1">
                      <ArrowDown className="w-5 h-5 text-muted-foreground/50" />
                    </div>

                    {/* Disposition — where the net packs have gone. Wonky
                        packs are tracked separately in the Wonky Rack panel
                        at the bottom of the station. */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20 px-3 py-3 text-center">
                        <p className="text-xs text-purple-700 dark:text-purple-300 font-semibold uppercase tracking-wider mb-1">In Chiller</p>
                        <p className="text-3xl font-bold tabular-nums text-purple-700 dark:text-purple-300 leading-tight">{Math.max(0, remaining)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">awaiting wrap</p>
                      </div>
                      <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-3 text-center">
                        <p className="text-xs text-primary font-semibold uppercase tracking-wider mb-1">In Production Fridge</p>
                        <p className="text-3xl font-bold tabular-nums text-primary leading-tight">{fridge}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">wrapped &amp; stored</p>
                      </div>
                    </div>

                    {/* Mark as Chilled (HACCP cooling timer) — available to
                        wrappers as a redundant stamp. Oven operators can also
                        mark it earlier; either way, it's one stamp per recipe.
                        The wrapping-complete action auto-stamps as fallback if
                        nobody pressed it. */}
                    {(() => {
                      const chill = item.recipeId ? chillByRecipe[item.recipeId] : undefined;
                      const hasLastBatch = !!chill;
                      const alreadyChilled = !!chill?.chillEndAt;
                      const canMark = hasLastBatch && !alreadyChilled;
                      return (
                        <div className="flex items-center justify-between pt-3 border-t border-border/40">
                          <div>
                            <p className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                              <ThermometerSnowflake className="w-4 h-4 text-cyan-500" /> Chill Timer (HACCP)
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {alreadyChilled
                                ? `Chilled ${chill ? new Date(chill.chillEndAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""} · ${chill?.chilledVia?.replace(/_/g, " ") ?? ""}`
                                : hasLastBatch
                                  ? `Started ${new Date(chill!.chillStartAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — chill to ${chillTargetTempC}°C`
                                  : "Waiting for final oven batch"}
                            </p>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); markChilled(item); }}
                            disabled={!canMark || chillingRecipeId === item.recipeId}
                            className={cn(
                              "px-3 py-2 rounded-lg font-semibold text-sm transition-colors flex items-center gap-1.5",
                              alreadyChilled
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800"
                                : canMark
                                  ? "bg-cyan-600 text-white hover:bg-cyan-700"
                                  : "bg-secondary text-muted-foreground cursor-not-allowed opacity-60",
                            )}
                          >
                            {chillingRecipeId === item.recipeId ? <Loader2 className="w-4 h-4 animate-spin" /> : alreadyChilled ? <CheckCircle2 className="w-4 h-4" /> : <ThermometerSnowflake className="w-4 h-4" />}
                            {alreadyChilled ? "Chilled" : "Mark as Chilled"}
                          </button>
                        </div>
                      );
                    })()}

                    {/* Post-oven items (garlic butter, cream cheese icing).
                        This panel is the STANDING copy of the reminder: the
                        modal fires once and is gone, but the wrapper needs the
                        per-pack dose in front of them for the whole run. */}
                    {postOvenItems.length > 0 && (
                      <div className="pt-3 border-t border-amber-200 dark:border-amber-800">
                        <div className="flex items-center gap-2 mb-2">
                          <Flame className="w-4 h-4 text-amber-500" />
                          <span className="text-sm font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">After Oven — before wrapping</span>
                        </div>
                        <div className="space-y-1.5">
                          {postOvenItems.map((poi, idx) => {
                            const totalWeight = poi.weightPerBatch * (item.batchesTarget ?? 0);
                            const perPack = postOvenGramsPerPack(poi, item);
                            return (
                              <div key={idx} className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-base font-medium text-amber-800 dark:text-amber-200">{poi.name}</span>
                                  {/* Per-pack leads: it's the number you act on
                                      with a pack in your hand. The batch total
                                      is context for how much to bring out. */}
                                  <div className="text-right flex-shrink-0">
                                    <span className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-300">
                                      {perPack >= 10 ? Math.round(perPack) : Math.round(perPack * 10) / 10}g
                                    </span>
                                    <span className="text-sm text-amber-700/80 dark:text-amber-300/80 ml-1">per pack</span>
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {Math.round(totalWeight)}g across all {item.batchesTarget ?? 0} batches
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* SOPs for this recipe. Chips read at the bench; the
                        dashed "+ SOP" attaches one on the spot when a step
                        turns out to be undocumented — which is how the library
                        gets filled in, by the people who hit the gap. */}
                    {item.recipeId != null && (
                      <div className="pt-3 border-t border-border/40">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Method</span>
                          <SopChips
                            links={sopLinksByRecipe?.[item.recipeId] ?? []}
                            onOpen={sopViewer.open}
                            attach={{ targetType: "recipe", a: item.recipeId, label: item.recipeName ?? "this recipe" }}
                            queryKeysToInvalidate={[sopLinksKey]}
                          />
                        </div>
                      </div>
                    )}

                    {/* Storage controls. Destination is per item: fridge for
                        the calzone flow, freezer for freezer-stored products
                        — chosen by the wrapper, not hard-coded by product. */}
                    <div className="pt-3 border-t border-border/40">
                      {(fridge > 0 || (item.freezerQty ?? 0) > 0) && (
                        <p className="text-xs text-muted-foreground mb-2">
                          {fridge > 0 && <><span className="font-bold">{fridge}</span> in Production Fridge</>}
                          {fridge > 0 && (item.freezerQty ?? 0) > 0 && " · "}
                          {(item.freezerQty ?? 0) > 0 && <><span className="font-bold">{item.freezerQty}</span> in Product Freezer</>}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {(() => {
                          const dest = storageDest[item.id] ?? "fridge";
                          const destLabel = dest === "fridge" ? "Fridge" : "Freezer";
                          return (
                            <>
                              <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                                {(["fridge", "freezer"] as const).map(k => (
                                  <button
                                    key={k}
                                    onClick={() => setStorageDest(prev => ({ ...prev, [item.id]: k }))}
                                    className={dest === k
                                      ? "px-2.5 py-2 bg-secondary text-foreground"
                                      : "px-2.5 py-2 text-muted-foreground hover:text-foreground"}
                                    title={k === "fridge" ? "Production Fridge" : "Product Freezer — freezer stock is what wrapping-complete offers to Shopify"}
                                  >
                                    {k === "fridge" ? "Fridge" : "Freezer"}
                                  </button>
                                ))}
                              </div>
                              {remaining > 0 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); addToStorage(item, Math.min(STACK_SIZE, remaining), dest); }}
                                  disabled={isStorageLoading || isOnBreak || addingRef.current || storageBusy}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                >
                                  {isStorageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                  {remaining < STACK_SIZE ? `Add ${remaining} to ${destLabel}` : `Add ${STACK_SIZE}`}
                                </button>
                              )}
                            </>
                          );
                        })()}

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
                              onKeyDown={e => { if (e.key === "Enter" && customNum > 0) addToStorage(item, customNum, storageDest[item.id] ?? "fridge"); }}
                              className="w-20 h-10 rounded-lg border border-border bg-background px-2 text-base tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                              autoFocus
                            />
                            <button
                              onClick={() => { if (customNum > 0) addToStorage(item, customNum, storageDest[item.id] ?? "fridge"); }}
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

                        {(() => {
                          const dest = storageDest[item.id] ?? "fridge";
                          const stored = dest === "fridge" ? fridge : (item.freezerQty ?? 0);
                          if (stored <= 0) return null;
                          const undoAmt = Math.min(STACK_SIZE, stored);
                          return (
                            <button
                              onClick={() => undoStorage(item, undoAmt, dest)}
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
                            <button
                              onClick={() => undoStorage(item, 1, "fridge", 8)}
                              disabled={isStorageLoading || isOnBreak || storageBusy}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 text-sm font-medium hover:bg-indigo-100/60 dark:hover:bg-indigo-900/40 disabled:opacity-50 transition-colors"
                              title="Undo last 8-pack added to fridge"
                            >
                              <Minus className="w-4 h-4" />
                              Undo one
                            </button>
                          )}
                          {eightPkFridge > 0 && (
                            <span className="text-sm text-muted-foreground">{eightPkFridge} in fridge</span>
                          )}
                          {eightPkRemaining <= 0 && eightPkFridge > 0 && (
                            <span className="text-sm text-emerald-600 font-medium">All fridge 8-packs stored ✓</span>
                          )}
                        </div>
                      )}

                      {/* Freezer bags — the case-order allocation. Physically a
                          different job from fridge bags: blast-freeze the loose
                          portions, bag, count into the walk-in product freezer.
                          Counted here (not at ovens) because this is where the
                          bags actually come into existence. */}
                      {fzTarget > 0 && (
                        <div className="flex items-center gap-2 flex-wrap mt-2 pt-2 border-t border-sky-200/60 dark:border-sky-800/50">
                          <span className="text-sm font-medium text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                            <Snowflake className="w-4 h-4" /> Freezer bags{itemCaseOrderId(item) != null ? ` (case order #${itemCaseOrderId(item)})` : ""}:
                          </span>
                          <span className="text-sm font-bold tabular-nums text-sky-700 dark:text-sky-300">
                            {fzDone}/{fzTarget} in freezer
                          </span>
                          <button
                            onClick={() => adjustFreezerBags(item, 1)}
                            disabled={freezerBagBusy || isOnBreak || fzDone >= fzTarget}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors"
                          >
                            {freezerBagBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Bag to freezer
                          </button>
                          {fzTarget - fzDone > 1 && (
                            <button
                              onClick={() => adjustFreezerBags(item, fzTarget - fzDone)}
                              disabled={freezerBagBusy || isOnBreak}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 text-sm font-medium hover:bg-sky-100/60 dark:hover:bg-sky-900/40 disabled:opacity-50 transition-colors"
                            >
                              +{fzTarget - fzDone} remaining
                            </button>
                          )}
                          {fzDone > 0 && (
                            <button
                              onClick={() => adjustFreezerBags(item, -1)}
                              disabled={freezerBagBusy || isOnBreak}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-muted-foreground text-sm font-medium hover:bg-secondary/50 disabled:opacity-50 transition-colors"
                              title="Undo one freezer bag"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                          )}
                          {fzDone >= fzTarget && (
                            <span className="text-sm text-emerald-600 font-medium">All freezer bags in ✓</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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

      {/* One viewer for every chip on this screen, including the one inside
          the post-oven reminder modal. */}
      {sopViewer.dialog}
    </div>
  );
}
