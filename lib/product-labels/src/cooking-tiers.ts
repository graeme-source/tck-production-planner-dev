/**
 * Suggested customer cooking times by weight (pure, tested) — so Graeme
 * doesn't have to think about every recipe (2026-10-12).
 *
 * A part-baked calzone reheated from chilled heats from the outside in, so
 * the time it needs grows with how much there is to heat (weight per
 * calzone) and with dense, cold meat in the middle. Recipes are sorted into
 * a few TIERS; each tier has its own oven and air-fryer times. The tiers,
 * their limits and their times are DATA in the label template
 * (`cookingTiers`, edited on Label design & type) — nothing here knows a
 * recipe or product name.
 *
 * The rule, in one line: a recipe goes in the FIRST tier (lightest first)
 * whose limits it is within — at most `maxWeightG` per calzone and at most
 * `maxMeatG` of meat per calzone (blank = no limit). One that fits none goes
 * in the last (heaviest) tier.
 *
 * Hard cap (Graeme, 2026-10-12): Chicken & Chorizo's 18–22 min oven / 16–19
 * min air fryer is the longest cook we'd ever print. `maxOvenMinutes` and
 * `maxAirFryerMinutes` clamp every suggested time, and a label whose times
 * go over them can't go live (content.ts).
 *
 * Weight per calzone comes from the recipe: every component per portion
 * (recipe quantities are per calzone), marinades left out (they cook into
 * the meat). A component that is mostly (over half, by weight) ingredients in
 * the template's "dough" categories is the dough; everything else is
 * filling, split into meat / veg / cheese by ingredient category — through
 * sub-recipes to any depth, by the share of each category in what the
 * sub-recipe is made from.
 */
import type { CookingValues } from "./template";

export type CookingClass = "meat" | "veg" | "cheese" | "dough";
export const COOKING_CLASSES: CookingClass[] = ["meat", "veg", "cheese", "dough"];
export const COOKING_CLASS_LABEL: Record<CookingClass, string> = {
  meat: "Meat", veg: "Vegetables", cheese: "Cheese & dairy", dough: "Dough",
};

export interface CookingTier {
  /** Stable id (kept when renamed). */
  key: string;
  /** e.g. "Light" — shown in the settings and the reason line. */
  name: string;
  /** At most this many grams per calzone (dough + filling). Null = no limit. */
  maxWeightG: number | null;
  /** At most this many grams of meat per calzone. Null = no limit. */
  maxMeatG: number | null;
  /** The tier's times. A blank value uses the template's standard one
   *  (so a tier can leave the temperatures to the template). */
  cooking: CookingValues;
}

export interface CookingTiersConfig {
  /** Off = every recipe uses the template's standard times (or its own manual
   *  ones) — the suggestions are shown but not printed. Off until a manager
   *  switches it on, so nothing on any label changes by itself. */
  on: boolean;
  /** Lightest first. */
  tiers: CookingTier[];
  /** The longest cook ever printed, in minutes. Null = no cap. */
  maxOvenMinutes: number | null;
  maxAirFryerMinutes: number | null;
  /** Which ingredient categories (ingredients.category) count as each class. */
  categories: Record<CookingClass, string[]>;
}

const blankCooking = (c: Partial<CookingValues>): CookingValues => ({
  ovenTempC: null, fanTempC: null, ovenMinMinutes: null, ovenMaxMinutes: null,
  airFryerTempC: null, airFryerMinMinutes: null, airFryerMaxMinutes: null, ...c,
});

/** Graeme's anchors (2026-10-12): Light = Garlic Cheese's hand-set times;
 *  Heavy = the standard (Chicken & Chorizo, Carnizone, The Don) and the cap;
 *  Medium halfway, matching the website's 16–19 for Chorizo Chilli. Oven
 *  temperatures are left to the template (200 °C / 180 °C fan). */
export const DEFAULT_COOKING_TIERS: CookingTiersConfig = {
  on: false,
  tiers: [
    { key: "light", name: "Light", maxWeightG: 260, maxMeatG: 20,
      cooking: blankCooking({ ovenMinMinutes: 14, ovenMaxMinutes: 16, airFryerTempC: 165, airFryerMinMinutes: 12, airFryerMaxMinutes: 15 }) },
    { key: "medium", name: "Medium", maxWeightG: 330, maxMeatG: 45,
      cooking: blankCooking({ ovenMinMinutes: 16, ovenMaxMinutes: 19, airFryerMinMinutes: 14, airFryerMaxMinutes: 17 }) },
    { key: "heavy", name: "Heavy", maxWeightG: null, maxMeatG: null,
      cooking: blankCooking({ ovenMinMinutes: 18, ovenMaxMinutes: 22, airFryerMinMinutes: 16, airFryerMaxMinutes: 19 }) },
  ],
  maxOvenMinutes: 22,
  maxAirFryerMinutes: 19,
  categories: {
    meat: ["raw_meat", "cooked_meat"],
    veg: ["vegetable"],
    cheese: ["cheese", "dairy"],
    dough: ["dough"],
  },
};

export const MAX_COOKING_TIERS = 6;

// ── Normalising ────────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
function wholeOrNull(v: unknown, lo: number, hi: number): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
}
function words(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return [...fallback];
  const out: string[] = [];
  for (const w of v) {
    if (typeof w !== "string") continue;
    const t = w.trim().slice(0, 60);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 30);
}

/** Clamp a range to the cap: neither end above it, min never above max. */
function capRange(min: number | null, max: number | null, cap: number | null): [number | null, number | null] {
  const c = (n: number | null) => (n != null && cap != null ? Math.min(n, cap) : n);
  const lo = c(min);
  const hi = c(max);
  return [lo != null && hi != null && lo > hi ? hi : lo, hi];
}

/** Times clamped to the config's cap (blank values stay blank). */
export function capCooking(c: CookingValues, cfg: Pick<CookingTiersConfig, "maxOvenMinutes" | "maxAirFryerMinutes">): CookingValues {
  const [oMin, oMax] = capRange(c.ovenMinMinutes, c.ovenMaxMinutes, cfg.maxOvenMinutes);
  const [aMin, aMax] = capRange(c.airFryerMinMinutes, c.airFryerMaxMinutes, cfg.maxAirFryerMinutes);
  return { ...c, ovenMinMinutes: oMin, ovenMaxMinutes: oMax, airFryerMinMinutes: aMin, airFryerMaxMinutes: aMax };
}

/** Stored JSON → a safe config. Missing (every template saved before this
 *  existed) = the defaults, switched OFF. */
export function normaliseCookingTiers(raw: unknown): CookingTiersConfig {
  const D = DEFAULT_COOKING_TIERS;
  const r = obj(raw);
  const maxOvenMinutes = "maxOvenMinutes" in r ? wholeOrNull(r.maxOvenMinutes, 1, 240) : D.maxOvenMinutes;
  const maxAirFryerMinutes = "maxAirFryerMinutes" in r ? wholeOrNull(r.maxAirFryerMinutes, 1, 240) : D.maxAirFryerMinutes;
  const cats = obj(r.categories);
  const categories = {} as Record<CookingClass, string[]>;
  for (const k of COOKING_CLASSES) categories[k] = words(cats[k], D.categories[k]);
  const rawTiers = Array.isArray(r.tiers) && r.tiers.length > 0 ? r.tiers : D.tiers;
  const seen = new Set<string>();
  const tiers = rawTiers.slice(0, MAX_COOKING_TIERS).map((t, i): CookingTier => {
    const o = obj(t);
    const c = obj(o.cooking);
    let key = typeof o.key === "string" && o.key.trim() ? o.key.trim().slice(0, 40) : `tier-${i + 1}`;
    while (seen.has(key)) key = `${key}-${i + 1}`;
    seen.add(key);
    const cooking = blankCooking({});
    for (const k of Object.keys(cooking) as (keyof CookingValues)[]) cooking[k] = wholeOrNull(c[k], 0, k.endsWith("Minutes") ? 240 : 400);
    return {
      key,
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 40) : `Tier ${i + 1}`,
      maxWeightG: wholeOrNull(o.maxWeightG, 0, 5000),
      maxMeatG: wholeOrNull(o.maxMeatG, 0, 5000),
      cooking: capCooking(cooking, { maxOvenMinutes, maxAirFryerMinutes }),
    };
  });
  return { on: typeof r.on === "boolean" ? r.on : D.on, tiers, maxOvenMinutes, maxAirFryerMinutes, categories };
}

// ── What's in a calzone ────────────────────────────────────────────────────

/** A sub-recipe as it is made: its ingredients (category and weight in
 *  grams) and the sub-recipes inside it (weight in grams). Count units are
 *  left out by the caller (they aren't weights). */
export interface SubRecipeMakeup {
  ingredients: { category: string | null; grams: number }[];
  components: { subRecipeId: number; grams: number }[];
}

/** Category → share of the sub-recipe's weight (0–1), through nested
 *  sub-recipes to any depth. A cycle stops descending. Uncategorised = "". */
export function subRecipeMix(id: number, subs: Map<number, SubRecipeMakeup>, path: number[] = [], memo = new Map<number, Record<string, number>>()): Record<string, number> {
  const hit = memo.get(id);
  if (hit) return hit;
  const sub = subs.get(id);
  const totals: Record<string, number> = {};
  if (sub && !path.includes(id)) {
    for (const ing of sub.ingredients) {
      if (!(ing.grams > 0)) continue;
      const k = ing.category ?? "";
      totals[k] = (totals[k] ?? 0) + ing.grams;
    }
    for (const c of sub.components) {
      if (!(c.grams > 0)) continue;
      const mix = subRecipeMix(c.subRecipeId, subs, [...path, id], memo);
      for (const [k, share] of Object.entries(mix)) totals[k] = (totals[k] ?? 0) + share * c.grams;
    }
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const mix: Record<string, number> = {};
  if (sum > 0) for (const [k, v] of Object.entries(totals)) mix[k] = v / sum;
  if (!path.includes(id)) memo.set(id, mix);
  return mix;
}

/** One component of a calzone: its weight per calzone and its category mix
 *  (a plain ingredient = { itsCategory: 1 }). */
export interface CalzoneComponent { grams: number; mix: Record<string, number> }

export interface CookingProfile {
  /** Per calzone, in grams (rounded). */
  totalG: number;
  doughG: number;
  fillingG: number;
  meatG: number;
  vegG: number;
  cheeseG: number;
}

export function cookingProfile(components: CalzoneComponent[], categories: CookingTiersConfig["categories"]): CookingProfile {
  const classOf = new Map<string, CookingClass>();
  for (const k of COOKING_CLASSES) for (const c of categories[k]) classOf.set(c.toLowerCase(), k);
  const share = (mix: Record<string, number>, cls: CookingClass) =>
    Object.entries(mix).reduce((a, [cat, s]) => a + (classOf.get(cat.toLowerCase()) === cls ? s : 0), 0);
  let dough = 0, filling = 0, meat = 0, veg = 0, cheese = 0;
  for (const c of components) {
    if (!(c.grams > 0)) continue;
    if (share(c.mix, "dough") > 0.5) { dough += c.grams; continue; }
    filling += c.grams;
    meat += c.grams * share(c.mix, "meat");
    veg += c.grams * share(c.mix, "veg");
    cheese += c.grams * share(c.mix, "cheese");
  }
  const r = Math.round;
  return { totalG: r(dough + filling), doughG: r(dough), fillingG: r(filling), meatG: r(meat), vegG: r(veg), cheeseG: r(cheese) };
}

// ── The suggestion ─────────────────────────────────────────────────────────

export interface CookingSuggestion {
  tierKey: string;
  tierName: string;
  /** The tier's times, capped. Blank = the template's standard value. */
  cooking: CookingValues;
  /** e.g. "Medium — 280 g per calzone, 40 g meat (24% of the filling)". */
  reason: string;
}

/** "up to 330 g and up to 45 g meat" / "anything heavier". */
export function describeTierLimits(t: Pick<CookingTier, "maxWeightG" | "maxMeatG">): string {
  const parts: string[] = [];
  if (t.maxWeightG != null) parts.push(`up to ${t.maxWeightG} g per calzone`);
  if (t.maxMeatG != null) parts.push(`up to ${t.maxMeatG} g meat`);
  return parts.length ? parts.join(" and ") : "no limit";
}

export function tierFits(t: Pick<CookingTier, "maxWeightG" | "maxMeatG">, p: Pick<CookingProfile, "totalG" | "meatG">): boolean {
  return (t.maxWeightG == null || p.totalG <= t.maxWeightG) && (t.maxMeatG == null || p.meatG <= t.maxMeatG);
}

/** The tier for this calzone and why. Null when there's nothing to go on:
 *  no tiers, no dough (not a calzone — fried chicken, mac cheese) or no
 *  filling (plain dough balls). */
export function suggestCooking(p: CookingProfile, cfg: CookingTiersConfig): CookingSuggestion | null {
  if (cfg.tiers.length === 0 || p.doughG <= 0 || p.fillingG <= 0) return null;
  const idx = cfg.tiers.findIndex(t => tierFits(t, p));
  const tier = cfg.tiers[idx >= 0 ? idx : cfg.tiers.length - 1];
  const pct = p.fillingG > 0 ? Math.round((100 * p.meatG) / p.fillingG) : 0;
  const what = `${p.totalG} g per calzone, ${p.meatG > 0 ? `${p.meatG} g meat (${pct}% of the filling)` : "no meat"}`;
  const why = idx >= 0 ? `within ${describeTierLimits(tier)}` : "heavier than every other tier allows";
  return { tierKey: tier.key, tierName: tier.name, cooking: capCooking(tier.cooking, cfg), reason: `${tier.name} — ${what}: ${why}` };
}

/** "oven 16–19 min, air fryer 14–17 min" from resolved values. */
export function describeCookingTimes(c: CookingValues): string {
  const range = (a: number | null, b: number | null) => (a == null || b == null ? null : a === b ? `${a}` : `${a}–${b}`);
  const parts: string[] = [];
  const o = range(c.ovenMinMinutes, c.ovenMaxMinutes);
  const a = range(c.airFryerMinMinutes, c.airFryerMaxMinutes);
  if (o) parts.push(`oven ${o} min`);
  if (a) parts.push(`air fryer ${a} min`);
  return parts.join(", ") || "no times";
}

/** Which resolved times go over the cap — each one blocks publishing. */
export function cookingOverCap(c: CookingValues, cfg: Pick<CookingTiersConfig, "maxOvenMinutes" | "maxAirFryerMinutes"> | undefined): string[] {
  if (!cfg) return [];
  const out: string[] = [];
  if (cfg.maxOvenMinutes != null && c.ovenMaxMinutes != null && c.ovenMaxMinutes > cfg.maxOvenMinutes) {
    out.push(`Oven time goes up to ${c.ovenMaxMinutes} min — the longest cook we print is ${cfg.maxOvenMinutes} min.`);
  }
  if (cfg.maxAirFryerMinutes != null && c.airFryerMaxMinutes != null && c.airFryerMaxMinutes > cfg.maxAirFryerMinutes) {
    out.push(`Air-fryer time goes up to ${c.airFryerMaxMinutes} min — the longest we print is ${cfg.maxAirFryerMinutes} min.`);
  }
  return out;
}
