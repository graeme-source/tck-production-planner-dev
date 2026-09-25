/**
 * Team efficiency settings — parsing stored rows and validating the
 * founder's edits (Objective I; pure). Stored as key → jsonb rows in
 * team_efficiency_settings (migration 0129 seeds the defaults as data).
 */
import { z } from "zod";
import { FALLBACK_SETTINGS, type TeSettings } from "./team-efficiency-day";

const rate = z.number().min(0).max(0.95);

/** One schema per editable key. Rates are fractions (0.22 = 22%). */
export const SETTING_SCHEMAS = {
  standard: z.object({
    ratio: z.number().gt(0).lt(100),
    setOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  despatch_share: z.number().min(0).max(0.5),
  discount_rates: z.record(z.string().min(1).max(80), rate),
  eight_pack_factor: z.number().gt(0).max(1.5),
  line_positions: z.record(z.string().min(1).max(80), z.array(z.string().min(1).max(80)).max(20)),
  holiday_accrual: z.number().min(0).max(0.5),
} as const;

const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(d => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Not a real date");

/** GET /api/team-efficiency query: a preset range, or a custom from/to. */
export const REPORT_QUERY = z.object({
  range: z.enum(["30d", "3m", "6m", "12m"]).default("3m"),
  from: isoDate.optional(),
  to: isoDate.optional(),
})
  .refine(q => (q.from == null) === (q.to == null), { message: "Give both from and to, or neither" })
  .refine(q => q.from == null || q.to == null || q.to >= q.from, { message: "The end date can't be before the start" });

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

export function isSettingKey(k: string): k is SettingKey {
  return (SETTING_KEYS as string[]).includes(k);
}

/** Settings whose change needs Planday again (who counts as line-only
 *  staff, and holiday accrual which is folded into the stored labour cost);
 *  everything else restates stored history instantly. */
export const NEEDS_RECOMPUTE: ReadonlySet<SettingKey> = new Set(["line_positions", "holiday_accrual"]);

/** Build settings from stored rows; anything missing or malformed falls back. */
export function parseSettings(rows: Array<{ key: string; value: unknown }>): TeSettings {
  const s: TeSettings = { ...FALLBACK_SETTINGS, discountRates: {}, linePositions: {} };
  for (const { key, value } of rows) {
    const v = typeof value === "string" ? safeJson(value) : value;
    switch (key) {
      case "standard": {
        const p = SETTING_SCHEMAS.standard.safeParse(v);
        if (p.success) { s.standardRatio = p.data.ratio; s.standardSetOn = p.data.setOn; }
        break;
      }
      case "despatch_share": { const p = SETTING_SCHEMAS.despatch_share.safeParse(v); if (p.success) s.despatchShare = p.data; break; }
      case "discount_rates": { const p = SETTING_SCHEMAS.discount_rates.safeParse(v); if (p.success) s.discountRates = p.data; break; }
      case "eight_pack_factor": { const p = SETTING_SCHEMAS.eight_pack_factor.safeParse(v); if (p.success) s.eightPackFactor = p.data; break; }
      case "line_positions": { const p = SETTING_SCHEMAS.line_positions.safeParse(v); if (p.success) s.linePositions = p.data; break; }
      case "holiday_accrual": { const p = SETTING_SCHEMAS.holiday_accrual.safeParse(v); if (p.success) s.holidayAccrual = p.data; break; }
      case "production_section": { if (typeof v === "string" && v.trim()) s.productionSection = v.trim(); break; }
    }
  }
  return s;
}

function safeJson(x: string): unknown {
  try { return JSON.parse(x); } catch { return x; }
}
