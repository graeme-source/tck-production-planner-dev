/**
 * Loads the TCK run rate's break settings from app_settings. The calculation
 * itself is pure and lives in lib/run-rate.ts (re-exported here so existing
 * callers keep importing from this file).
 */
import { db, appSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  DEFAULT_RESTART_ALLOWANCE_MINUTES,
  LUNCH_ANCHOR,
  LUNCH_GAP_MINUTES,
  MORNING_ANCHOR,
  RESTART_ALLOWANCE_SETTING,
  type StandardBreakConfig,
} from "./run-rate";

export * from "./run-rate";

/** Break lengths and the restart allowance from Settings. */
export async function getStandardBreakConfig(): Promise<StandardBreakConfig> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, ["default_break_minutes", "default_lunch_minutes", RESTART_ALLOWANCE_SETTING]));
  const byKey = new Map(rows.map(r => [r.key, Number(r.value)]));
  const num = (k: string, fallback: number) => {
    const v = byKey.get(k);
    return v != null && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    morning: { anchorMinutes: MORNING_ANCHOR, minutes: num("default_break_minutes", 15) },
    lunch: { anchorMinutes: LUNCH_ANCHOR, minutes: num("default_lunch_minutes", 35) },
    allowanceMinutes: num(RESTART_ALLOWANCE_SETTING, DEFAULT_RESTART_ALLOWANCE_MINUTES),
    lunchGapMinutes: LUNCH_GAP_MINUTES,
  };
}

