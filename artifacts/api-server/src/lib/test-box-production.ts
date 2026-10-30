/**
 * Test boxes queue their own production from SALES (Graeme, 2026-10-08:
 * "as long as we automatically queue the production based on the box's
 * sales — rounding up to the nearest batch, and adding a batch if we need
 * to — prep and dough don't need scheduling"). Objectives A and C.
 *
 * Pure — no database — so every rule is unit-tested
 * (test-box-production.test.ts). The database side (loading orders,
 * writing Queued production) is test-box-production-data.ts.
 *
 *   1. packsSoldByRecipe — what customers bought for ONE delivery date:
 *      Shopify orders (the shopify_orders_cache mirror) that aren't
 *      cancelled, whose delivery-date tag ("2026-10-16", the same tag the
 *      rest of the app reads — deliveryDateTag) is that date, counting only
 *      line items that are the box's products, net of refunded quantities.
 *      A line is the box's product when its variant is mapped to the recipe
 *      (recipe_shopify_mappings) or its product is one the box created
 *      (test_box_shopify_products). Only a recipe with NO mapping at all
 *      falls back to matching the product title against the recipe name
 *      (same words, any order, emoji and "&" ignored) — and the result says
 *      so, because a renamed product would silently stop counting.
 *      8-pack bags are never matched by title (a bag is 4 packs, not 1).
 *   2. batchesFor — calzones = packs × pack size; batches = the fewest
 *      WHOLE batches that cover the packs sold PLUS the production safety
 *      margin (2 packs, 4 over 12 batches — @workspace/plan-margin, 15 Oct
 *      2026: "it always adds on at least two packs"); plus one safety batch
 *      per recipe when the delivery's toggle is on (only for a recipe that
 *      sold).
 *   3. planQueueDiff — what to write to Queued production so the delivery's
 *      own rows match, idempotently: update in place, never duplicate, take
 *      off what's no longer wanted, never touch a row a plan has already
 *      taken (warn instead).
 *   4. planUnqueue — reopening / cancelling the delivery takes its queued
 *      rows off; rows already on a plan stay, with a warning.
 */
import { deliveryDateTag } from "./team-efficiency-despatch";
import { DEFAULT_PLAN_MARGIN, minBatchesForOrders, type PlanMarginSettings } from "@workspace/plan-margin";

/** Shopify's 8-pack bag variant title (same marker as shopify-stock-check.ts). */
const EIGHT_PACK = "8 pack bag";
/** Two-packs in one 8-pack bag (same equivalence as dpt-suggestion.ts). */
const EIGHT_PACK_PACKS = 4;

export interface SalesLine {
  id: string;
  variantId: string | null;
  productId: string | null;
  title: string | null;
  variantTitle: string | null;
  quantity: number;
}
export interface SalesOrder {
  id: string;
  name: string | null;
  tags: string | null;
  cancelledAt: string | null;
  lineItems: SalesLine[];
  /** Every refunded line, from every refund on the order. */
  refunds: Array<{ lineItemId: string; quantity: number }>;
}
export interface BoxRecipeLinks {
  recipeId: number;
  name: string;
  /** recipe_shopify_mappings.shopify_variant_id for this recipe. */
  variantIds: string[];
  /** Products the box created for it (test_box_shopify_products). */
  productIds: string[];
  /** 8-pack bag variants (recipe_shopify_mappings.eight_pack_variant_id) — one bag = 4 packs. */
  eightPackVariantIds?: string[];
}

export type MatchedBy = "mapped" | "title" | "none";

export interface SalesCount {
  /** Net packs sold per recipe (every box recipe present, 0 if none). */
  packs: Map<number, number>;
  /** How each recipe's lines were recognised. */
  matchedBy: Map<number, MatchedBy>;
  /** Orders that contributed at least one pack. */
  orders: number;
}

/** "Properoni - CarniZone 🍗" and "Properoni Carnizone" → the same words. */
export function titleWords(s: string): string {
  return [...new Set(
    s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter(w => w && w !== "and"),
  )].sort().join(" ");
}

export function packsSoldByRecipe(orders: readonly SalesOrder[], deliveryDate: string, recipes: readonly BoxRecipeLinks[]): SalesCount {
  const byVariant = new Map<string, number>();
  const bagVariant = new Map<string, number>();
  const byProduct = new Map<string, number>();
  const byTitle = new Map<string, number>();
  const matchedBy = new Map<number, MatchedBy>();
  const packs = new Map<number, number>();
  for (const r of recipes) {
    packs.set(r.recipeId, 0);
    for (const v of r.variantIds) byVariant.set(String(v), r.recipeId);
    for (const v of r.eightPackVariantIds ?? []) bagVariant.set(String(v), r.recipeId);
    for (const p of r.productIds) byProduct.set(String(p), r.recipeId);
    const mapped = r.variantIds.length > 0 || r.productIds.length > 0;
    matchedBy.set(r.recipeId, mapped ? "mapped" : "none");
    if (!mapped) byTitle.set(titleWords(r.name), r.recipeId);
  }

  let counted = 0;
  for (const o of orders) {
    if (o.cancelledAt) continue;
    if (deliveryDateTag(o.tags) !== deliveryDate) continue;
    const refunded = new Map<string, number>();
    for (const rf of o.refunds) refunded.set(String(rf.lineItemId), (refunded.get(String(rf.lineItemId)) ?? 0) + (Number(rf.quantity) || 0));
    let any = false;
    for (const li of o.lineItems) {
      const bagOf = li.variantId != null ? bagVariant.get(String(li.variantId)) : undefined;
      let recipeId = bagOf ?? (li.variantId != null ? byVariant.get(String(li.variantId)) : undefined);
      if (recipeId == null && li.productId != null) recipeId = byProduct.get(String(li.productId));
      let viaTitle = false;
      if (recipeId == null && li.title && !(li.variantTitle ?? "").toLowerCase().includes(EIGHT_PACK)) {
        recipeId = byTitle.get(titleWords(li.title));
        viaTitle = recipeId != null;
      }
      if (recipeId == null) continue;
      const net = Math.max(0, (Number(li.quantity) || 0) - (refunded.get(String(li.id)) ?? 0)) * (bagOf != null ? EIGHT_PACK_PACKS : 1);
      if (net === 0) continue;
      packs.set(recipeId, (packs.get(recipeId) ?? 0) + net);
      if (viaTitle) matchedBy.set(recipeId, "title");
      any = true;
    }
    if (any) counted++;
  }
  return { packs, matchedBy, orders: counted };
}

/** Packs → whole batches covering orders + the safety margin, + an optional
 *  safety batch. 32 packs at 5 a batch → 34 → 7 batches; 25 → 27 → 6. */
export function batchesFor(
  input: { packs: number; packSize: number; portionsPerBatch: number; safetyBatch: boolean },
  margin: PlanMarginSettings = DEFAULT_PLAN_MARGIN,
): { calzones: number; batches: number; marginPacks: number } {
  const packSize = input.packSize > 0 ? input.packSize : 1;
  const perBatch = input.portionsPerBatch > 0 ? input.portionsPerBatch : 10;
  const packs = Math.max(0, input.packs);
  const calzones = packs * packSize;
  if (calzones === 0) return { calzones: 0, batches: 0, marginPacks: 0 };
  // minBatchesForOrders strips float dust (2.0000 × 25 = 50.00000001 must not become 6 batches of 10).
  const min = minBatchesForOrders({ demandPacks: packs, packsPerBatch: perBatch / packSize }, margin);
  return { calzones, batches: min.batches + (input.safetyBatch ? 1 : 0), marginPacks: min.marginPacks };
}

export interface QueueRow {
  id: number;
  recipeId: number;
  batches: number;
  /** queued → planned (landed on a plan) | cancelled. */
  status: string;
  testBoxDeliveryId: number | null;
}

export type QueueAction =
  | { kind: "insert"; recipeId: number; batches: number }
  /** adopt = a row queued by hand for the same recipe and day, taken over by the box. */
  | { kind: "update"; id: number; recipeId: number; batches: number; adopt: boolean }
  | { kind: "cancel"; id: number; recipeId: number };

export interface QueueWarning {
  recipeId: number;
  /** "on-plan": the day's plan already took this row — change it on the plan.
   *  "adopted": a row queued by hand had `was` batches; the box now owns it. */
  kind: "on-plan" | "adopted";
  was: number;
  want: number;
}

/**
 * Make the delivery's queued rows match `wanted` (batches per recipe).
 * `rows` = every non-cancelled Queued production row for the production day.
 */
export function planQueueDiff(wanted: ReadonlyArray<{ recipeId: number; batches: number }>, rows: readonly QueueRow[], deliveryId: number): { actions: QueueAction[]; warnings: QueueWarning[] } {
  const actions: QueueAction[] = [];
  const warnings: QueueWarning[] = [];
  const live = rows.filter(r => r.status !== "cancelled");
  const own = live.filter(r => r.testBoxDeliveryId === deliveryId);
  const want = new Map<number, number>();
  for (const w of wanted) if (w.batches > 0) want.set(w.recipeId, (want.get(w.recipeId) ?? 0) + w.batches);

  for (const [recipeId, batches] of want) {
    const mine = own.filter(r => r.recipeId === recipeId);
    const keep = mine.find(r => r.status === "planned") ?? mine[0];
    for (const extra of mine) if (extra !== keep && extra.status === "queued") actions.push({ kind: "cancel", id: extra.id, recipeId });
    if (keep) {
      if (keep.status === "planned") {
        if (keep.batches !== batches) warnings.push({ recipeId, kind: "on-plan", was: keep.batches, want: batches });
      } else if (keep.batches !== batches) {
        actions.push({ kind: "update", id: keep.id, recipeId, batches, adopt: false });
      }
      continue;
    }
    const byHand = live.find(r => r.testBoxDeliveryId == null && r.recipeId === recipeId);
    if (byHand && byHand.status === "queued") {
      actions.push({ kind: "update", id: byHand.id, recipeId, batches, adopt: true });
      if (byHand.batches !== batches) warnings.push({ recipeId, kind: "adopted", was: byHand.batches, want: batches });
    } else if (byHand) {
      // Queued by hand and already on the plan: a new row wouldn't land.
      warnings.push({ recipeId, kind: "on-plan", was: byHand.batches, want: batches });
    } else {
      actions.push({ kind: "insert", recipeId, batches });
    }
  }

  for (const r of own) {
    if (want.has(r.recipeId)) continue;
    if (r.status === "queued") actions.push({ kind: "cancel", id: r.id, recipeId: r.recipeId });
    else if (r.status === "planned") warnings.push({ recipeId: r.recipeId, kind: "on-plan", was: r.batches, want: 0 });
  }
  return { actions, warnings };
}

/** Reopening or cancelling a delivery: take its queued rows off. */
export function planUnqueue(rows: readonly QueueRow[], deliveryId: number): { cancel: number[]; onPlan: QueueRow[] } {
  const own = rows.filter(r => r.testBoxDeliveryId === deliveryId);
  return {
    cancel: own.filter(r => r.status === "queued").map(r => r.id),
    onPlan: own.filter(r => r.status === "planned"),
  };
}
