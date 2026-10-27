/**
 * Prep times and batch profit — the founder-only read report (Graeme,
 * 27 Oct 2026; Objectives C and I; GET /api/prep-times/report, no screen).
 * Loads the prep sessions the prep screens recorded (routes/prep-
 * sessions.ts), the recipes and their costings, the building stations'
 * measured pace and the labour settings, and hands them to the pure, tested
 * maths:
 *   lib/prep-timing.ts      clean durations, per-item rates and confidence
 *   lib/prep-usage.ts       how much of each prep item a batch uses
 *   lib/prep-batch-cost.ts  prep and line minutes, gross, crew-weighted
 *                           labour, profit after both, profit per line-minute
 * The recipe costings are the recipe page's own (routes/recipes.ts
 * computeCosts + packIngredientCostOf), and the build pace the Recipes
 * page's (services/build-time-history.ts) — not new copies.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { effectivePackSize } from "@workspace/units";
import { packsPerBatch } from "@workspace/production-schedule";
import { computeCosts, packIngredientCostOf } from "../routes/recipes";
import { londonDateString } from "../lib/london-time";
import { isMozzarellaLike } from "../lib/stock-usage-rules";
import {
  cleanSessions, summariseItem,
  type CleanSession, type Confidence, type ExcludedReason, type ItemTiming, type TimingBreak, type TimingSession,
} from "../lib/prep-timing";
import {
  prepItemKey, prepUsagePerBatch,
  type PrepItemKind, type UsageIngredient, type UsageRecipe, type UsageSubRecipe,
} from "../lib/prep-usage";
import {
  LABOUR_SETTING_KEYS, batchProfit, lineMinutesPerBatch, parseLabourSettings, recipePrepMinutes,
  type LabourSettings, type LineStatus,
} from "../lib/prep-batch-cost";
import { BUILD_HISTORY_DAYS, loadBuildSuggestions } from "./build-time-history";

/** How far back the report looks: recent enough to reflect how prep is done now. */
export const REPORT_WINDOW_DAYS = 90;
/** Production days of timings before the figures are worth acting on
 *  (about 2–3 weeks of normal production). */
export const ENOUGH_DAYS = 10;

/** The Raw Meat station's routing key (ingredients.category), as Main Prep
 *  and /prep-requirements-by-recipe route raw meat. */
const RAW_MEAT_CATEGORY = "raw_meat";
/** Ingredients of this category are made into dough on the dough station,
 *  never a prep tin (Main Prep and Bases & Sauces both leave them out). */
const DOUGH_CATEGORY = "dough";

export interface PrepTimesItem {
  itemKey: string;
  kind: PrepItemKind;
  id: number;
  name: string;
  sessions: number;
  /** Null when the item has no timed session (only quick or unopened completions). */
  medianMinutes: number | null;
  q1Minutes: number | null;
  q3Minutes: number | null;
  minutesPerKg: number | null;
  minutesPerCount: number | null;
  countUnit: string | null;
  rateSessions: number;
  trimmed: number;
  confidence: Confidence;
  days: number;
  people: number;
  usedByRecipes: number;
  /** Completions inside 30 s — kept as ticks, never averaged (likely ready-made or check-only). */
  quickCompletions: number;
  /** Completions made with nothing opened (flag-and-allow). */
  unopenedCompletions: number;
}

export interface PrepTimesRecipeLine {
  itemKey: string;
  name: string;
  minutes: number | null;
  status: LineStatus;
  confidence: Confidence | null;
  grams: number | null;
  count: number | null;
  countUnit: string | null;
}

export interface PrepTimesRecipe {
  recipeId: number;
  name: string;
  category: string | null;
  isDraft: boolean;
  onMenu: boolean;
  packsPerBatch: number;
  rrp: number;
  costPerPack: number;
  /** Gross £ per batch: (list price − cost per pack incl. packaging) × packs. */
  gross: number;
  /** Line minutes per batch (one builder's build ÷ builders), and where the
   *  build time came from: measured on the floor, the recipe's target, or none. */
  lineMinutes: number | null;
  lineTimeSource: "measured" | "target" | null;
  /** Batches behind a measured build time. */
  lineTimeSamples: number | null;
  lineLabour: number | null;
  /** Prep minutes per batch from the items timed so far. */
  prepMinutes: number;
  prepLabour: number;
  profitAfterLabour: number;
  profitPerLineMinute: number | null;
  labourShareOfGross: number | null;
  /** How far to trust the prep minutes, and how many prep items are timed. */
  prepConfidence: Confidence | null;
  timedItems: number;
  totalItems: number;
  lines: PrepTimesRecipeLine[];
}

export interface PrepTimesReport {
  windowDays: number;
  /** The labour settings used, and which of them are still the defaults. */
  labour: LabourSettings & { defaulted: Array<keyof LabourSettings>; settingKeys: Record<keyof LabourSettings, string> };
  /** Days of building-station history behind a measured line time. */
  buildHistoryDays: number;
  data: {
    sessionsCounted: number;
    sessionsIgnored: Record<ExcludedReason, number>;
    days: number;
    enoughDays: number;
    collecting: boolean;
    firstDay: string | null;
    lastDay: string | null;
    people: number;
  };
  items: PrepTimesItem[];
  recipes: PrepTimesRecipe[];
}

const num = (v: unknown): number => Number(v ?? 0) || 0;
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const londonDay = (ms: number) => londonDateString(new Date(ms));

/** The labour settings from app_settings, each defaulting when unset. */
export async function loadLabourSettings(): Promise<{ settings: LabourSettings; defaulted: Array<keyof LabourSettings> }> {
  const keys = Object.values(LABOUR_SETTING_KEYS);
  const r = await db.execute<{ key: string; value: string }>(sql`
    SELECT key, value FROM app_settings WHERE key IN (${sql.join(keys.map(k => sql`${k}`), sql`, `)})
  `);
  const byKey = new Map(r.rows.map(row => [row.key, row.value]));
  const stored: Partial<Record<keyof LabourSettings, string | undefined>> = {};
  for (const [field, key] of Object.entries(LABOUR_SETTING_KEYS) as Array<[keyof LabourSettings, string]>) {
    stored[field] = byKey.get(key);
  }
  return parseLabourSettings(stored);
}

async function loadSessions(): Promise<{ sessions: TimingSession[]; breaks: TimingBreak[] }> {
  const window = sql`NOW() - make_interval(days => ${REPORT_WINDOW_DAYS})`;
  const [sessionRows, completionRows, breakRows] = await Promise.all([
    db.execute<{ id: number; user_id: number | null; ingredient_id: number | null; sub_recipe_id: number | null; opened_ms: number; closed_ms: number | null; flag: string | null; pauses: Array<{ from: number; to: number }> | null }>(sql`
      SELECT id, user_id, ingredient_id, sub_recipe_id,
             (EXTRACT(EPOCH FROM opened_at) * 1000)::float8 AS opened_ms,
             (EXTRACT(EPOCH FROM closed_at) * 1000)::float8 AS closed_ms, flag, pauses
        FROM prep_sessions
       WHERE opened_at >= ${window}
    `),
    // The completions are the record of what was done (an undone tick took
    // its row with it), so the session's latest completion is read from here.
    db.execute<{ session_id: number; quantity: string | null; quantity_unit: string | null; at_ms: number }>(sql`
      SELECT c.session_id, c.quantity, c.quantity_unit,
             (EXTRACT(EPOCH FROM c.completed_at) * 1000)::float8 AS at_ms
        FROM prep_session_completions c
        JOIN prep_sessions s ON s.id = c.session_id
       WHERE s.opened_at >= ${window}
    `),
    db.execute<{ user_id: number; from_ms: number; to_ms: number | null }>(sql`
      SELECT user_id,
             (EXTRACT(EPOCH FROM started_at) * 1000)::float8 AS from_ms,
             (EXTRACT(EPOCH FROM ended_at) * 1000)::float8 AS to_ms
        FROM station_breaks
       WHERE user_id IS NOT NULL AND started_at >= ${window} - interval '1 day'
    `),
  ]);
  const completions = new Map<number, Array<{ quantity: number | null; unit: string | null; at: number }>>();
  for (const c of completionRows.rows) {
    const list = completions.get(c.session_id) ?? [];
    list.push({ quantity: numOrNull(c.quantity), unit: c.quantity_unit, at: Number(c.at_ms) });
    completions.set(c.session_id, list);
  }
  const sessions: TimingSession[] = sessionRows.rows.map(s => {
    const done = completions.get(s.id) ?? [];
    return {
      id: s.id,
      userId: s.user_id,
      itemKey: s.ingredient_id != null ? prepItemKey("ingredient", s.ingredient_id) : prepItemKey("sub_recipe", s.sub_recipe_id!),
      openedAt: Number(s.opened_ms),
      closedAt: s.closed_ms == null ? null : Number(s.closed_ms),
      flag: s.flag,
      completedAt: done.length > 0 ? Math.max(...done.map(d => d.at)) : null,
      pauses: Array.isArray(s.pauses) ? s.pauses.map(p => ({ from: Number(p.from), to: Number(p.to) })) : [],
      amounts: done.map(d => ({ quantity: d.quantity, unit: d.unit })),
    };
  });
  const breaks: TimingBreak[] = breakRows.rows.map(b => ({
    userId: b.user_id, from: Number(b.from_ms), to: b.to_ms == null ? null : Number(b.to_ms),
  }));
  return { sessions, breaks };
}

type RecipeRow = {
  id: number; name: string; category: string | null; servings: string; portions_per_batch: number;
  pack_size: string | null; rrp: string; packaging_cost: string; is_draft: boolean; is_core_menu: boolean; is_current_special: boolean;
  target_build_seconds: number | null;
};

async function loadRecipeGraph() {
  const [recipes, recipeIngs, recipeSubs, ingredients, subRecipes, subIngs, subSubs] = await Promise.all([
    db.execute<RecipeRow>(sql`
      SELECT id, name, category, servings, portions_per_batch, pack_size, rrp, packaging_cost,
             is_draft, is_core_menu, is_current_special, target_build_seconds
        FROM recipes WHERE archived_at IS NULL ORDER BY name
    `),
    db.execute<{ recipe_id: number; ingredient_id: number; quantity: string; is_topping: boolean; marinade_for_ingredient_id: number | null; include_in_filling_mix: boolean }>(sql`
      SELECT recipe_id, ingredient_id, quantity, is_topping, marinade_for_ingredient_id, include_in_filling_mix FROM recipe_ingredients
    `),
    db.execute<{ recipe_id: number; sub_recipe_id: number; quantity: string; is_topping: boolean; marinade_for_ingredient_id: number | null }>(sql`
      SELECT recipe_id, sub_recipe_id, quantity, is_topping, marinade_for_ingredient_id FROM recipe_sub_recipes
    `),
    db.execute<{ id: number; name: string; unit: string; category: string | null; processing_ratio: string | null; prep_weight_mode: string | null; prep_count_per_portion: number | null }>(sql`
      SELECT id, name, unit, category, processing_ratio, prep_weight_mode, prep_count_per_portion FROM ingredients
    `),
    db.execute<{ id: number; name: string; yield: string; yield_unit: string; expand_in_prep: boolean }>(sql`
      SELECT id, name, yield, yield_unit, expand_in_prep FROM sub_recipes
    `),
    db.execute<{ sub_recipe_id: number; ingredient_id: number; quantity: string; hide_from_prep: boolean; marinade_for_ingredient_id: number | null }>(sql`
      SELECT sub_recipe_id, ingredient_id, quantity, hide_from_prep, marinade_for_ingredient_id FROM sub_recipe_ingredients
    `),
    db.execute<{ sub_recipe_id: number; component_sub_recipe_id: number; quantity: string; marinade_for_ingredient_id: number | null }>(sql`
      SELECT sub_recipe_id, component_sub_recipe_id, quantity, marinade_for_ingredient_id FROM sub_recipe_sub_recipes
    `),
  ]);

  const ingredientMap = new Map<number, UsageIngredient>(ingredients.rows.map(i => [i.id, {
    id: i.id, name: i.name, unit: i.unit, category: i.category,
    processingRatio: numOrNull(i.processing_ratio), prepWeightMode: i.prep_weight_mode,
    prepCountPerPortion: i.prep_count_per_portion,
  }]));
  const subMap = new Map<number, UsageSubRecipe>(subRecipes.rows.map(s => [s.id, {
    id: s.id, name: s.name, yield: num(s.yield), yieldUnit: s.yield_unit, expandInPrep: s.expand_in_prep,
    ingredients: [], subRecipes: [],
  }]));
  for (const l of subIngs.rows) subMap.get(l.sub_recipe_id)?.ingredients.push({
    ingredientId: l.ingredient_id, quantity: num(l.quantity), hideFromPrep: l.hide_from_prep, marinadeForIngredientId: l.marinade_for_ingredient_id,
  });
  for (const l of subSubs.rows) subMap.get(l.sub_recipe_id)?.subRecipes.push({
    subRecipeId: l.component_sub_recipe_id, quantity: num(l.quantity), marinadeForIngredientId: l.marinade_for_ingredient_id,
  });
  const usageRecipes = new Map<number, UsageRecipe>(recipes.rows.map(r => [r.id, {
    id: r.id, portionsPerBatch: num(r.portions_per_batch), ingredients: [], subRecipes: [],
  }]));
  for (const l of recipeIngs.rows) usageRecipes.get(l.recipe_id)?.ingredients.push({
    ingredientId: l.ingredient_id, quantity: num(l.quantity), isTopping: l.is_topping,
    marinadeForIngredientId: l.marinade_for_ingredient_id, includeInFillingMix: l.include_in_filling_mix,
  });
  for (const l of recipeSubs.rows) usageRecipes.get(l.recipe_id)?.subRecipes.push({
    subRecipeId: l.sub_recipe_id, quantity: num(l.quantity), isTopping: l.is_topping, marinadeForIngredientId: l.marinade_for_ingredient_id,
  });
  return { recipes: recipes.rows, usageRecipes, ingredientMap, subMap };
}

export async function buildPrepTimesReport(): Promise<PrepTimesReport> {
  const [{ sessions, breaks }, graph, labour, measuredBuild] = await Promise.all([
    loadSessions(),
    loadRecipeGraph(),
    loadLabourSettings(),
    loadBuildSuggestions(new Date(Date.now() - BUILD_HISTORY_DAYS * 86_400_000)),
  ]);
  const settings = labour.settings;
  const { clean, excluded, quickCompletionsByItem, unopenedByItem } = cleanSessions(sessions, breaks);

  const byItem = new Map<string, CleanSession[]>();
  for (const c of clean) {
    const list = byItem.get(c.itemKey) ?? [];
    list.push(c);
    byItem.set(c.itemKey, list);
  }
  const timings = new Map<string, ItemTiming>();
  // Items with only quick or unopened completions still get an entry.
  for (const key of [...quickCompletionsByItem.keys(), ...unopenedByItem.keys()]) if (!byItem.has(key)) byItem.set(key, []);
  for (const [key, list] of byItem) {
    const t = summariseItem(key, list, londonDay, {
      quickCompletions: quickCompletionsByItem.get(key) ?? 0,
      unopenedCompletions: unopenedByItem.get(key) ?? 0,
    });
    if (t) timings.set(key, t);
  }

  const nameOf = (key: string): string => {
    const [kind, idText] = key.split(":");
    const id = Number(idText);
    return (kind === "ingredient" ? graph.ingredientMap.get(id)?.name : graph.subMap.get(id)?.name) ?? `${kind === "ingredient" ? "Ingredient" : "Sub-recipe"} #${id}`;
  };

  // Prep usage per batch for every recipe — the same rules the prep screens
  // route by: nothing of the dough category, and mozzarella only when it's
  // in the filling mix (stock-usage-rules' isMozzarellaLike, the screens'
  // own rule).
  const usageByRecipe = new Map(graph.recipes.map(r => [r.id, prepUsagePerBatch(
    graph.usageRecipes.get(r.id)!,
    graph.ingredientMap,
    graph.subMap,
    {
      notPrepped: (ing, line) => ing.category === DOUGH_CATEGORY || (isMozzarellaLike(ing.name) && !line.includeInFillingMix),
      preppedWithMeat: ing => ing.category === RAW_MEAT_CATEGORY,
    },
  )]));
  const usedBy = new Map<string, number>();
  for (const usage of usageByRecipe.values()) for (const u of usage) usedBy.set(u.itemKey, (usedBy.get(u.itemKey) ?? 0) + 1);

  const costs = await computeCosts(graph.recipes.map(r => r.id));
  const recipes: PrepTimesRecipe[] = graph.recipes.map(r => {
    const packSize = effectivePackSize(r.pack_size);
    const packs = packsPerBatch(r.portions_per_batch, packSize);
    const packIngredientCost = packIngredientCostOf(costs[r.id] ?? 0, num(r.servings), packSize);
    const packagingCost = num(r.packaging_cost);
    const usage = usageByRecipe.get(r.id) ?? [];
    const prep = recipePrepMinutes(usage, timings);
    // Line time: the floor's measured build pace when there's enough of it,
    // else the recipe's target build time (both one builder's seconds).
    const measured = measuredBuild.get(r.id) ?? null;
    const buildSeconds = measured?.value ?? (r.target_build_seconds != null && r.target_build_seconds > 0 ? r.target_build_seconds : null);
    const lineMinutes = lineMinutesPerBatch(buildSeconds, settings.lineBuilders);
    const money = batchProfit(
      { rrp: num(r.rrp), packIngredientCost, packagingCost, packsPerBatch: packs },
      { prep: prep.minutes, line: lineMinutes },
      settings,
    );
    const usageByKey = new Map(usage.map(u => [u.itemKey, u]));
    return {
      recipeId: r.id,
      name: r.name,
      category: r.category,
      isDraft: r.is_draft,
      onMenu: r.is_core_menu || r.is_current_special,
      packsPerBatch: packs,
      rrp: num(r.rrp),
      costPerPack: packIngredientCost + packagingCost,
      gross: money.gross,
      lineMinutes,
      lineTimeSource: lineMinutes == null ? null : measured ? "measured" : "target",
      lineTimeSamples: measured?.samples ?? null,
      lineLabour: money.lineLabour,
      prepMinutes: prep.minutes,
      prepLabour: money.prepLabour,
      profitAfterLabour: money.profitAfterLabour,
      profitPerLineMinute: money.profitPerLineMinute,
      labourShareOfGross: money.labourShareOfGross,
      prepConfidence: prep.confidence,
      timedItems: prep.timedItems,
      totalItems: prep.totalItems,
      lines: prep.lines
        .map(l => {
          const u = usageByKey.get(l.itemKey);
          return {
            itemKey: l.itemKey, name: nameOf(l.itemKey), minutes: l.minutes, status: l.status, confidence: l.confidence,
            grams: u?.grams ?? null, count: u?.count ?? null, countUnit: u?.countUnit ?? null,
          };
        })
        .sort((a, b) => (b.minutes ?? -1) - (a.minutes ?? -1) || a.name.localeCompare(b.name)),
    };
  });

  const items: PrepTimesItem[] = [...timings.values()].map(t => {
    const [kind, idText] = t.itemKey.split(":");
    return {
      itemKey: t.itemKey,
      kind: kind as PrepItemKind,
      id: Number(idText),
      name: nameOf(t.itemKey),
      sessions: t.sessions,
      medianMinutes: t.minutes?.median ?? null,
      q1Minutes: t.minutes?.q1 ?? null,
      q3Minutes: t.minutes?.q3 ?? null,
      minutesPerKg: t.rate.minutesPerKg,
      minutesPerCount: t.rate.minutesPerCount,
      countUnit: t.rate.countUnit,
      rateSessions: t.rate.rateSessions,
      trimmed: t.rate.trimmed,
      confidence: t.confidence,
      days: t.days,
      people: t.people,
      usedByRecipes: usedBy.get(t.itemKey) ?? 0,
      quickCompletions: t.quickCompletions,
      unopenedCompletions: t.unopenedCompletions,
    };
  }).sort((a, b) => (b.medianMinutes ?? -1) - (a.medianMinutes ?? -1) || a.name.localeCompare(b.name));

  const days = [...new Set(clean.map(c => londonDay(c.completedAt)))].sort();
  return {
    windowDays: REPORT_WINDOW_DAYS,
    labour: { ...settings, defaulted: labour.defaulted, settingKeys: { ...LABOUR_SETTING_KEYS } },
    buildHistoryDays: BUILD_HISTORY_DAYS,
    data: {
      sessionsCounted: clean.length,
      sessionsIgnored: excluded,
      days: days.length,
      enoughDays: ENOUGH_DAYS,
      collecting: days.length < ENOUGH_DAYS,
      firstDay: days[0] ?? null,
      lastDay: days[days.length - 1] ?? null,
      people: new Set(clean.map(c => c.userId).filter(u => u != null)).size,
    },
    items,
    recipes,
  };
}
