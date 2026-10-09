/**
 * Waste costing — loads what lib/waste-cost.ts needs from the existing
 * costing and Team efficiency, for the "Report defect / waste" form's live
 * cost, the saved snapshot, and each day's efficiency deduction
 * (Graeme, 2026-10-09; Objectives C and E).
 *
 *   - ingredient £/unit     ingredients.cost_per_pack ÷ pack_weight
 *   - sub-recipe £/unit     computeSubRecipeCosts (batch cost ÷ yield)
 *   - pack materials        computeCosts + packIngredientCostOf + packaging
 *   - pack lost value       Team efficiency settings (discount, 8-pack factor,
 *                           despatch share) through lineNetValue
 *   - hourly labour rate    team_efficiency_days over the last 28 days
 *
 * Read-only. No product, recipe or category names.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { computeSubRecipeCosts } from "../lib/sub-recipe-costs";
import { computeCosts, packIngredientCostOf } from "../routes/recipes";
import { londonDateString } from "../lib/london-time";
import { addDaysIso } from "../lib/team-efficiency-labour";
import {
  HOURLY_RATE_WINDOW_DAYS, defectPacksFor, hourlyLabourRate, ingredientWasteCost, packLabel, productLostValue,
  productMaterialCost, standardRemakeMinutes, subRecipeWasteCost, wasteSnapshot, wasteUnitsFor,
  type HourlyRate, type PackKind, type WasteItemKind, type WasteSnapshot,
} from "../lib/waste-cost";
import { loadSettings } from "./team-efficiency-job";

const num = (x: unknown) => Number(x) || 0;

// ── Hourly labour rate (cached — it moves once a night) ───────────────────

let rateCache: { at: number; day: string; value: HourlyRate | null } | null = null;
const RATE_CACHE_MS = 10 * 60_000;

export async function loadHourlyRate(): Promise<HourlyRate | null> {
  const today = londonDateString();
  if (rateCache && rateCache.day === today && Date.now() - rateCache.at < RATE_CACHE_MS) return rateCache.value;
  let value: HourlyRate | null = null;
  try {
    const r = await db.execute<{ date: string; status: string; labour_cost_total: string; paid_hours: string }>(sql`
      SELECT date::text AS date, status, labour_cost_total, paid_hours FROM team_efficiency_days
      WHERE date >= ${addDaysIso(today, -HOURLY_RATE_WINDOW_DAYS)} AND date < ${today}
    `);
    value = hourlyLabourRate(r.rows.map(x => ({
      date: x.date, status: x.status, labourCostTotal: num(x.labour_cost_total), paidHours: num(x.paid_hours),
    })));
  } catch (err) {
    // Table missing on a brand-new database: no rate, so time can't be priced.
    console.warn("[waste-costing] hourly rate unavailable:", err instanceof Error ? err.message : err);
  }
  rateCache = { at: Date.now(), day: today, value };
  return value;
}

// ── The searchable list of everything that can be wasted ──────────────────

export interface WasteCatalogueItem {
  /** "ingredient:12" | "sub_recipe:59" | "product:3" */
  key: string;
  kind: WasteItemKind;
  id: number;
  name: string;
  /** Category, shown small beside the name. */
  detail: string | null;
  /** Ingredients and sub-recipes: the units an amount may be entered in. */
  units: string[];
  /** Products: the packs it comes in. */
  packKinds: Array<{ kind: PackKind; label: string }>;
  standardPrepMinutes: number | null;
}

export async function loadWasteCatalogue(): Promise<WasteCatalogueItem[]> {
  const [ingredients, subRecipes, recipes] = await Promise.all([
    db.execute<{ id: number; name: string; unit: string; category: string | null }>(sql`
      SELECT id, name, unit, category FROM ingredients ORDER BY lower(name)
    `),
    db.execute<{ id: number; name: string; yield_unit: string; standard_prep_minutes: number | null }>(sql`
      SELECT id, name, yield_unit, standard_prep_minutes FROM sub_recipes ORDER BY lower(name)
    `),
    // Menu recipes only — not archived, not drafts (never made, never wasted).
    // An 8-pack bag is offered where the plans have ever recorded one.
    db.execute<{ id: number; name: string; category: string | null; pack_size: string; has_bags: boolean }>(sql`
      SELECT r.id, r.name, r.category, r.pack_size,
             EXISTS (SELECT 1 FROM production_plan_items i WHERE i.recipe_id = r.id
                     AND (COALESCE(i.fridge_eight_pack_qty, 0) + COALESCE(i.freezer_eight_pack_qty, 0)) > 0) AS has_bags
      FROM recipes r WHERE r.archived_at IS NULL AND r.is_draft = false ORDER BY lower(r.name)
    `),
  ]);
  const out: WasteCatalogueItem[] = [];
  for (const r of recipes.rows) {
    const packSize = num(r.pack_size);
    const packKinds: WasteCatalogueItem["packKinds"] = [{ kind: "pack", label: packLabel(packSize) }];
    if (r.has_bags && packSize > 0 && packSize <= 8) packKinds.push({ kind: "eight_pack_bag", label: "8-pack bag" });
    out.push({ key: `product:${r.id}`, kind: "product", id: r.id, name: r.name, detail: r.category || null, units: [], packKinds, standardPrepMinutes: null });
  }
  for (const s of subRecipes.rows) {
    out.push({
      key: `sub_recipe:${s.id}`, kind: "sub_recipe", id: s.id, name: s.name, detail: null,
      units: wasteUnitsFor(s.yield_unit), packKinds: [], standardPrepMinutes: s.standard_prep_minutes ?? null,
    });
  }
  for (const i of ingredients.rows) {
    out.push({
      key: `ingredient:${i.id}`, kind: "ingredient", id: i.id, name: i.name, detail: i.category || null,
      units: wasteUnitsFor(i.unit), packKinds: [], standardPrepMinutes: null,
    });
  }
  return out;
}

// ── Costing one entry ─────────────────────────────────────────────────────

export interface WasteItemInput {
  itemKind: WasteItemKind;
  itemId: number;
  packKind?: PackKind | null;
  quantity: number;
  quantityUnit: string;
  /** Omit/null to use the standard time (scaled), or 0 if there isn't one. */
  remakeMinutes?: number | null;
}

export interface WasteCosting {
  itemKind: WasteItemKind;
  itemName: string;
  ingredientId: number | null;
  subRecipeId: number | null;
  recipeId: number | null;
  packKind: PackKind | null;
  quantity: number;
  quantityUnit: string;
  /** Packs this adds to the Defects KPI (0 for ingredient/sub-recipe waste). */
  packs: number;
  /** Standard prep time scaled to the amount, when the item has one. */
  suggestedMinutes: number | null;
  snapshot: WasteSnapshot;
  hourly: HourlyRate | null;
}

export class WasteInputError extends Error {}

export async function costWaste(input: WasteItemInput): Promise<WasteCosting> {
  const { itemKind, itemId, quantity } = input;
  const unit = input.quantityUnit.trim();
  if (!(quantity > 0)) throw new WasteInputError("Enter how much was wasted");
  const hourlyP = loadHourlyRate();

  let itemName: string;
  let ingredientCost: number | null;
  let lostValue: number | null;
  let suggestedMinutes: number | null = null;
  let packKind: PackKind | null = null;
  let packs = 0;
  let quantityUnit = unit;

  if (itemKind === "ingredient") {
    const r = await db.execute<{ name: string; unit: string; cost_per_pack: string; pack_weight: string }>(sql`
      SELECT name, unit, cost_per_pack, pack_weight FROM ingredients WHERE id = ${itemId}
    `);
    const i = r.rows[0];
    if (!i) throw new WasteInputError("That ingredient doesn't exist");
    if (!wasteUnitsFor(i.unit).some(u => u.toLowerCase() === unit.toLowerCase())) throw new WasteInputError(`Enter ${i.name} in ${wasteUnitsFor(i.unit).join(" or ")}`);
    itemName = i.name;
    ingredientCost = ingredientWasteCost(quantity, unit, { unit: i.unit, costPerPack: num(i.cost_per_pack), packWeight: num(i.pack_weight) });
    lostValue = ingredientCost;
  } else if (itemKind === "sub_recipe") {
    const r = await db.execute<{ name: string; yield: string; yield_unit: string; standard_prep_minutes: number | null }>(sql`
      SELECT name, yield, yield_unit, standard_prep_minutes FROM sub_recipes WHERE id = ${itemId}
    `);
    const s = r.rows[0];
    if (!s) throw new WasteInputError("That sub-recipe doesn't exist");
    if (!wasteUnitsFor(s.yield_unit).some(u => u.toLowerCase() === unit.toLowerCase())) throw new WasteInputError(`Enter ${s.name} in ${wasteUnitsFor(s.yield_unit).join(" or ")}`);
    const costs = await computeSubRecipeCosts([itemId]);
    const basis = {
      yieldUnit: s.yield_unit, batchYield: num(s.yield), costPerYieldUnit: costs[itemId] ?? 0,
      standardPrepMinutes: s.standard_prep_minutes ?? null,
    };
    itemName = s.name;
    ingredientCost = subRecipeWasteCost(quantity, unit, basis);
    lostValue = ingredientCost;
    suggestedMinutes = standardRemakeMinutes(quantity, unit, basis);
  } else {
    const r = await db.execute<{ name: string; category: string | null; pack_size: string; rrp: string; servings: string; packaging_cost: string }>(sql`
      SELECT name, category, pack_size, rrp, servings, packaging_cost FROM recipes WHERE id = ${itemId}
    `);
    const p = r.rows[0];
    if (!p) throw new WasteInputError("That product doesn't exist");
    packKind = input.packKind ?? "pack";
    if (!Number.isInteger(quantity)) throw new WasteInputError("Packs are whole numbers");
    const packSize = num(p.pack_size);
    const [raw, settings] = await Promise.all([computeCosts([itemId]), loadSettings()]);
    const basis = {
      packSize, rrp: num(p.rrp), category: p.category || null,
      ingredientCostPerPack: packIngredientCostOf(raw[itemId] ?? 0, num(p.servings), packSize),
      packagingCostPerPack: num(p.packaging_cost),
    };
    itemName = p.name;
    quantityUnit = packKind === "eight_pack_bag" ? "bag" : "pack";
    ingredientCost = productMaterialCost(quantity, packKind, basis);
    lostValue = productLostValue(quantity, packKind, basis, settings);
    packs = defectPacksFor("product", quantity, packKind, packSize);
  }

  const hourly = await hourlyP;
  const remakeMinutes = input.remakeMinutes ?? suggestedMinutes ?? 0;
  return {
    itemKind,
    itemName,
    ingredientId: itemKind === "ingredient" ? itemId : null,
    subRecipeId: itemKind === "sub_recipe" ? itemId : null,
    recipeId: itemKind === "product" ? itemId : null,
    packKind,
    quantity,
    quantityUnit,
    packs,
    suggestedMinutes,
    snapshot: wasteSnapshot({ ingredientCost, lostValue, remakeMinutes, hourlyRate: hourly?.rate ?? null }),
    hourly,
  };
}
