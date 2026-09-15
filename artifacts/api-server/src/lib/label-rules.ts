/**
 * Opened-life rules for prep-room ingredient labels (Stage 2).
 *
 * The use-by printed on an opened-ingredient label comes from a three-step
 * fallback, most specific first:
 *
 *   1. The ingredient's own opened_life_days (set in the inventory form).
 *   2. The category default from app_settings 'label_opened_life_defaults'
 *      (JSON: {"raw_meat": 2, "cheese": 3, ...}) — set once per material
 *      type, so most ingredients never need their own number.
 *   3. A conservative global default. Deliberately SHORT: an unconfigured
 *      ingredient printing a generous use-by is a food-safety hole; one
 *      printing a short use-by gets its rule set the same day.
 *
 * The resolution names its source, and the source rides into the printed
 * job's payload — so the audit trail shows whether a date came from a rule
 * or a guess.
 */

export const LABEL_RULE_SETTINGS_KEY = "label_opened_life_defaults";
export const GLOBAL_DEFAULT_OPENED_LIFE_DAYS = 2;

export interface OpenedLifeResolution {
  days: number;
  source: "ingredient" | "category" | "default";
}

export function resolveOpenedLife(
  ing: { openedLifeDays?: number | null; category?: string | null },
  categoryDefaults: Record<string, number>,
): OpenedLifeResolution {
  if (ing.openedLifeDays != null && ing.openedLifeDays > 0) {
    return { days: ing.openedLifeDays, source: "ingredient" };
  }
  const cat = (ing.category ?? "").trim();
  const catDays = categoryDefaults[cat];
  if (typeof catDays === "number" && catDays > 0) {
    return { days: catDays, source: "category" };
  }
  return { days: GLOBAL_DEFAULT_OPENED_LIFE_DAYS, source: "default" };
}

/** Parse the app_settings JSON — bad JSON or wrong shapes degrade to "no
 *  category defaults" rather than a 500 at the printer. */
export function parseCategoryDefaults(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

/** yyyy-mm-dd + n days, UTC-noon string math like the rest of the codebase. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
