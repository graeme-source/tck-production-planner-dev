/**
 * The fridge gate — one allocation walk shared by the packing queue
 * (pages/fulfilment.tsx) and the wrapping station's "wrap these to release
 * today's orders" banner (Graeme, 2026-09-14: the banner must read EXACTLY
 * the data the packing queue reads; it previously derived from the planning
 * calculation, which showed draft products and quantities nobody ordered).
 *
 * Walk the pick list in DISPLAY order, allocating wrapped 2-pack fridge
 * stock to each order. An order stays pickable only when every mapped line
 * fits in what's left; a held order consumes nothing (a smaller later
 * order can still fit). Lines we can't map to a recipe never gate their
 * order — better to over-offer than wrongly hide. The unmet demand of the
 * held orders becomes the wrap-deficit readout.
 */

// Optional-chained so the pure allocation walk stays importable under
// vitest, where import.meta.env isn't populated.
const BASE = (import.meta.env?.BASE_URL ?? "").replace(/\/$/, "");

/** Current 2-pack fridge stock per recipe + the variant→recipe map, so the
 *  pick list can be gated to orders the fridge can actually satisfy. */
export interface FridgeAvailability {
  stock: Array<{ recipeId: number; recipeName: string; packs: number }>;
  variants: Record<string, { recipeId: number; packsPerUnit: number; pool?: "packs" | "bags" }>;
  /** Name for every mapped recipe — recipes with no fridge stock row (the
   *  short ones) aren't in `stock`, but the deficit card must still name
   *  them. */
  recipeNames?: Record<number, string>;
  /** variantId → recipe name for products that ARE mapped but whose recipe
   *  isn't flagged core-menu / fridge-product, so the fridge holds no count
   *  for them. Distinguishing these from truly unmapped lines is the
   *  difference between "map the variant" and "tick Core menu". */
  outOfScopeVariants?: Record<string, string>;
  /** 8-pack bags wrapped TODAY per recipe — the pool bag orders gate on. */
  bagStock?: Array<{ recipeId: number; bags: number }>;
  /** variantId → Shopify inventory level, for variants Shopify itself
   *  tracks (oversell denied). An accepted order line on one of these is
   *  already stock-checked — by Shopify, not the fridge. */
  shopifyTracked?: Record<string, number>;
  /** lower-cased Shopify product title → recipeId, for resolving "8 Pack
   *  Bag" variant lines to their recipe's bag pool (eight_pack_variant_id
   *  was never populated — same title convention as wholesale-bags). */
  bagRecipeByTitle?: Record<string, number>;
  specialRecipeId: number | null;
}

export async function fetchFridgeAvailability(): Promise<FridgeAvailability | null> {
  const res = await fetch(`${BASE}/api/fulfilment/fridge-availability`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as FridgeAvailability;
}

/** The slice of a Shopify order the gate reads — structural, so both the
 *  fulfilment page's rich order type and the banner's lean one fit. */
export interface GateOrder {
  id: number;
  line_items?: Array<{
    variant_id?: number | null;
    title: string;
    variant_title?: string | null;
    quantity: number;
    price?: string | null;
    grams?: number | null;
  }>;
}

export interface FridgeAllocation<T extends GateOrder> {
  pickable: T[];
  held: T[];
  deficits: Array<{ recipeName: string; packs: number }>;
  active: boolean;
  shortFor: Map<number, string[]>;
  /** Lines the gate CANNOT check — no recipe mapping for the variant. They
   *  never hold an order back, so without surfacing them the gate looks
   *  broken when it's actually blind (Graeme, 2026-08-28). */
  uncheckedTitles: Set<string>;
  uncheckedOrderIds: Set<number>;
}

export function computeFridgeAllocation<T extends GateOrder>(
  orderedOrders: T[],
  fridgeAvailability: FridgeAvailability | null | undefined,
): FridgeAllocation<T> {
  if (!fridgeAvailability) {
    return {
      pickable: orderedOrders,
      held: [],
      deficits: [],
      active: false,
      shortFor: new Map(),
      uncheckedTitles: new Set(),
      uncheckedOrderIds: new Set(),
    };
  }
  // Two pools per recipe, keyed "packs:<id>" and "bags:<id>". 2-pack lines
  // draw on the fridge's 2-pack level; 8-pack bag lines draw on bags
  // wrapped TODAY (backend sends only today's entries) — so a bag order
  // stays held until its bags are wrapped that day.
  const remaining = new Map<string, number>();
  const names = new Map<number, string>();
  for (const [rid, name] of Object.entries(fridgeAvailability.recipeNames ?? {})) {
    names.set(Number(rid), name);
  }
  for (const s of fridgeAvailability.stock) {
    remaining.set(`packs:${s.recipeId}`, s.packs);
    names.set(s.recipeId, s.recipeName);
  }
  for (const b of fridgeAvailability.bagStock ?? []) {
    remaining.set(`bags:${b.recipeId}`, b.bags);
  }
  const poolLabel = (key: string) => {
    const [pool, rid] = key.split(":");
    const name = names.get(Number(rid)) ?? `Recipe ${rid}`;
    return pool === "bags" ? `${name} (8-pack bags)` : name;
  };
  const uncheckedTitles = new Set<string>();
  const uncheckedOrderIds = new Set<number>();
  const needsFor = (o: T) => {
    const needs = new Map<string, number>();
    for (const li of o.line_items ?? []) {
      const mapped = li.variant_id != null ? fridgeAvailability.variants[String(li.variant_id)] : undefined;
      let recipeId = mapped?.recipeId;
      let packsPer = mapped?.packsPerUnit ?? 1;
      let pool: "packs" | "bags" = mapped?.pool ?? "packs";
      if (recipeId == null && fridgeAvailability.specialRecipeId != null
          && li.title.toLowerCase().includes("calzone club special")) {
        recipeId = fridgeAvailability.specialRecipeId;
        packsPer = 1;
        pool = "packs";
      }
      // 8-pack bag lines resolve by PRODUCT TITLE — the bag is a variant
      // of the same Shopify product as the mapped 2-pack, and
      // eight_pack_variant_id was never populated (same convention as the
      // wholesale-bags queue). These gate on TODAY's wrapped bags.
      if (recipeId == null
          && (li.variant_title ?? "").toLowerCase().includes("8 pack bag")) {
        const bagRecipe = fridgeAvailability.bagRecipeByTitle?.[li.title.trim().toLowerCase()];
        if (bagRecipe != null) {
          recipeId = bagRecipe;
          packsPer = 1;
          pool = "bags";
        }
      }
      if (recipeId == null) {
        // The fridge can't check this line — but Shopify may already have.
        // Everything TCK sells that isn't wrapped into the production
        // fridge (fried chicken in the freezer, dessert packs, third-party
        // sauces, F2F lines) is inventory-tracked on Shopify with
        // overselling denied, so the accepted order IS the stock check.
        // Those lines are checked, not "unchecked" (Graeme, 2026-09-04).
        if (li.variant_id != null
            && fridgeAvailability.shopifyTracked?.[String(li.variant_id)] != null) {
          continue;
        }
        // £0 and 0 g is a paper insert riding along with the order (e.g.
        // "Order Insert (first time customers)") — there is no stock to
        // check. Structural, not name-based, per the charter.
        if (Number(li.price ?? "0") === 0 && (li.grams ?? 0) === 0) {
          continue;
        }
        // NOTHING checked this line — no fridge mapping AND Shopify isn't
        // tracking it. Say so out loud, and say WHY, naming the fix.
        const outOfScopeName = li.variant_id != null
          ? fridgeAvailability.outOfScopeVariants?.[String(li.variant_id)]
          : undefined;
        uncheckedTitles.add(outOfScopeName
          ? `${li.title} — ${outOfScopeName} isn't flagged core menu / fridge product, and Shopify isn't tracking its stock`
          : `${li.title} — no recipe mapping, and Shopify isn't tracking its stock`);
        uncheckedOrderIds.add(o.id);
        continue;
      }
      const key = `${pool}:${recipeId}`;
      needs.set(key, (needs.get(key) ?? 0) + li.quantity * packsPer);
    }
    return needs;
  };
  const pickable: T[] = [];
  const held: T[] = [];
  const heldDemand = new Map<string, number>();
  const shortFor = new Map<number, string[]>();
  for (const o of orderedOrders) {
    const needs = needsFor(o);
    const fits = [...needs].every(([key, qty]) => (remaining.get(key) ?? 0) >= qty);
    if (fits) {
      for (const [key, qty] of needs) remaining.set(key, (remaining.get(key) ?? 0) - qty);
      pickable.push(o);
    } else {
      held.push(o);
      const shorts: string[] = [];
      for (const [key, qty] of needs) {
        heldDemand.set(key, (heldDemand.get(key) ?? 0) + qty);
        const have = remaining.get(key) ?? 0;
        if (have < qty) shorts.push(`${poolLabel(key)} (need ${qty}, ${key.startsWith("bags") ? "wrapped today" : "fridge has"} ${have})`);
      }
      shortFor.set(o.id, shorts);
    }
  }
  const deficits = [...heldDemand]
    .map(([key, demand]) => ({
      recipeName: poolLabel(key),
      packs: Math.max(0, demand - (remaining.get(key) ?? 0)),
    }))
    .filter(d => d.packs > 0)
    .sort((a, b) => b.packs - a.packs);
  return { pickable, held, deficits, active: true, shortFor, uncheckedTitles, uncheckedOrderIds };
}
