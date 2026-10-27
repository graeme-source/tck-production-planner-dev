/**
 * Shelf life → the chilled use-by on a label (pure, tested). Objective D.
 *
 * ONE source of truth (Graeme, 2026-10-27: "I don't want to be able to
 * change it in the recipe and have it not come through on the label, or vice
 * versa"): the recipe's shelf life (recipes.shelf_life_days) IS the chilled
 * use-by period. The label page edits that same number; there is no
 * label-only override any more.
 *
 * The one exception is by design, and it belongs to the TEMPLATE, not the
 * recipe: a despatch label (cinnamon buns' big label, printed the morning
 * they come out of the freezer) can say its use-by counts a fixed period
 * from despatch — the print day — whatever the recipe's shelf life (which
 * for the buns is the 180-day freezer life, printed on their small internal
 * label at wrapping).
 *
 * Order:
 *   1. the template counts from despatch → its fixed period;
 *   2. else the recipe's shelf life (days), when it has one;
 *   3. else the template's standard chilled period (calzones 13 days) —
 *      only for recipes with no shelf life set at all;
 *   4. else none (the label shows "No chilled use-by" and can't go live).
 */
import type { ShelfPeriod } from "./dates";
import { PERIOD_UNITS, type PeriodUnit } from "./dates";

export type UseByRule =
  | { from: "recipe-shelf-life" }
  | { from: "despatch"; period: ShelfPeriod };

export const DEFAULT_USE_BY_RULE: UseByRule = { from: "recipe-shelf-life" };

/** A stored value → a rule. Anything that isn't a valid despatch rule is the
 *  default (the recipe's shelf life). */
export function normaliseUseByRule(v: unknown): UseByRule {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return { ...DEFAULT_USE_BY_RULE };
  const o = v as Record<string, unknown>;
  if (o.from !== "despatch") return { ...DEFAULT_USE_BY_RULE };
  const p = (o.period ?? {}) as Record<string, unknown>;
  const amount = typeof p.amount === "number" ? Math.round(p.amount) : Number(p.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 999) return { ...DEFAULT_USE_BY_RULE };
  const unit = PERIOD_UNITS.includes(p.unit as PeriodUnit) ? (p.unit as PeriodUnit) : "days";
  return { from: "despatch", period: { amount, unit } };
}

export type ChilledSource = "despatch" | "recipe-shelf-life" | "template-standard" | "none";

export interface ChilledResolution {
  period: ShelfPeriod | null;
  source: ChilledSource;
}

/** The chilled use-by period a label prints, and where it came from. */
export function resolveChilledPeriod(
  template: { useBy?: UseByRule | null; chilledDefault?: ShelfPeriod | null },
  shelfLifeDays: number | null | undefined,
): ChilledResolution {
  const rule = normaliseUseByRule(template.useBy);
  if (rule.from === "despatch") return { period: { ...rule.period }, source: "despatch" };
  if (shelfLifeDays != null && shelfLifeDays > 0) return { period: { amount: Math.trunc(shelfLifeDays), unit: "days" }, source: "recipe-shelf-life" };
  if (template.chilledDefault) return { period: { ...template.chilledDefault }, source: "template-standard" };
  return { period: null, source: "none" };
}

/** True when the template ignores the recipe's shelf life (despatch labels):
 *  the label page then shows the template's period read-only instead of the
 *  recipe's shelf-life box. */
export function useByIgnoresShelfLife(template: { useBy?: UseByRule | null }): boolean {
  return normaliseUseByRule(template.useBy).from === "despatch";
}
