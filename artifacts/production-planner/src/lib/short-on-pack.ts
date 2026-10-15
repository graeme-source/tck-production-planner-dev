/**
 * Short on the pack (Graeme, 15 Oct 2026).
 *
 * "When we don't have enough in the fridge at the end of today to satisfy
 * tomorrow's orders, we need to tell the team — and suggest the order of
 * production for the NEXT plan: slow meat can only go in at 6:00 in the
 * morning, and we always do the veggies before the meats."
 *
 * Three pure pieces, shared by the Short on the pack screen
 * (pages/short-on-the-pack.tsx) and its tests:
 *
 *   1. shortOnPackReport — per recipe, packs we'll have at close of play
 *      today vs packs ordered for the next pack day. "Have" is the server's
 *      predictedFridgeStock from GET /production-plans/calculate, i.e.
 *      @workspace/stock-prediction planStartStock().endOfToday (fridge + still
 *      to wrap − still to dispatch today); "ordered" is the same "left to
 *      dispatch" figure the Pack Report uses (dispatch2RemainingQty, falling
 *      back to dispatch2Qty). No second stock formula.
 *   2. suggestProductionOrder — the next plan's building order under the
 *      kitchen's rules, timed by the shared day-schedule engine
 *      (@workspace/production-schedule) so start times match the stations.
 *   3. shortOnPackMessage — the pre-written team message.
 *
 * Nothing here names a product: veg comes from the recipe's dietary category
 * and its raw-meat ingredients, slow meat from the ingredient cook time
 * (@workspace/slow-meat threshold), kitchens from lib/kitchen-scope.
 */
import {
  computeScheduleFromSlots, kitchenLine, formatClock,
  type ScheduleBreakInput, type ScheduleRecipeInput, type ScheduleSlot,
} from "@workspace/production-schedule";

// ── 0. Which plan ────────────────────────────────────────────────────────────

/**
 * The plan for the next pack day. A date can carry more than one plan (a
 * half-made draft beside the real one — 16 Oct 2026 had both), so the real
 * one wins: any non-draft plan, the newest if there are several. A draft is
 * only used when it's all there is, and the screen says so.
 */
export function pickNextPlan<P extends { id: number; status: string }>(plans: readonly P[]): P | null {
  const real = plans.filter(p => p.status !== "draft");
  const pool = real.length > 0 ? real : plans;
  return pool.reduce<P | null>((best, p) => (best == null || p.id > best.id ? p : best), null);
}

// ── 1. The report ────────────────────────────────────────────────────────────

/** The fields of a GET /production-plans/calculate recipe row this reads. */
export interface PackCalcRow {
  recipeId: number;
  recipeName: string;
  recipeCategory?: string | null;
  isCoreMenu?: boolean;
  packsPerBatch: number;
  packSize?: number | string | null;
  fridgeStock: number;
  /** End of today: planStartStock().endOfToday, computed server-side. */
  predictedFridgeStock: number;
  /** Shopify on-hand for freezer-stocked lines; null for fridge lines. */
  shopifyStock?: number | null;
  remainingWrappingPacksToday?: number;
  dispatch2Qty: number;
  dispatch2RemainingQty?: number;
}

/** One line of the next plan, in its current order. */
export interface NextPlanItem {
  itemId: number;
  recipeId: number;
  recipeName: string;
  recipeCategory: string | null;
  batchesTarget: number;
  eightPackBagCount?: number | null;
  status?: string;
}

/** Packs a plan line puts in the 2-pack fridge: batches × packs per batch,
 *  less what goes into 8-pack bags (a bag = 8 portions). The Pack Report's
 *  production column uses this too. */
export function plannedPacksNetOfBags(
  batchesTarget: number | null | undefined,
  packsPerBatch: number,
  packSize: number | string | null | undefined,
  eightPackBags: number | null | undefined,
): number {
  const size = Number(packSize);
  const bagEquiv = size > 0 ? 8 / size : 4;
  return Math.max(0, Math.round((batchesTarget ?? 0) * packsPerBatch - (eightPackBags ?? 0) * bagEquiv));
}

export interface ShortLine {
  recipeId: number;
  recipeName: string;
  /** "mac" lines are counted in packs and run on their own station. */
  line: "calzone" | "mac";
  /** Packs we'll have at close of play today. */
  haveEndOfToday: number;
  /** Packs ordered for the next pack day (still to go out). */
  ordered: number;
  shortBy: number;
  /** Batches that shortage is (rounded up); null for pack-counted lines. */
  batchesShort: number | null;
  /** Packs the next plan makes of it; null when it isn't on the plan. */
  plannedPacks: number | null;
  /** Packs still short even after the next plan's make (0 = covered). */
  shortAfterMake: number;
}

export interface ShortOnPackReport {
  lines: ShortLine[];
  totalShortPacks: number;
}

/**
 * Which recipes are short on the next pack, most short first.
 *
 * Scope is the Pack Report's rows, main kitchen only (the fried chicken
 * facility isn't on this plan's order): everything on the next plan plus
 * every core recipe.
 */
export function shortOnPackReport(calcRows: readonly PackCalcRow[], planItems: readonly NextPlanItem[]): ShortOnPackReport {
  const planned = new Map<number, number>();
  for (const it of planItems) {
    const row = calcRows.find(r => r.recipeId === it.recipeId);
    const isMac = kitchenLine(it.recipeCategory) === "mac";
    const ppb = row?.packsPerBatch ?? (isMac ? 1 : null);
    if (ppb == null) continue;
    planned.set(it.recipeId, (planned.get(it.recipeId) ?? 0) + plannedPacksNetOfBags(it.batchesTarget, ppb, row?.packSize, it.eightPackBagCount));
  }
  const lines: ShortLine[] = [];
  for (const r of calcRows) {
    const line = kitchenLine(r.recipeCategory);
    if (line === "separate") continue;
    if (!planned.has(r.recipeId) && !r.isCoreMenu) continue;
    const have = r.shopifyStock != null
      ? Math.round(r.shopifyStock + (r.remainingWrappingPacksToday ?? 0))
      : Math.round(r.predictedFridgeStock);
    const ordered = Math.round(r.dispatch2RemainingQty ?? r.dispatch2Qty);
    const shortBy = ordered - have;
    if (shortBy <= 0) continue;
    const plannedPacks = planned.has(r.recipeId) ? planned.get(r.recipeId)! : null;
    lines.push({
      recipeId: r.recipeId,
      recipeName: r.recipeName.trim(),
      line,
      haveEndOfToday: have,
      ordered,
      shortBy,
      batchesShort: r.packsPerBatch > 1 ? Math.ceil(shortBy / r.packsPerBatch) : null,
      plannedPacks,
      shortAfterMake: Math.max(0, shortBy - (plannedPacks ?? 0)),
    });
  }
  lines.sort((a, b) => b.shortBy - a.shortBy || a.recipeName.localeCompare(b.recipeName));
  return { lines, totalShortPacks: lines.reduce((s, l) => s + l.shortBy, 0) };
}

// ── 2. The suggested order ───────────────────────────────────────────────────

/** "Slow meat can only go in at 6:00 in the morning." */
export const DEFAULT_SLOW_MEAT_EARLIEST_IN_MINUTES = 6 * 60;

export type RecipeKind = "veg" | "meat" | "slow_meat";

/**
 * Veg / meat / slow meat from data only. Any slow raw meat (cook time at or
 * over the slow-meat threshold) → slow_meat. Any other raw meat → meat.
 * No raw meat: the recipe's dietary category decides — "vegetarian" is veg;
 * "meat" (cured/cooked meats) or unset is kept with the meats, because
 * putting a meat recipe among the veg breaks the rule and the reverse doesn't.
 */
export function classifyRecipe(
  dietaryCategory: string | null | undefined,
  rawMeatIds: readonly number[],
  slowMeatIds: ReadonlySet<number>,
): { kind: RecipeKind; unmarked: boolean } {
  if (rawMeatIds.some(id => slowMeatIds.has(id))) return { kind: "slow_meat", unmarked: false };
  if (rawMeatIds.length > 0) return { kind: "meat", unmarked: false };
  if (dietaryCategory === "vegetarian") return { kind: "veg", unmarked: false };
  return { kind: "meat", unmarked: dietaryCategory !== "meat" };
}

/**
 * Earliest the line can BUILD a recipe: every slow meat it uses goes in at
 * the earliest-in time and needs its full lead (cook + process, as the
 * schedule carries it). Null = no slow meat, no constraint.
 */
export function meatReadyMinutes(
  recipe: Pick<ScheduleRecipeInput, "meats">,
  slowMeatIds: ReadonlySet<number>,
  earliestInMinutes: number = DEFAULT_SLOW_MEAT_EARLIEST_IN_MINUTES,
): number | null {
  let ready: number | null = null;
  for (const m of recipe.meats ?? []) {
    if (!slowMeatIds.has(m.rawMeatIngredientId)) continue;
    const r = earliestInMinutes + m.processMinutes;
    ready = ready == null ? r : Math.max(ready, r);
  }
  return ready;
}

export interface OrderInputs {
  /** The next plan's lines in their current order (mac first, as shown). */
  items: readonly NextPlanItem[];
  /** The schedule's engine inputs (GET /production-plans/:id/schedule
   *  `recipes`) — the calzone building line only. */
  timeline: readonly ScheduleRecipeInput[];
  options: { startMinutes: number; buildersCount: number; changeoverSeconds: number };
  breaks: readonly ScheduleBreakInput[];
  dietaryByRecipe: ReadonlyMap<number, string | null>;
  slowMeatIds: ReadonlySet<number>;
  shortByRecipe: ReadonlyMap<number, number>;
  earliestInMinutes?: number;
}

export interface OrderRow {
  itemId: number;
  recipeId: number;
  recipeName: string;
  /** "building" = the calzone line; "mac" = its own station; "other" = not
   *  on the building line (no batches, another kitchen). */
  station: "building" | "mac" | "other";
  kind: RecipeKind | null;
  shortBy: number;
  /** Predicted build start/finish ("HH:MM"); null off the building line. */
  start: string | null;
  finish: string | null;
  /** When its slow meat is ready ("HH:MM"), if it has any. */
  meatReady: string | null;
  /** Minutes the line stands waiting for this recipe's meat. */
  waitMinutes: number;
  reason: string;
}

export interface OrderPlan {
  rows: OrderRow[];
  /** Minutes the building line stands waiting for meat, in total. */
  totalWaitMinutes: number;
  /** When building finishes ("HH:MM"), waits included. */
  finish: string | null;
}

export interface OrderSuggestion {
  current: OrderPlan;
  suggested: OrderPlan;
  changed: boolean;
  /** Body for PATCH /production-plans/:id/order (the drag-to-reorder endpoint). */
  order: Array<{ itemId: number; orderPosition: number }>;
}

interface LineRecipe {
  item: NextPlanItem;
  index: number;
  engine: ScheduleRecipeInput;
  kind: RecipeKind;
  unmarked: boolean;
  shortBy: number;
  ready: number | null;
}

interface Placed { lr: LineRecipe; wait: number }

/**
 * Walk the building line in a chosen order on the shared schedule engine.
 * `choose` picks the next recipe given the clock it would start at; when the
 * chosen recipe's slow meat isn't ready yet the line waits (an idle slot on
 * the timeline). Breaks drop in by anchor time, as computeDaySchedule does.
 */
function walkLine(
  recipes: LineRecipe[],
  inputs: OrderInputs,
  choose: (remaining: LineRecipe[], startAt: number) => LineRecipe,
): { placed: Placed[]; times: Map<number, { start: number; finish: number }>; end: number } {
  const options = { ...inputs.options, breaks: [] };
  const pending = [...inputs.breaks].sort((a, b) => a.anchorMinutes - b.anchorMinutes);
  const changeover = Math.max(0, inputs.options.changeoverSeconds) / 60;
  const slots: ScheduleSlot[] = [];
  const placed: Placed[] = [];
  const remaining = [...recipes];
  let recipeCount = 0;
  while (remaining.length > 0) {
    const end = computeScheduleFromSlots(slots, options).endMinutes;
    const clockBefore = end + (recipeCount > 0 ? changeover : 0);
    while (pending.length > 0 && pending[0].anchorMinutes <= clockBefore) {
      slots.push({ kind: "break", break: pending.shift()! });
    }
    const startAt = computeScheduleFromSlots(slots, options).endMinutes + (recipeCount > 0 ? changeover : 0);
    const next = choose(remaining, startAt);
    remaining.splice(remaining.indexOf(next), 1);
    const wait = next.ready != null && next.ready > startAt ? Math.round(next.ready - startAt) : 0;
    if (wait > 0) {
      slots.push({ kind: "break", break: { id: `wait-${next.item.itemId}`, label: "Waiting for slow meat", minutes: wait, anchorMinutes: startAt } });
    }
    slots.push({ kind: "recipe", recipe: next.engine });
    placed.push({ lr: next, wait });
    recipeCount += 1;
  }
  // Breaks anchored after the last recipe don't change any start time.
  const schedule = computeScheduleFromSlots(slots, options);
  const times = new Map(schedule.recipes.map(r => [r.planItemId, { start: r.startMinutes, finish: r.finishMinutes }]));
  return { placed, times, end: schedule.endMinutes };
}

const byShortThenOrder = (a: LineRecipe, b: LineRecipe) => b.shortBy - a.shortBy || a.index - b.index;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The kitchen's rules, in order:
 *   1. Veg before meat — always. Among the veg, most short first.
 *   2. A recipe with slow meat can't be built before that meat is ready
 *      (in at the earliest-in time + its cook and process lead).
 *   3. Among whatever CAN go next, most short first; ties keep today's order.
 *      If nothing can go, the soonest-ready slow meat goes and the line waits.
 * Mac & cheese runs on its own station: its lines keep their places in the
 * list, most short first among themselves. Anything else off the building
 * line (no batches, another kitchen) stays exactly where it is.
 */
export function suggestProductionOrder(inputs: OrderInputs): OrderSuggestion {
  const earliest = inputs.earliestInMinutes ?? DEFAULT_SLOW_MEAT_EARLIEST_IN_MINUTES;
  const engineById = new Map(inputs.timeline.map(r => [r.planItemId, r]));
  const shortOf = (recipeId: number) => Math.max(0, inputs.shortByRecipe.get(recipeId) ?? 0);

  // Done lines (only possible if this is run mid-day) keep their slot, as the
  // reorder endpoint insists.
  const isFixed = (it: NextPlanItem) => it.status === "complete";
  const lineRecipes: LineRecipe[] = [];
  inputs.items.forEach((item, index) => {
    const engine = engineById.get(item.itemId);
    if (!engine || isFixed(item)) return;
    const meatIds = [...(engine.meats ?? []).map(m => m.rawMeatIngredientId), ...(engine.untimedMeats ?? []).map(m => m.rawMeatIngredientId)];
    const { kind, unmarked } = classifyRecipe(inputs.dietaryByRecipe.get(item.recipeId), meatIds, inputs.slowMeatIds);
    lineRecipes.push({
      item, index, engine, kind, unmarked,
      shortBy: shortOf(item.recipeId),
      ready: meatReadyMinutes(engine, inputs.slowMeatIds, earliest),
    });
  });
  const lineIds = new Set(lineRecipes.map(r => r.item.itemId));

  // Current order, walked as-is (waiting wherever its meat isn't ready).
  const currentWalk = walkLine(lineRecipes, inputs, remaining => remaining.reduce((a, b) => (b.index < a.index ? b : a)));

  // Suggested order.
  const suggestedWalk = walkLine(lineRecipes, inputs, (remaining, startAt) => {
    const veg = remaining.filter(r => r.kind === "veg");
    if (veg.length > 0) return [...veg].sort(byShortThenOrder)[0];
    const ready = remaining.filter(r => r.ready == null || r.ready <= startAt);
    if (ready.length > 0) return [...ready].sort(byShortThenOrder)[0];
    return [...remaining].sort((a, b) => (a.ready! - b.ready!) || byShortThenOrder(a, b))[0];
  });

  // Mac lines: most short first within their own slots.
  const macItems = inputs.items.filter(it => kitchenLine(it.recipeCategory) === "mac" && !isFixed(it));
  const macIds = new Set(macItems.map(it => it.itemId));
  const indexOf = new Map(inputs.items.map((it, i) => [it.itemId, i]));
  const macSorted = [...macItems].sort((a, b) => shortOf(b.recipeId) - shortOf(a.recipeId) || indexOf.get(a.itemId)! - indexOf.get(b.itemId)!);

  const buildPlan = (walk: ReturnType<typeof walkLine>, macOrder: NextPlanItem[], reasonFor: (p: Placed, laterSlowReady: number | null, startAt: number) => string): OrderPlan => {
    const lineQueue = [...walk.placed];
    const macQueue = [...macOrder];
    const rows: OrderRow[] = [];
    const placedPos = new Map(walk.placed.map((p, i) => [p.lr.item.itemId, i]));
    for (const it of inputs.items) {
      if (lineIds.has(it.itemId)) {
        const p = lineQueue.shift()!;
        const t = walk.times.get(p.lr.item.itemId)!;
        const later = walk.placed.slice(placedPos.get(p.lr.item.itemId)! + 1)
          .filter(q => q.lr.kind === "slow_meat" && q.lr.ready != null)
          .map(q => q.lr.ready!);
        rows.push({
          itemId: p.lr.item.itemId,
          recipeId: p.lr.item.recipeId,
          recipeName: p.lr.item.recipeName.trim(),
          station: "building",
          kind: p.lr.kind,
          shortBy: p.lr.shortBy,
          start: formatClock(t.start),
          finish: formatClock(t.finish),
          meatReady: p.lr.ready != null ? formatClock(p.lr.ready) : null,
          waitMinutes: p.wait,
          reason: reasonFor(p, later.length ? Math.min(...later) : null, t.start),
        });
      } else if (macIds.has(it.itemId)) {
        const m = macQueue.shift()!;
        const short = shortOf(m.recipeId);
        rows.push({
          itemId: m.itemId, recipeId: m.recipeId, recipeName: m.recipeName.trim(), station: "mac", kind: null,
          shortBy: short, start: null, finish: null, meatReady: null, waitMinutes: 0,
          reason: short > 0 ? `Mac & Cheese station · short by ${plural(short, "pack")}` : "Mac & Cheese station",
        });
      } else {
        rows.push({
          itemId: it.itemId, recipeId: it.recipeId, recipeName: it.recipeName.trim(), station: "other", kind: null,
          shortBy: shortOf(it.recipeId), start: null, finish: null, meatReady: null, waitMinutes: 0,
          reason: isFixed(it) ? "Done — stays where it is" : "Not on the building line — stays where it is",
        });
      }
    }
    return {
      rows,
      totalWaitMinutes: walk.placed.reduce((s, p) => s + p.wait, 0),
      finish: walk.placed.length ? formatClock(walk.end) : null,
    };
  };

  const describe = (p: Placed, laterSlowReady: number | null, startAt: number): string => {
    const { lr, wait } = p;
    const short = lr.shortBy > 0 ? `short by ${plural(lr.shortBy, "pack")}` : null;
    const waitTxt = wait > 0 ? ` · line waits ${wait} min` : "";
    if (lr.kind === "veg") return short ? `Veg · ${short} — veg goes first` : "Veg — before the meats";
    if (lr.kind === "slow_meat") {
      return `Slow meat ready ~${formatClock(lr.ready!)}${short ? ` · ${short}` : ""}${waitTxt}`;
    }
    const unmarked = lr.unmarked ? " (not marked vegetarian)" : "";
    if (short) return `Meat · ${short} — as early as the rules allow${unmarked}`;
    if (laterSlowReady != null && laterSlowReady > startAt) return `Meat — goes while the slow meat cooks${unmarked}`;
    return `Meat — not short${unmarked}`;
  };
  const describeCurrent = (p: Placed): string => {
    const { lr, wait } = p;
    const parts: string[] = [lr.kind === "veg" ? "Veg" : lr.kind === "slow_meat" ? `Slow meat ready ~${formatClock(lr.ready!)}` : "Meat"];
    if (lr.shortBy > 0) parts.push(`short by ${plural(lr.shortBy, "pack")}`);
    if (wait > 0) parts.push(`line waits ${wait} min for its meat`);
    return parts.join(" · ");
  };

  const current = buildPlan(currentWalk, macItems, describeCurrent);
  const suggested = buildPlan(suggestedWalk, macSorted, describe);
  const changed = suggested.rows.some((r, i) => r.itemId !== inputs.items[i].itemId);
  return {
    current,
    suggested,
    changed,
    order: suggested.rows.map((r, i) => ({ itemId: r.itemId, orderPosition: i + 1 })),
  };
}

// ── 3. The message ───────────────────────────────────────────────────────────

/**
 * The team message. `dayName` is "tomorrow" or a weekday ("Monday") — the
 * next pack day, as lib/pack-day names it. The "I've reordered" part is only
 * there once the reorder has actually been saved (`reorderedTo`).
 */
export function shortOnPackMessage(input: {
  dayName: string;
  lines: readonly ShortLine[];
  /** The plan's order after a confirmed reorder, as recipe names. */
  reorderedTo?: readonly string[] | null;
}): string {
  const opener = input.dayName.toLowerCase() === "tomorrow"
    ? "Tomorrow we're short on the pack:"
    : `On ${input.dayName} we're short on the pack:`;
  const out = [opener];
  for (const l of input.lines) {
    const batches = l.batchesShort != null ? ` (${plural(l.batchesShort, "batch", "batches")})` : "";
    const notOnPlan = l.plannedPacks == null ? " — not on the plan" : "";
    out.push(`• ${l.recipeName} — short ${plural(l.shortBy, "pack")}${batches}${notOnPlan}`);
  }
  if (input.reorderedTo && input.reorderedTo.length > 0) {
    out.push("", "I've reordered the production plan based on this:");
    input.reorderedTo.forEach((name, i) => out.push(`${i + 1}. ${name}`));
  }
  return out.join("\n");
}
