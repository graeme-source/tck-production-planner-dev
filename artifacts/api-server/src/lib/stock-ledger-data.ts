/**
 * Gathers the running-stock ledger's events from what the app already
 * records — read-only, nothing is written (docs/RUNNING_STOCK.md). The sums
 * live in lib/stock-ledger.ts; which recipe line is used where, and how much
 * a tin or a batch holds, in lib/stock-usage-rules.ts (shared with the
 * Orders page's still-to-prep).
 *
 * Per ingredient, freezer locations excluded — the same scope the Orders
 * page has always read (each ingredient lives in one chilled/dry location;
 * only one stock-checked ingredient has rows in two).
 *
 *   counts   — stock_entries ingredient rows typed by a person (any note
 *              except the system ones, see isSystemStockNote) and
 *              daily_stock_checks rows; the two copies of one prep-station
 *              count collapse into one (mergeCounts).
 *   receipts — stock_entries rows written by goods-in ("Delivery from PO",
 *              "Undo delivery") and transfers: the row's level minus the
 *              level before it at that location = what moved.
 *   usage    — prep tins ticked; mixing and building batch completions;
 *              sub-recipe ingredients estimated from the batches that use
 *              them; waste recorded against an ingredient.
 */
import { db, FREEZER_LOCATIONS } from "@workspace/db";
import { sql } from "drizzle-orm";
import { convertQuantity } from "@workspace/units";
import { resolveSubRecipeIngredients, type ResolvedIngredient } from "./ingredient-resolver";
import { createMixExtrasCache } from "./mix-extra-loader";
import { mixExtraFor, type MixExtras } from "./mix-extra";
import {
  builtBatchFraction,
  directLineChannel,
  lineRawQtyForItem,
  subRecipeLineChannel,
  tinCountForLine,
  type DirectLineChannel,
} from "./stock-usage-rules";
import {
  isSystemStockNote,
  type CountEvent,
  type IngredientLedger,
  type ReceiptEvent,
  type UsageCoverage,
  type UsageEvent,
} from "./stock-ledger";

export interface LedgerIngredient {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  stockCheckEnabled: boolean;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
  kanbanEnabled: boolean;
  packWeight: number | null;
}

export interface LoadedLedger {
  ingredient: LedgerIngredient;
  ledger: IngredientLedger;
}

const ms = (v: unknown): number => new Date(v as string).getTime();
const idList = (ids: number[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

interface DirectLine {
  lineId: number;
  ingredientId: number;
  quantity: number;
  includeInFillingMix: boolean;
  isTopping: boolean;
  marinadeFor: number | null;
  category: string | null;
  name: string | null;
  ratio: number | null;
}

interface SubLine {
  lineId: number;
  subRecipeId: number;
  quantity: number;
  includeInFillingMix: boolean;
}

interface RecipeShape {
  portionsPerBatch: number;
  packSize: number;
  direct: DirectLine[];
  subs: SubLine[];
  mixExtras: MixExtras;
}

/** Channel of a direct line; a marinade line follows its meat. */
function lineChannel(line: DirectLine, shape: RecipeShape): DirectLineChannel {
  const info = (l: DirectLine) => ({
    isTopping: l.isTopping, includeInFillingMix: l.includeInFillingMix, category: l.category, ingredientName: l.name,
  });
  if (line.marinadeFor != null) {
    const parent = shape.direct.find(p => p.ingredientId === line.marinadeFor && p.marinadeFor == null);
    return parent ? directLineChannel(info(parent)) : directLineChannel(info(line));
  }
  return directLineChannel(info(line));
}

async function loadRecipeShapes(recipeIds: number[]): Promise<Map<number, RecipeShape>> {
  const shapes = new Map<number, RecipeShape>();
  if (recipeIds.length === 0) return shapes;
  const list = idList(recipeIds);
  const recipes = await db.execute(sql`
    SELECT id, COALESCE(portions_per_batch, 10) AS portions, COALESCE(pack_size, 1)::float8 AS pack_size
    FROM recipes WHERE id IN (${list})
  `);
  const direct = await db.execute(sql`
    SELECT ri.id AS line_id, ri.recipe_id, ri.ingredient_id, ri.quantity::float8 AS quantity,
           ri.include_in_filling_mix, ri.is_topping, ri.marinade_for_ingredient_id,
           i.category, i.name, i.processing_ratio::float8 AS ratio
    FROM recipe_ingredients ri LEFT JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id IN (${list})
  `);
  const subs = await db.execute(sql`
    SELECT id AS line_id, recipe_id, sub_recipe_id, quantity::float8 AS quantity, include_in_filling_mix
    FROM recipe_sub_recipes WHERE recipe_id IN (${list})
  `);
  const mixCache = createMixExtrasCache();
  for (const r of recipes.rows as any[]) {
    shapes.set(Number(r.id), {
      portionsPerBatch: Number(r.portions) || 10,
      packSize: Number(r.pack_size) || 1,
      direct: [],
      subs: [],
      mixExtras: await mixCache(Number(r.id)),
    });
  }
  for (const d of direct.rows as any[]) {
    shapes.get(Number(d.recipe_id))?.direct.push({
      lineId: Number(d.line_id),
      ingredientId: Number(d.ingredient_id),
      quantity: Number(d.quantity) || 0,
      includeInFillingMix: !!d.include_in_filling_mix,
      isTopping: !!d.is_topping,
      marinadeFor: d.marinade_for_ingredient_id != null ? Number(d.marinade_for_ingredient_id) : null,
      category: d.category ?? null,
      name: d.name ?? null,
      ratio: d.ratio != null ? Number(d.ratio) : null,
    });
  }
  for (const s of subs.rows as any[]) {
    shapes.get(Number(s.recipe_id))?.subs.push({
      lineId: Number(s.line_id),
      subRecipeId: Number(s.sub_recipe_id),
      quantity: Number(s.quantity) || 0,
      includeInFillingMix: !!s.include_in_filling_mix,
    });
  }
  return shapes;
}

/** Which ingredients any live recipe uses directly, and which only (or
 *  also) inside a sub-recipe — decides each ingredient's coverage. */
async function loadCoverage(): Promise<Map<number, UsageCoverage>> {
  const res = await db.execute(sql`
    WITH RECURSIVE live AS (
      SELECT id FROM recipes WHERE archived_at IS NULL AND NOT is_draft
    ), subs AS (
      SELECT rsr.sub_recipe_id AS sid FROM recipe_sub_recipes rsr JOIN live ON live.id = rsr.recipe_id
      UNION
      SELECT ssr.component_sub_recipe_id FROM sub_recipe_sub_recipes ssr JOIN subs ON subs.sid = ssr.sub_recipe_id
    )
    SELECT ri.ingredient_id, 'direct' AS how FROM recipe_ingredients ri JOIN live ON live.id = ri.recipe_id
    UNION
    SELECT si.ingredient_id, 'sub' FROM sub_recipe_ingredients si JOIN subs ON subs.sid = si.sub_recipe_id
  `);
  const out = new Map<number, UsageCoverage>();
  for (const r of res.rows as Array<{ ingredient_id: number; how: string }>) {
    const id = Number(r.ingredient_id);
    if (r.how === "sub") out.set(id, "estimated");
    else if (!out.has(id)) out.set(id, "tracked");
  }
  return out;
}

export async function loadStockLedgers(opts: {
  /** Earliest event to read. Counts before it aren't seen, so pass a date
   *  before the counts you need as starting points. */
  since: Date;
  until?: Date;
  /** Default: every stock-checked or kanban ingredient. */
  ingredientIds?: number[];
}): Promise<Map<number, LoadedLedger>> {
  const until = opts.until ?? new Date();
  const sinceIso = opts.since.toISOString();
  const untilIso = until.toISOString();

  const ingRes = opts.ingredientIds
    ? (opts.ingredientIds.length === 0 ? { rows: [] } : await db.execute(sql`
        SELECT id, name, unit, category, stock_check_enabled, stock_check_frequency, stock_check_day,
               kanban_enabled, pack_weight::float8 AS pack_weight
        FROM ingredients WHERE id IN (${idList(opts.ingredientIds)})`))
    : await db.execute(sql`
        SELECT id, name, unit, category, stock_check_enabled, stock_check_frequency, stock_check_day,
               kanban_enabled, pack_weight::float8 AS pack_weight
        FROM ingredients WHERE stock_check_enabled OR kanban_enabled`);

  const coverage = await loadCoverage();
  const out = new Map<number, LoadedLedger>();
  for (const r of ingRes.rows as any[]) {
    const id = Number(r.id);
    out.set(id, {
      ingredient: {
        id,
        name: r.name,
        unit: r.unit ?? "kg",
        category: r.category ?? null,
        stockCheckEnabled: !!r.stock_check_enabled,
        stockCheckFrequency: r.stock_check_frequency ?? "daily",
        stockCheckDay: r.stock_check_day ?? null,
        kanbanEnabled: !!r.kanban_enabled,
        packWeight: r.pack_weight != null ? Number(r.pack_weight) : null,
      },
      ledger: { counts: [], receipts: [], usage: [], coverage: coverage.get(id) ?? "untracked" },
    });
  }
  const ids = [...out.keys()];
  if (ids.length === 0) return out;
  const list = idList(ids);
  const freezers = sql.join(FREEZER_LOCATIONS.map(l => sql`${l}`), sql`, `);

  /** A quantity in the row's unit → the ingredient's own unit (null when
   *  there's no honest conversion, e.g. "each" → kg). */
  const toNative = (iid: number, qty: number, unit: string | null): number | null => {
    const ing = out.get(iid)!.ingredient;
    if (!unit || unit === ing.unit) return qty;
    if (unit === "pack" || unit === "packs") return ing.packWeight ? qty * ing.packWeight : null;
    return convertQuantity(qty, unit, ing.unit);
  };

  // ── Counts and goods-in movements (stock_entries) ──────────────────────
  const stockRes = await db.execute(sql`
    SELECT ingredient_id, quantity::float8 AS qty, prev::float8 AS prev, unit, notes, checked_at FROM (
      SELECT ingredient_id, location, quantity, unit, notes, checked_at,
             LAG(quantity) OVER (PARTITION BY ingredient_id, location ORDER BY checked_at, id) AS prev
      FROM stock_entries
      WHERE item_type = 'ingredient' AND ingredient_id IN (${list})
    ) t
    WHERE checked_at >= ${sinceIso}::timestamptz AND checked_at <= ${untilIso}::timestamptz
      AND location NOT IN (${freezers})
  `);
  for (const r of stockRes.rows as any[]) {
    const iid = Number(r.ingredient_id);
    const entry = out.get(iid);
    if (!entry) continue;
    const at = ms(r.checked_at);
    if (isSystemStockNote(r.notes)) {
      const delta = toNative(iid, Number(r.qty) - (Number(r.prev) || 0), r.unit);
      if (delta != null && delta !== 0) entry.ledger.receipts.push({ at, qty: delta } satisfies ReceiptEvent);
    } else {
      const qty = toNative(iid, Number(r.qty), r.unit);
      if (qty != null) entry.ledger.counts.push({ at, qty } satisfies CountEvent);
    }
  }
  const checksRes = await db.execute(sql`
    SELECT ingredient_id, quantity::float8 AS qty, checked_at FROM daily_stock_checks
    WHERE ingredient_id IN (${list}) AND quantity IS NOT NULL
      AND checked_at >= ${sinceIso}::timestamptz AND checked_at <= ${untilIso}::timestamptz
  `);
  for (const r of checksRes.rows as any[]) {
    out.get(Number(r.ingredient_id))?.ledger.counts.push({ at: ms(r.checked_at), qty: Number(r.qty) });
  }

  const addUsage = (iid: number, ev: UsageEvent) => {
    if (!(ev.qty > 0)) return;
    out.get(iid)?.ledger.usage.push(ev);
  };

  // ── Prep tins ticked ───────────────────────────────────────────────────
  // A tin ticked under several sub-recipe origins counts once, at its first
  // tick — the dedupe outstanding-prep uses.
  const ticksRes = await db.execute(sql`
    SELECT plan_id, recipe_id, ingredient_id, tin_number, MIN(completed_at) AS completed_at
    FROM prep_completions
    WHERE ingredient_id IS NOT NULL
    GROUP BY plan_id, recipe_id, ingredient_id, tin_number
    HAVING MIN(completed_at) >= ${sinceIso}::timestamptz AND MIN(completed_at) <= ${untilIso}::timestamptz
  `);
  const ticks = ticksRes.rows as Array<{ plan_id: number; recipe_id: number; ingredient_id: number; tin_number: number; completed_at: string }>;

  const batchRes = await db.execute(sql`
    SELECT bc.station_type, bc.completed_at, bc.partial_packs, pi.plan_id, pi.recipe_id, pi.batches_target
    FROM batch_completions bc
    JOIN production_plan_items pi ON pi.id = bc.plan_item_id
    WHERE bc.station_type IN ('mixing', 'building_1', 'building_2', 'fried_chicken')
      AND pi.recipe_id IS NOT NULL
      AND bc.completed_at >= ${sinceIso}::timestamptz AND bc.completed_at <= ${untilIso}::timestamptz
  `);
  const batches = batchRes.rows as Array<{ station_type: string; completed_at: string; partial_packs: number | null; plan_id: number; recipe_id: number; batches_target: number }>;

  const recipeIds = [...new Set([...ticks.map(t => Number(t.recipe_id)), ...batches.map(b => Number(b.recipe_id))])];
  const shapes = await loadRecipeShapes(recipeIds);

  const planIds = [...new Set(ticks.map(t => Number(t.plan_id)))];
  const planItems = new Map<string, { batches: number; maxPerTin: number | null; mixingTinOverride: number | null }>();
  const tinOverrides = new Map<string, number>();
  if (planIds.length > 0) {
    const pl = idList(planIds);
    const itemsRes = await db.execute(sql`
      SELECT plan_id, recipe_id, batches_target, max_batches_per_tin, mixing_tin_override
      FROM production_plan_items WHERE plan_id IN (${pl}) AND recipe_id IS NOT NULL ORDER BY id
    `);
    for (const it of itemsRes.rows as any[]) {
      const key = `${it.plan_id}_${it.recipe_id}`;
      if (planItems.has(key)) continue;
      planItems.set(key, {
        batches: Number(it.batches_target) || 0,
        maxPerTin: it.max_batches_per_tin ?? null,
        mixingTinOverride: it.mixing_tin_override ?? null,
      });
    }
    const ovRes = await db.execute(sql`
      SELECT plan_id, recipe_id, ingredient_id, tin_count FROM prep_tin_overrides
      WHERE plan_id IN (${pl}) AND ingredient_id IS NOT NULL
    `);
    for (const o of ovRes.rows as any[]) tinOverrides.set(`${o.plan_id}_${o.recipe_id}_${o.ingredient_id}`, Number(o.tin_count));
  }

  for (const t of ticks) {
    const shape = shapes.get(Number(t.recipe_id));
    const item = planItems.get(`${t.plan_id}_${t.recipe_id}`);
    if (!shape || !item || item.batches <= 0) continue;
    const at = ms(t.completed_at);
    // The ticked ingredient's own prep line(s): only lines prep weighs into
    // tins, never a marinade line (a marinade follows its meat, below).
    for (const line of shape.direct) {
      if (line.ingredientId !== Number(t.ingredient_id) || line.marinadeFor != null) continue;
      if (lineChannel(line, shape) !== "prep") continue;
      const tinCount = tinCountForLine({
        batchesTarget: item.batches,
        maxBatchesPerTin: item.maxPerTin,
        includeInFillingMix: line.includeInFillingMix,
        mixingTinOverride: item.mixingTinOverride,
        tinOverride: tinOverrides.get(`${t.plan_id}_${t.recipe_id}_${line.ingredientId}`) ?? null,
      });
      // Same tins outstanding-prep counts (1…tinCount).
      if (tinCount <= 0 || Number(t.tin_number) > tinCount || Number(t.tin_number) < 1) continue;
      const lineQty = (l: DirectLine) => lineRawQtyForItem({
        quantityPerPortion: l.quantity,
        portionsPerBatch: shape.portionsPerBatch,
        batches: item.batches,
        mixExtra: mixExtraFor(shape.mixExtras, "ingredient", l.lineId),
        processingRatio: l.ratio,
      });
      addUsage(line.ingredientId, { at, qty: lineQty(line) / tinCount, source: "prep", planId: Number(t.plan_id) });
      // Its marinade goes with each tin of meat.
      for (const m of shape.direct) {
        if (m.marinadeFor !== line.ingredientId) continue;
        addUsage(m.ingredientId, { at, qty: lineQty(m) / tinCount, source: "prep", planId: Number(t.plan_id) });
      }
    }
  }

  // ── Mixing and building batches ────────────────────────────────────────
  const subCache = new Map<number, Promise<ResolvedIngredient[]>>();
  const subPerUnit = (sid: number) => {
    let p = subCache.get(sid);
    if (!p) { p = resolveSubRecipeIngredients(sid, 1, new Set()); subCache.set(sid, p); }
    return p;
  };
  for (const b of batches) {
    const shape = shapes.get(Number(b.recipe_id));
    if (!shape) continue;
    const at = ms(b.completed_at);
    const planId = Number(b.plan_id);
    const station: "mixing" | "build" = b.station_type === "mixing" ? "mixing" : "build";
    const fraction = station === "mixing" ? 1 : builtBatchFraction(b.partial_packs, shape.portionsPerBatch, shape.packSize);
    const batchesTarget = Math.max(1, Number(b.batches_target) || 1);
    const extraPerBatch = (kind: "ingredient" | "subRecipe", lineId: number) =>
      mixExtraFor(shape.mixExtras, kind, lineId) / batchesTarget;

    for (const line of shape.direct) {
      if (lineChannel(line, shape) !== station) continue;
      const qty = lineRawQtyForItem({
        quantityPerPortion: line.quantity,
        portionsPerBatch: shape.portionsPerBatch,
        batches: 1,
        mixExtra: extraPerBatch("ingredient", line.lineId),
        processingRatio: line.ratio,
      }) * fraction;
      addUsage(line.ingredientId, { at, qty, source: station, planId });
    }
    for (const s of shape.subs) {
      if (subRecipeLineChannel(s.includeInFillingMix) !== station) continue;
      const subQtyPerBatch = (s.quantity * shape.portionsPerBatch + extraPerBatch("subRecipe", s.lineId)) * fraction;
      if (!(subQtyPerBatch > 0)) continue;
      for (const comp of await subPerUnit(s.subRecipeId)) {
        if (!out.has(comp.ingredientId)) continue;
        const cooked = comp.quantityPerBatch * subQtyPerBatch;
        const ratio = Number(comp.processingRatio) || 1;
        addUsage(comp.ingredientId, { at, qty: ratio > 0 ? cooked / ratio : cooked, source: "subRecipe", planId });
      }
    }
  }

  // ── Waste recorded against an ingredient ──────────────────────────────
  const wasteRes = await db.execute(sql`
    SELECT ingredient_id, quantity::float8 AS qty, quantity_unit, created_at FROM defects
    WHERE deleted_at IS NULL AND item_kind = 'ingredient' AND ingredient_id IN (${list})
      AND quantity > 0
      AND created_at >= ${sinceIso}::timestamptz AND created_at <= ${untilIso}::timestamptz
  `);
  for (const w of wasteRes.rows as any[]) {
    const iid = Number(w.ingredient_id);
    const qty = toNative(iid, Number(w.qty), w.quantity_unit ?? null);
    if (qty != null) addUsage(iid, { at: ms(w.created_at), qty, source: "waste", planId: null });
  }

  return out;
}
