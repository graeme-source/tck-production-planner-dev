/**
 * The dispatch shelf-life rule — chilled products must reach the customer
 * with a minimum shelf life left (historically: calzones 3 days, mac cheese
 * 2 — Graeme, 2026-08-08). Delivered day D with use-by E requires
 * E ≥ D + minDays; APC is overnight, so dispatch day X means delivery X+1,
 * and the earliest acceptable use-by for dispatching today is
 * today + 1 + minDays.
 *
 * Previously hard-coded in two byte-identical copies (fridge-expiry.ts and
 * production-plans.ts). Now this is the single home, and the numbers are
 * configurable via the app_settings key `min_shelf_days_at_customer`
 * holding JSON like {"default":3,"byCategory":{"macaroni cheese":2}} —
 * edited from the packing checklist's admin panel. An absent or unreadable
 * setting falls back to the long-standing built-in rule, so this can never
 * fail open to "no rule".
 */
export const MIN_SHELF_DAYS_KEY = "min_shelf_days_at_customer";

export interface MinShelfDaysRules {
  default: number;
  /** Category name (lowercased) → min days at customer. */
  byCategory: Record<string, number>;
}

/** The rule as it stood before it became configurable. */
export const BUILT_IN_MIN_SHELF_RULES: MinShelfDaysRules = {
  default: 3,
  byCategory: { "macaroni cheese": 2 },
};

function validDays(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 30;
}

/** Parse the stored setting; anything malformed falls back to the built-in
 *  rule rather than to no rule. Pure, unit-tested. */
export function parseMinShelfDaysRules(raw: string | null | undefined): MinShelfDaysRules {
  if (!raw) return BUILT_IN_MIN_SHELF_RULES;
  try {
    const parsed = JSON.parse(raw) as { default?: unknown; byCategory?: unknown };
    if (!validDays(Number(parsed?.default))) return BUILT_IN_MIN_SHELF_RULES;
    const byCategory: Record<string, number> = {};
    if (parsed.byCategory && typeof parsed.byCategory === "object") {
      for (const [category, days] of Object.entries(parsed.byCategory as Record<string, unknown>)) {
        const n = Number(days);
        if (category.trim() && validDays(n)) byCategory[category.trim().toLowerCase()] = n;
      }
    }
    return { default: Number(parsed.default), byCategory };
  } catch {
    return BUILT_IN_MIN_SHELF_RULES;
  }
}

/** Min days at customer for a category, under the given rules. Pure. */
export function minShelfDaysFor(category: string | null, rules: MinShelfDaysRules): number {
  return rules.byCategory[(category ?? "").trim().toLowerCase()] ?? rules.default;
}

/** Load the rules once per request — callers pass them into the pure
 *  resolver inside their loops. DB modules are imported lazily so the pure
 *  half of this file stays unit-testable without a DATABASE_URL. */
export async function loadMinShelfDaysRules(): Promise<MinShelfDaysRules> {
  const [{ db }, { sql }] = await Promise.all([import("@workspace/db"), import("drizzle-orm")]);
  const rows = await db.execute<{ value: string }>(sql`
    SELECT value FROM app_settings WHERE key = ${MIN_SHELF_DAYS_KEY}
  `);
  return parseMinShelfDaysRules((rows.rows ?? [])[0]?.value);
}
