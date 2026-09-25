import { describe, it, expect } from "vitest";
import { parseSettings, SETTING_SCHEMAS, isSettingKey, NEEDS_RECOMPUTE } from "./team-efficiency-settings";
import { FALLBACK_SETTINGS } from "./team-efficiency-day";

describe("parseSettings", () => {
  it("reads the seeded rows", () => {
    const s = parseSettings([
      { key: "standard", value: { ratio: 4.78, setOn: "2026-09-25" } },
      { key: "despatch_share", value: 0.11 },
      { key: "discount_rates", value: { "Line A": 0.22, "Line B": 0.039 } },
      { key: "eight_pack_factor", value: "0.72" },
      { key: "line_positions", value: { "Line B": ["Frying"] } },
      { key: "holiday_accrual", value: 0.1207 },
      { key: "production_section", value: "Production" },
      { key: "job_backfill", value: { completedAt: "x" } },
    ]);
    expect(s.standardRatio).toBe(4.78);
    expect(s.standardSetOn).toBe("2026-09-25");
    expect(s.discountRates).toEqual({ "Line A": 0.22, "Line B": 0.039 });
    expect(s.eightPackFactor).toBe(0.72);
    expect(s.linePositions).toEqual({ "Line B": ["Frying"] });
  });

  it("falls back on anything missing or malformed", () => {
    const s = parseSettings([
      { key: "standard", value: { ratio: -1, setOn: "yesterday" } },
      { key: "despatch_share", value: 3 },
      { key: "discount_rates", value: { "Line A": 2 } },
    ]);
    expect(s.standardRatio).toBe(FALLBACK_SETTINGS.standardRatio);
    expect(s.despatchShare).toBe(FALLBACK_SETTINGS.despatchShare);
    expect(s.discountRates).toEqual({});
  });
});

describe("setting schemas", () => {
  it("accepts sensible edits and refuses nonsense", () => {
    expect(SETTING_SCHEMAS.standard.safeParse({ ratio: 4.5, setOn: "2026-10-01" }).success).toBe(true);
    expect(SETTING_SCHEMAS.standard.safeParse({ ratio: 0, setOn: "2026-10-01" }).success).toBe(false);
    expect(SETTING_SCHEMAS.discount_rates.safeParse({ "Line A": 0.3 }).success).toBe(true);
    expect(SETTING_SCHEMAS.discount_rates.safeParse({ "Line A": 1 }).success).toBe(false);
    expect(SETTING_SCHEMAS.despatch_share.safeParse(0.6).success).toBe(false);
  });
  it("knows its keys and which ones need Planday again", () => {
    expect(isSettingKey("standard")).toBe(true);
    expect(isSettingKey("job_backfill")).toBe(false);
    expect(NEEDS_RECOMPUTE.has("line_positions")).toBe(true);
    expect(NEEDS_RECOMPUTE.has("discount_rates")).toBe(false);
  });
});
