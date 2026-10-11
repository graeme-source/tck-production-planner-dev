import { describe, expect, it, vi } from "vitest";

// No database: the founder check reads one email, which we hand it.
vi.mock("@workspace/db", () => ({
  db: { execute: async () => ({ rows: [{ email: "tommy@thecalzonekitchen.co.uk", is_active: true }] }) },
  pool: { query: async () => ({ rows: [] }) },
}));
vi.mock("../lib/feature-access", () => ({ allowedFeatureKeys: async () => ["founder.numbers"] }));

const { default: router, SettingsPatch, settingsProblem, SETTING_COLUMNS } = await import("./ad-efficiency");
const { requireFounder } = await import("../middleware/founder-access");

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } };

const DEFAULTS = {
  ncRoas7dTargetPct: 210, ncRoasMtdTargetPct: 210, totalRoas30dTargetPct: 700,
  amberWidthPct: 10, holdBandPct: 10, raiseSpendMinPct: 10, raiseSpendMaxPct: 20, smallSampleSpend: 350,
};

describe("ad-efficiency settings", () => {
  const routes = (router as unknown as { stack: Layer[] }).stack.filter(l => l.route).map(l => l.route!);

  it("only the founder can change them", () => {
    const writes = routes.filter(r => !r.methods["get"]);
    expect(writes.map(r => r.path)).toEqual(["/settings"]);
    for (const r of writes) expect(r.stack.map(s => s.handle)).toContain(requireFounder);
  });

  it("accepts a single field (autosave) and refuses an empty or silly change", () => {
    expect(SettingsPatch.safeParse({ ncRoas7dTargetPct: 220 }).success).toBe(true);
    expect(SettingsPatch.safeParse({}).success).toBe(false);
    expect(SettingsPatch.safeParse({ ncRoas7dTargetPct: 0 }).success).toBe(false);
    expect(SettingsPatch.safeParse({ amberWidthPct: 60 }).success).toBe(false);
    expect(SettingsPatch.safeParse({ smallSampleSpend: -1 }).success).toBe(false);
    expect(SettingsPatch.safeParse({ totalRoas30dTargetPct: "700" }).success).toBe(false);
  });

  it("the suggested raise range must run low to high", () => {
    expect(settingsProblem(DEFAULTS)).toBeNull();
    expect(settingsProblem({ ...DEFAULTS, raiseSpendMinPct: 25 })).toMatch(/can't be bigger/);
  });

  it("every setting has a column", () => {
    expect(Object.keys(SETTING_COLUMNS).sort()).toEqual(Object.keys(DEFAULTS).sort());
  });
});
