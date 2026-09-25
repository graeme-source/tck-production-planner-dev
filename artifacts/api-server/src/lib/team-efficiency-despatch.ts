/**
 * Team efficiency — what went out the door each day (Objective I; pure).
 *
 * An order counts on its despatch day: the delivery-date tag (YYYY-MM-DD)
 * minus one day, because courier orders are packed the day before they
 * arrive. A collection order is handed over ON its tagged day. Only
 * fulfilled, uncancelled orders count.
 *
 * Packs come from line items mapped to recipes (recipe_shopify_mappings);
 * 8-pack bags are recognised by the variant title marker and joined on the
 * product title, the same convention as the rest of the app. Lines are
 * valued at RRP here — the fixed per-line discount is applied later
 * (team-efficiency-day.ts), on the same basis as production, so it cancels
 * out of the percentage.
 */
import { isCollectionOrder } from "./dispatch-tag";
import { EIGHT_PACK_TITLE_MARKER } from "./shopify-stock-check";
import { addDaysIso } from "./team-efficiency-labour";
import type { LineDespatched } from "./team-efficiency-day";

export interface OrderInput {
  tags: string | null;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  lineItems: Array<{
    variantId: string | null;
    variantTitle: string | null;
    title: string | null;
    quantity: number;
  }>;
}

export interface RecipeInput { id: number; category: string | null; packSize: number; rrp: number }

export interface DayDespatch {
  orders: number;
  lines: Record<string, LineDespatched>;
}

const DATE_TAG = /^\d{4}-\d{2}-\d{2}$/;

/** The delivery date an order is tagged with, if any. */
export function deliveryDateTag(tags: string | null | undefined): string | null {
  for (const t of (tags ?? "").split(",")) {
    const x = t.trim();
    if (DATE_TAG.test(x)) return x;
  }
  return null;
}

/** The day an order left: tag − 1 for courier orders, the tag for collections. */
export function despatchDay(tags: string | null | undefined): string | null {
  const tag = deliveryDateTag(tags);
  if (!tag) return null;
  return isCollectionOrder(tags) ? tag : addDaysIso(tag, -1);
}

export function despatchByDay(
  orders: OrderInput[],
  recipeByVariant: Map<string, number>,
  recipeByProductTitle: Map<string, number>,
  recipes: Map<number, RecipeInput>,
): Map<string, DayDespatch> {
  const out = new Map<string, DayDespatch>();
  for (const o of orders) {
    if (o.cancelledAt) continue;
    if ((o.fulfillmentStatus ?? "").toLowerCase() !== "fulfilled") continue;
    const day = despatchDay(o.tags);
    if (!day) continue;
    const d = out.get(day) ?? { orders: 0, lines: {} };
    d.orders += 1;
    for (const li of o.lineItems) {
      const qty = Number(li.quantity) || 0;
      if (qty <= 0) continue;
      const isBag = (li.variantTitle ?? "").toLowerCase().includes(EIGHT_PACK_TITLE_MARKER);
      const rid = isBag
        ? recipeByProductTitle.get((li.title ?? "").trim().toLowerCase())
        : (li.variantId ? recipeByVariant.get(String(li.variantId)) : undefined);
      const r = rid != null ? recipes.get(rid) : undefined;
      if (!r || !r.category || r.packSize <= 0) continue;
      const line = d.lines[r.category] ?? { packs: 0, gross: 0, bagPacks: 0, bagGross: 0 };
      if (isBag) {
        const packs = qty * (8 / r.packSize);
        line.bagPacks += packs;
        line.bagGross += packs * r.rrp;
      } else {
        line.packs += qty;
        line.gross += qty * r.rrp;
      }
      d.lines[r.category] = line;
    }
    out.set(day, d);
  }
  return out;
}
