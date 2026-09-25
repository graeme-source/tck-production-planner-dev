/**
 * Recording a delivery we weren't expecting — the pure decisions behind
 * routes/unexpected-deliveries.ts (Graeme, 2026-09-25). No DB, no network.
 *
 * Two jobs:
 *   1. "Is it one of these?" — given what's in the basket (a supplier and/or
 *      some items), rank the OPEN purchase orders it could really be. Orders
 *      that contain the same items come first, whatever day they were booked
 *      for: the most common case is an order that's been sitting on another
 *      day because nobody spotted it arrived early or late.
 *   2. "No — it's a different delivery" — turn the basket into a new purchase
 *      order marked origin 'unexpected', due today, which then goes through
 *      the normal goods-in receive (same checks, same stock update).
 *
 * Objectives C (stock stays right) and D (same goods-in checks every time).
 */

// ─── 1. Matching open orders ────────────────────────────────────────────────

export interface OpenOrderLine {
  ingredientId: number | null;
  name: string;
  quantityOrdered: number;
  unit: string;
}

export interface OpenOrderCandidate {
  id: number;
  supplierId: number;
  supplierName: string;
  /** YYYY-MM-DD, or null for an order never given a date. */
  expectedDeliveryDate: string | null;
  lines: OpenOrderLine[];
}

export interface BasketSummary {
  /** The supplier the delivery is from, when known. */
  supplierId: number | null;
  /** Every catalogue item in the basket (misc lines have none). */
  ingredientIds: number[];
}

export interface OpenOrderMatch extends OpenOrderCandidate {
  /** Basket items that are on this order. */
  matchedIngredientIds: number[];
  sameSupplier: boolean;
  /** Days from today to the booked date: negative = was due in the past. */
  daysFromToday: number | null;
  /** Plain-English reasons shown on the card. */
  reasons: string[];
  score: number;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Open orders booked more than this many days ago are left out. The live
 * data holds placed orders from months back that were never booked in (or
 * were superseded) — offering a five-month-old order as "maybe it's this
 * one" is noise that buries the real candidate.
 */
export const STALE_OPEN_ORDER_DAYS = 60;

/**
 * Rank open orders against the basket. An order is offered when it shares at
 * least one item with the basket OR comes from the same supplier, and wasn't
 * booked for more than STALE_OPEN_ORDER_DAYS ago. Items outrank supplier (an
 * order with the very things on the pallet is the best guess), then the order
 * booked closest to today wins ties.
 */
export function rankOpenOrderMatches(
  candidates: OpenOrderCandidate[],
  basket: BasketSummary,
  today: string,
  limit = 12,
  staleAfterDays = STALE_OPEN_ORDER_DAYS,
): OpenOrderMatch[] {
  const wanted = new Set(basket.ingredientIds);
  const out: OpenOrderMatch[] = [];

  for (const c of candidates) {
    const daysFromToday = c.expectedDeliveryDate ? daysBetween(today, c.expectedDeliveryDate) : null;
    if (daysFromToday != null && daysFromToday < -staleAfterDays) continue;

    const onOrder = new Set(c.lines.map(l => l.ingredientId).filter((id): id is number => id != null));
    const matchedIngredientIds = [...wanted].filter(id => onOrder.has(id));
    const sameSupplier = basket.supplierId != null && c.supplierId === basket.supplierId;
    if (matchedIngredientIds.length === 0 && !sameSupplier) continue;

    const reasons: string[] = [];
    if (matchedIngredientIds.length > 0) {
      reasons.push(
        wanted.size === 1
          ? "Has this item on it"
          : matchedIngredientIds.length === wanted.size
            ? `Has all ${wanted.size} of your items`
            : `Has ${matchedIngredientIds.length} of your ${wanted.size} items`,
      );
    }
    if (sameSupplier) reasons.push("Same supplier");

    // Items dominate: every matched item is worth more than supplier + any
    // date closeness. Full coverage gets a bonus. Date closeness (0–30) only
    // separates otherwise-equal orders.
    const coverage = wanted.size > 0 ? matchedIngredientIds.length / wanted.size : 0;
    const closeness = daysFromToday == null ? 0 : Math.max(0, 30 - Math.abs(daysFromToday));
    const score =
      matchedIngredientIds.length * 100 +
      (coverage === 1 ? 50 : 0) +
      (sameSupplier ? 40 : 0) +
      closeness;

    out.push({ ...c, matchedIngredientIds, sameSupplier, daysFromToday, reasons, score });
  }

  out.sort((a, b) => b.score - a.score || a.id - b.id);
  return out.slice(0, limit);
}

/**
 * "Yes, it's this one" on an order booked for another day: move it to today
 * so it sits with today's deliveries and its use-by dates count from the day
 * it really arrived, remembering the day it was booked for. Returns null when
 * nothing needs changing (already today). Only open ('placed') orders move —
 * a received order is edited from its own card, never re-dated here.
 */
export function arrivedTodayChange(
  order: { status: string; expectedDeliveryDate: string | null; originallyExpectedDate: string | null },
  today: string,
):
  | { ok: true; change: { expectedDeliveryDate: string; originallyExpectedDate: string | null } | null }
  | { ok: false; error: string } {
  if (order.status !== "placed") {
    return { ok: false, error: "That order has already been received — open it from its own day to edit it" };
  }
  if (order.expectedDeliveryDate === today) return { ok: true, change: null };
  return {
    ok: true,
    change: {
      expectedDeliveryDate: today,
      // Keep the FIRST booked date if it has been moved before.
      originallyExpectedDate: order.originallyExpectedDate ?? order.expectedDeliveryDate,
    },
  };
}

// ─── 2. Building the new purchase order ─────────────────────────────────────

export interface BasketItemLine {
  kind: "item";
  ingredientId: number;
  /** In packs when the item has a pack weight, otherwise its native unit. */
  quantity: number;
  /** Price per pack; defaults to the item's cost per pack when omitted. */
  unitPrice?: number | null;
}

export interface BasketMiscLine {
  kind: "misc";
  description: string;
  quantity: number;
  unit?: string | null;
  unitPrice?: number | null;
}

export type BasketLine = BasketItemLine | BasketMiscLine;

export interface CatalogueItemInfo {
  id: number;
  name: string;
  unit: string;
  packWeight: string | number | null;
  costPerPack: string | number | null;
}

/**
 * The unit an item is counted in at the door: whole packs when it has a pack
 * weight (the receive step converts packs × pack weight into stock), else its
 * own unit — a pack count with no pack weight would turn "3 packs" into 3 kg.
 */
export function unexpectedLineUnit(item: Pick<CatalogueItemInfo, "unit" | "packWeight">): string {
  return (Number(item.packWeight) || 0) > 0 ? "packs" : item.unit;
}

export interface UnexpectedPurchaseOrder {
  order: {
    supplierId: number;
    status: "placed";
    origin: "unexpected";
    expectedDeliveryDate: string;
    placedAt: Date;
    placedByUserId: number | null;
    notes: string | null;
  };
  lines: Array<{
    ingredientId: number | null;
    description: string | null;
    quantityRequired: string;
    quantityOrdered: string;
    /** Always 0 — stock is only ever added by the receive step. */
    quantityReceived: "0";
    unit: string;
    unitPrice: string | null;
  }>;
}

export type BuildResult =
  | { ok: true; value: UnexpectedPurchaseOrder }
  | { ok: false; error: string };

/**
 * Turn the basket into a purchase order. It's created as 'placed', due
 * today, with nothing received: the person then books it in through the
 * normal receive step, which marks it received and adds the stock — so an
 * unexpected delivery can never add stock twice or skip the checks.
 */
export function buildUnexpectedPurchaseOrder(
  input: { supplierId: number; lines: BasketLine[]; notes?: string | null },
  catalogue: Map<number, CatalogueItemInfo>,
  ctx: { today: string; now: Date; userId: number | null },
): BuildResult {
  if (input.lines.length === 0) return { ok: false, error: "Add at least one item to the delivery" };

  const lines: UnexpectedPurchaseOrder["lines"] = [];
  const seen = new Set<number>();

  for (const l of input.lines) {
    if (!(l.quantity > 0) || !Number.isFinite(l.quantity)) {
      return { ok: false, error: "Every item needs a quantity above zero" };
    }
    const price = l.unitPrice != null && Number.isFinite(l.unitPrice) && l.unitPrice >= 0 ? l.unitPrice : null;

    if (l.kind === "misc") {
      const description = l.description.trim();
      if (!description) return { ok: false, error: "Say what the extra item is" };
      lines.push({
        ingredientId: null,
        description: description.slice(0, 500),
        quantityRequired: "0",
        quantityOrdered: String(l.quantity),
        quantityReceived: "0",
        unit: (l.unit ?? "").trim() || "each",
        unitPrice: price != null ? String(price) : null,
      });
      continue;
    }

    const item = catalogue.get(l.ingredientId);
    if (!item) return { ok: false, error: `Item ${l.ingredientId} isn't in the system any more` };
    if (seen.has(item.id)) return { ok: false, error: `${item.name} is in the delivery twice — combine the quantities` };
    seen.add(item.id);

    const catalogueCost = Number(item.costPerPack) || 0;
    const unitPrice = price ?? (catalogueCost > 0 ? catalogueCost : null);
    lines.push({
      ingredientId: item.id,
      description: null,
      quantityRequired: "0",
      quantityOrdered: String(l.quantity),
      quantityReceived: "0",
      unit: unexpectedLineUnit(item),
      unitPrice: unitPrice != null ? String(unitPrice) : null,
    });
  }

  const note = input.notes?.trim();
  return {
    ok: true,
    value: {
      order: {
        supplierId: input.supplierId,
        status: "placed",
        origin: "unexpected",
        expectedDeliveryDate: ctx.today,
        placedAt: ctx.now,
        placedByUserId: ctx.userId,
        notes: note ? note.slice(0, 1000) : null,
      },
      lines,
    },
  };
}
