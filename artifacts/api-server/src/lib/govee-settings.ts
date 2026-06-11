// Govee feature configuration, stored as `govee_*` rows in app_settings so it
// can be toggled at runtime without a deploy. The API key + VAPID keys are NOT
// here — those are env secrets. This module owns the toggles, thresholds and
// alert recipients.

import { db, appSettingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

export interface GoveeSettings {
  /** Master switch — when false, nothing Govee runs (no poll, no tile, no alerts). */
  enabled: boolean;
  /** Live fridge/freezer tile on the dashboard. */
  tileEnabled: boolean;
  /** Background poller stores readings to govee_readings for history/reports. */
  historyEnabled: boolean;
  /** Out-of-range email + push alerts. */
  alertsEnabled: boolean;
  /** Prefill the daily fridge/freezer temperature checklist from live sensors. */
  checklistAssistEnabled: boolean;
  /** Safe-range ceilings (°C). A fridge/freezer above its ceiling is "breaching". */
  fridgeMaxC: number;
  freezerMaxC: number;
  /** Email address that receives alerts (in addition to push recipients). */
  alertEmail: string;
  /** App user ids that receive web-push alerts. */
  alertRecipientUserIds: number[];
  /** Poll cadence in minutes (kept modest to stay within Govee rate limits + memory). */
  pollMinutes: number;
  /** A unit must breach continuously for this long before an alert fires. */
  alertBreachMinutes: number;
}

const KEYS = {
  enabled: "govee_enabled",
  tileEnabled: "govee_tile_enabled",
  historyEnabled: "govee_history_enabled",
  alertsEnabled: "govee_alerts_enabled",
  checklistAssistEnabled: "govee_checklist_assist_enabled",
  fridgeMaxC: "govee_fridge_max_c",
  freezerMaxC: "govee_freezer_max_c",
  alertEmail: "govee_alert_email",
  alertRecipientUserIds: "govee_alert_recipient_user_ids",
  pollMinutes: "govee_poll_minutes",
  alertBreachMinutes: "govee_alert_breach_minutes",
} as const;

const DEFAULTS: GoveeSettings = {
  enabled: true,
  tileEnabled: true,
  historyEnabled: true,
  // Alerts default OFF so a unit already out of range doesn't immediately spam
  // before thresholds/recipients are reviewed. Turn on in Settings.
  alertsEnabled: false,
  checklistAssistEnabled: true,
  fridgeMaxC: 5,
  freezerMaxC: -18,
  alertEmail: "graeme@thecalzonekitchen.co.uk",
  alertRecipientUserIds: [],
  pollMinutes: 10,
  alertBreachMinutes: 20,
};

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}
function parseNum(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function parseIdList(v: string | undefined): number[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    if (Array.isArray(arr)) return arr.map(Number).filter(Number.isFinite);
  } catch { /* ignore */ }
  return [];
}

export async function getGoveeSettings(): Promise<GoveeSettings> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, Object.values(KEYS)));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    enabled: parseBool(map.get(KEYS.enabled), DEFAULTS.enabled),
    tileEnabled: parseBool(map.get(KEYS.tileEnabled), DEFAULTS.tileEnabled),
    historyEnabled: parseBool(map.get(KEYS.historyEnabled), DEFAULTS.historyEnabled),
    alertsEnabled: parseBool(map.get(KEYS.alertsEnabled), DEFAULTS.alertsEnabled),
    checklistAssistEnabled: parseBool(map.get(KEYS.checklistAssistEnabled), DEFAULTS.checklistAssistEnabled),
    fridgeMaxC: parseNum(map.get(KEYS.fridgeMaxC), DEFAULTS.fridgeMaxC),
    freezerMaxC: parseNum(map.get(KEYS.freezerMaxC), DEFAULTS.freezerMaxC),
    alertEmail: map.get(KEYS.alertEmail) ?? DEFAULTS.alertEmail,
    alertRecipientUserIds: map.has(KEYS.alertRecipientUserIds)
      ? parseIdList(map.get(KEYS.alertRecipientUserIds))
      : DEFAULTS.alertRecipientUserIds,
    pollMinutes: Math.max(2, parseNum(map.get(KEYS.pollMinutes), DEFAULTS.pollMinutes)),
    alertBreachMinutes: Math.max(0, parseNum(map.get(KEYS.alertBreachMinutes), DEFAULTS.alertBreachMinutes)),
  };
}

function serialise(key: keyof GoveeSettings, value: unknown): string {
  if (key === "alertRecipientUserIds") return JSON.stringify(value ?? []);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Persist a partial settings update. Only provided keys are written. */
export async function setGoveeSettings(patch: Partial<GoveeSettings>): Promise<void> {
  const entries = Object.entries(patch) as Array<[keyof GoveeSettings, unknown]>;
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const settingKey = KEYS[key];
    if (!settingKey) continue;
    const settingValue = serialise(key, value);
    await db
      .insert(appSettingsTable)
      .values({ key: settingKey, value: settingValue })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: settingValue, updatedAt: new Date() } });
  }
}
