/**
 * Production safety margin (Graeme, 15 Oct 2026). Objective C.
 *
 * "We should always round up to the nearest batch. We should never attempt to
 * make exactly the right amount because if we're two packs short, then we
 * haven't got enough to fulfil orders." On 14 Oct the three Properoni test
 * products were planned at exactly (or under) their orders; one batch came
 * out 2 packs light and orders had to be cancelled.
 *
 * THE RULE — one copy, used by the plan suggestion (server + Create Plan
 * screen), the test-box auto-queue and the plan warnings:
 *
 *   packs available (stock + planned) ≥ orders + margin
 *
 *   margin = 2 packs, or 4 packs when the orders alone need more than 12
 *   batches. All three numbers are app settings (PLAN_MARGIN_SETTING_KEYS),
 *   editable by managers on the Create Plan screen.
 *
 * Which batch count decides the bigger margin? The batches needed to cover
 * the ORDERS alone (after stock, before any margin). It is never circular,
 * and for the worked example both readings agree:
 *   78 packs sold, 5 packs a batch → orders alone = 16 batches (> 12)
 *   → margin 4 → need 82 → 17 batches = 85 packs.
 *
 * Packs throughout (a calzone 2-pack is one pack; 10 portions ÷ pack size 2
 * = 5 packs a batch). Pure — no database — so every rule is unit-tested.
 */
export { solveTargetAllocation, largestRemainderRound, type AllocationPoolRow, type TargetAllocation } from "./allocation";

export const PLAN_MARGIN_SETTING_KEYS = {
  smallMarginPacks: "plan_margin_packs",
  largeMarginPacks: "plan_margin_packs_large",
  largeBatchThreshold: "plan_margin_large_batches",
} as const;

export interface PlanMarginSettings {
  /** Extra packs every recipe with orders must have (default 2). */
  smallMarginPacks: number;
  /** Extra packs once the orders need more than `largeBatchThreshold` batches (default 4). */
  largeMarginPacks: number;
  /** Orders needing MORE than this many batches get the large margin (default 12). */
  largeBatchThreshold: number;
}

export const DEFAULT_PLAN_MARGIN: PlanMarginSettings = {
  smallMarginPacks: 2,
  largeMarginPacks: 4,
  largeBatchThreshold: 12,
};

/** Parse the three app settings, falling back to the defaults for anything
 *  missing or nonsensical (blank, negative, not a number). */
export function parsePlanMarginSettings(raw: {
  smallMarginPacks?: string | null;
  largeMarginPacks?: string | null;
  largeBatchThreshold?: string | null;
}): PlanMarginSettings {
  const num = (v: string | null | undefined, fallback: number) => {
    if (v == null || String(v).trim() === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  return {
    smallMarginPacks: num(raw.smallMarginPacks, DEFAULT_PLAN_MARGIN.smallMarginPacks),
    largeMarginPacks: num(raw.largeMarginPacks, DEFAULT_PLAN_MARGIN.largeMarginPacks),
    largeBatchThreshold: num(raw.largeBatchThreshold, DEFAULT_PLAN_MARGIN.largeBatchThreshold),
  };
}

/** Whole batches for `packs`, rounded UP — with float dust removed first
 *  (10 ÷ 2.0000 × … must never turn an exact 5 into 6). */
export function batchesToCover(packs: number, packsPerBatch: number): number {
  if (!(packs > 0)) return 0;
  const ppb = packsPerBatch > 0 ? packsPerBatch : 1;
  return Math.ceil(Math.round((packs / ppb) * 1e6) / 1e6);
}

/** The margin (packs) for orders that need `ordersBatches` batches on their own. */
export function marginPacksFor(ordersBatches: number, s: PlanMarginSettings = DEFAULT_PLAN_MARGIN): number {
  return ordersBatches > s.largeBatchThreshold ? s.largeMarginPacks : s.smallMarginPacks;
}

export interface MarginInput {
  /** Orders this plan's production has to cover (packs). */
  demandPacks: number;
  /** Packs already available for those orders before this plan makes any
   *  (stock at plan start, net of expiring packs and 8-pack bags). Default 0. */
  stockPacks?: number;
  packsPerBatch: number;
}

export interface MinBatches {
  /** Fewest whole batches that leave orders + margin covered. */
  batches: number;
  /** Batches the orders alone need (after stock, no margin) — decides the margin. */
  ordersBatches: number;
  marginPacks: number;
  /** Orders + margin (packs). 0 when there are no orders. */
  requiredPacks: number;
}

/**
 * The fewest batches so that stock + made ≥ orders + margin. No orders → no
 * batches and no margin (the margin protects orders; it never invents demand).
 *
 *   78 sold, 0 stock, 5 a batch → 17 batches (85 packs)
 *   32 sold → 7 (35)   25 sold → 6 (30)   28 sold → 6 (30, exactly 28 + 2)
 */
export function minBatchesForOrders(input: MarginInput, s: PlanMarginSettings = DEFAULT_PLAN_MARGIN): MinBatches {
  const demand = Math.max(0, Math.round(input.demandPacks || 0));
  if (demand <= 0) return { batches: 0, ordersBatches: 0, marginPacks: 0, requiredPacks: 0 };
  const stock = Math.max(0, Math.round(input.stockPacks ?? 0));
  const ordersBatches = batchesToCover(demand - stock, input.packsPerBatch);
  const marginPacks = marginPacksFor(ordersBatches, s);
  const requiredPacks = demand + marginPacks;
  return {
    batches: batchesToCover(requiredPacks - stock, input.packsPerBatch),
    ordersBatches,
    marginPacks,
    requiredPacks,
  };
}

export type MarginStatus = "no-orders" | "ok" | "under-margin" | "short";

export interface MarginCheck extends MinBatches {
  status: MarginStatus;
  demandPacks: number;
  stockPacks: number;
  plannedBatches: number;
  plannedPacks: number;
  /** stock + planned packs. */
  availablePacks: number;
  /** Packs missing to reach orders + margin (0 when fine). */
  missingPacks: number;
  /** Batches to add to reach orders + margin (0 when fine). */
  batchesToAdd: number;
}

/** How a planned batch count measures up against orders + margin. */
export function checkPlanMargin(
  input: MarginInput & { plannedBatches: number },
  s: PlanMarginSettings = DEFAULT_PLAN_MARGIN,
): MarginCheck {
  const min = minBatchesForOrders(input, s);
  const demandPacks = Math.max(0, Math.round(input.demandPacks || 0));
  const stockPacks = Math.max(0, Math.round(input.stockPacks ?? 0));
  const plannedBatches = Math.max(0, Math.round(input.plannedBatches || 0));
  const ppb = input.packsPerBatch > 0 ? input.packsPerBatch : 1;
  const plannedPacks = Math.round(plannedBatches * ppb * 1e6) / 1e6;
  const availablePacks = stockPacks + plannedPacks;
  const base = { ...min, demandPacks, stockPacks, plannedBatches, plannedPacks, availablePacks };
  if (demandPacks <= 0) return { ...base, status: "no-orders", missingPacks: 0, batchesToAdd: 0 };
  const missingPacks = Math.max(0, Math.ceil(min.requiredPacks - availablePacks));
  const status: MarginStatus = availablePacks < demandPacks ? "short" : missingPacks > 0 ? "under-margin" : "ok";
  return { ...base, status, missingPacks, batchesToAdd: Math.max(0, min.batches - plannedBatches) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The plain-English line shown on the recipe and in the save summary:
 *   "Orders need 32 packs + 2 margin = 34 — you're making 30. Add 1 batch?"
 * With stock already in the fridge the "making" part says where the packs
 * come from: "— 10 in stock + 20 made = 30."
 */
export function describeMarginCheck(c: MarginCheck): string {
  if (c.status === "no-orders" || c.status === "ok") return "";
  const have = c.stockPacks > 0
    ? `${c.stockPacks} in stock + ${c.plannedPacks} made = ${c.availablePacks}`
    : `you're making ${c.plannedPacks}`;
  const lead = c.status === "short"
    ? `Short by ${c.demandPacks - c.availablePacks}: orders need ${plural(c.demandPacks, "pack")}`
    : `Orders need ${plural(c.demandPacks, "pack")}`;
  return `${lead} + ${c.marginPacks} margin = ${c.requiredPacks} — ${have}. Add ${plural(c.batchesToAdd, "batch", "batches")}?`;
}

export interface MarginRowInput extends MarginInput {
  /** Stable row key (the screen's row id). */
  key: string;
  recipeName: string;
  included: boolean;
  plannedBatches: number;
}

export interface MarginWarning {
  key: string;
  recipeName: string;
  check: MarginCheck;
  message: string;
}

/** Every included recipe that is short or inside the margin — short first,
 *  then by name. Recipes with no known orders are never listed. */
export function buildMarginWarnings(rows: readonly MarginRowInput[], s: PlanMarginSettings = DEFAULT_PLAN_MARGIN): MarginWarning[] {
  const out: MarginWarning[] = [];
  for (const r of rows) {
    if (!r.included) continue;
    const check = checkPlanMargin(r, s);
    if (check.status !== "short" && check.status !== "under-margin") continue;
    out.push({ key: r.key, recipeName: r.recipeName, check, message: describeMarginCheck(check) });
  }
  return out.sort((a, b) =>
    (a.check.status === "short" ? 0 : 1) - (b.check.status === "short" ? 0 : 1)
    || a.recipeName.localeCompare(b.recipeName));
}

/** A fingerprint of the warning list, so "Save anyway" only covers the exact
 *  shortfalls the user saw — change a batch and they're asked again. */
export function marginWarningsSignature(ws: readonly MarginWarning[]): string {
  return ws.map(w => `${w.key}:${w.check.plannedBatches}:${w.check.requiredPacks}`).join("|");
}
