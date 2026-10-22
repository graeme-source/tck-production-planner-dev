/**
 * Opened-life rules for prep-room ingredient labels (Stage 2).
 *
 * The use-by printed on an opened-ingredient label comes from the most
 * specific rule set:
 *
 *   1. The ingredient's own opened_life_days (set in the inventory form).
 *   2. The category default from app_settings 'label_opened_life_defaults'
 *      (JSON: {"raw_meat": 2, "cheese": 3, ...}) — set once per material
 *      type, so most ingredients never need their own number.
 *   No rule at all → NO label. There is no fallback date (Graeme,
 *   2026-10-22: "it's not possible to print a label that doesn't have
 *   published rules… if they don't have a Print Label button, no rules have
 *   been set and they use the old writing method"). The button is hidden and
 *   the server refuses.
 *
 * The resolution names its source, and the source rides into the printed
 * job's payload — so the audit trail shows whether a date came from a rule
 * or a guess.
 */

export const LABEL_RULE_SETTINGS_KEY = "label_opened_life_defaults";
export interface OpenedLifeResolution {
  days: number;
  source: "ingredient" | "category";
}

export function resolveOpenedLife(
  ing: { openedLifeDays?: number | null; category?: string | null },
  categoryDefaults: Record<string, number>,
): OpenedLifeResolution | null {
  if (ing.openedLifeDays != null && ing.openedLifeDays > 0) {
    return { days: ing.openedLifeDays, source: "ingredient" };
  }
  const cat = (ing.category ?? "").trim();
  const catDays = categoryDefaults[cat];
  if (typeof catDays === "number" && catDays > 0) {
    return { days: catDays, source: "category" };
  }
  return null;
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
