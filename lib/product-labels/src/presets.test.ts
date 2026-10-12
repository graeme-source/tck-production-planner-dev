import { describe, it, expect } from "vitest";
import { findBoneRisk } from "./bones";
import { buildLabelContent } from "./content";
import { labelDates } from "./dates";
import { loadBundledFonts } from "./node-fonts";
import { proofLabel } from "./render";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, diffSnapshots, snapshotKey, type RecipeLabelSettings } from "./snapshot";
import { snowflakeContours } from "./snowflake";
import { DEFAULT_TEMPLATE, friedChickenTemplate, normaliseTemplate, TEMPLATE_PRESETS, type LabelTemplate } from "./template";

const fonts = loadBundledFonts();
const when = { printDate: "2026-10-12", productionDate: "2026-10-12" };
const KOREAN_DECK =
  "**Buttermilk** Fried Chicken Strip (Chicken Breast (35.5%), Refined Soyabean oil, Whole **Milk**, Breadcrumbs (**wheat** flour, salt, spices), glucose syrup), " +
  "Yangnyeom Korean Dipping Sauce (Corn Syrup, Tomato Ketchup, Minced Garlic, Red Pepper Paste 25% (Red Pepper Powder, Water, Salt, Onion, Garlic, Corn Starch), Water, **Wheat** Flour, Rice Powder, Salt, Distilled Alcohol (Contain **Wheat**, **Barley**), **Soybean**, Glutinous Rice, Koji, Demerara Sugar, Premium Dark **Soy** Sauce, Water).";

function snap(template: LabelTemplate, settings: Partial<RecipeLabelSettings> = {}, deckText = KOREAN_DECK) {
  return buildSnapshot({
    recipe: { name: "Korean Fried Chicken 500G", packSize: "1", shelfLifeDays: null },
    deck: { deckText, mayContainStatement: "May also contain traces of nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk" },
    settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode: "5065018206948", ...settings },
    templateId: 2,
    template,
  });
}
const content = (s: ReturnType<typeof snap>) =>
  buildLabelContent(s, labelDates({ ...when, chilled: s.chilled, frozen: s.frozen, batchBasis: s.template.batchBasis }));

describe("template presets", () => {
  it("have unique keys and names; the standard one is the default template", () => {
    expect(new Set(TEMPLATE_PRESETS.map(p => p.key)).size).toBe(TEMPLATE_PRESETS.length);
    expect(new Set(TEMPLATE_PRESETS.map(p => p.name.toLowerCase())).size).toBe(TEMPLATE_PRESETS.length);
    expect(TEMPLATE_PRESETS.find(p => p.key === "standard")!.build()).toEqual(normaliseTemplate(DEFAULT_TEMPLATE));
  });

  it("each builds a template that survives saving unchanged (normaliseTemplate round trip)", () => {
    for (const p of TEMPLATE_PRESETS) {
      const t = p.build();
      expect(normaliseTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
    }
  });
});

describe("new template options: off on the standard label, and for older templates", () => {
  it("defaults", () => {
    const t = normaliseTemplate({});
    expect(t.storageBanner.on).toBe(false);
    expect(t.chilledUseByOn).toBe(true);
    expect(t.netQuantity.on).toBe(false);
    expect(t.warningPlacement).toBe("allergens");
  });
  it("are read and clamped", () => {
    const t = normaliseTemplate({ storageBanner: { on: true, text: "KEEP FROZEN", heightMm: 99 }, chilledUseByOn: false, netQuantity: { on: true, sizePt: 2 }, warningPlacement: "storage" });
    expect(t.storageBanner).toMatchObject({ on: true, text: "KEEP FROZEN", snowflake: true, heightMm: 20 });
    expect(t.chilledUseByOn).toBe(false);
    expect(t.netQuantity).toEqual({ on: true, sizePt: 6.75 });
    expect(t.warningPlacement).toBe("storage");
    expect(normaliseTemplate({ warningPlacement: "sideways" }).warningPlacement).toBe("allergens");
  });
  it("the standard label prints exactly as before: chilled + frozen lines, warning with the allergens, no band, no net quantity", () => {
    const s = snap(normaliseTemplate(DEFAULT_TEMPLATE), { warningOn: true });
    const c = content(s);
    expect(c.dates).toHaveLength(3);
    expect(c.storageBanner).toBeNull();
    expect(c.netQuantity).toEqual([]);
    expect(c.allergenInfo.at(-1)!.map(r => r.text).join("")).toContain("WARNING");
    expect("netQuantity" in s).toBe(false);
  });
});

describe("fried chicken template", () => {
  const t = friedChickenTemplate();
  it("has Graeme's three steps, using the cooking values (no air fryer, no wooden tray)", () => {
    expect(t.text.steps).toHaveLength(3);
    expect(t.text.steps.join(" ").toLowerCase()).not.toContain("tray.**");
    expect(t.text.steps.join(" ")).not.toContain("wooden");
    expect(t.cooking).toMatchObject({ ovenTempC: 190, fanTempC: 170, ovenMinMinutes: 14, ovenMaxMinutes: 16, airFryerTempC: null });
    const c = content(snap(t));
    const steps = c.steps.map(ps => ps.map(p => p.map(r => r.text).join("")).join(" "));
    expect(steps).toEqual([
      "COOK FROM FROZEN. Pre-heat the oven to 190°C (170°C fan) and remove all packaging.",
      "Spread the chicken strips across a baking tray.",
      "Cook for 14–16 minutes until piping hot and crunchy.",
    ]);
    expect(c.problems).toEqual(["No net quantity — set it in this recipe's label settings (e.g. 500g)."]);
  });
  it("a recipe's own cooking values flow into the steps", () => {
    const c = content(snap(t, { cooking: { ...DEFAULT_RECIPE_LABEL_SETTINGS.cooking, ovenMaxMinutes: 18 } }));
    expect(c.steps[2][0].map(r => r.text).join("")).toContain("14–18 minutes");
  });
  it("frozen only: one USE BY line (5 months), no chilled line or chilled problem", () => {
    const c = content(snap(t, { netQuantity: "500g" }));
    const lines = c.dates.map(p => p.map(r => r.text).join(""));
    expect(lines).toEqual(["USE BY: 12/03/27", expect.stringMatching(/^BATCH NUMBER: /)]);
    expect(c.problems).toEqual([]);
  });
  it("KEEP FROZEN band; bones warning (automatic, chicken) at the end of the storage text", () => {
    const c = content(snap(t, { netQuantity: "500g" }));
    expect(c.storageBanner).toBe("KEEP FROZEN");
    expect(c.storageHeading).toEqual([]);
    expect(c.storage.map(p => p.map(r => r.text).join(""))).toEqual([
      "Store at -18°C or below. Cook from frozen.",
      "WARNING: Whilst every effort has been made to remove all bones, some may remain.",
    ]);
    expect(c.allergenInfo.some(p => p.some(r => r.text.includes("bones")))).toBe(false);
    expect(findBoneRisk(KOREAN_DECK, t.boneRiskWords)).not.toBeNull();
  });
  it("the net quantity prints, is part of the snapshot, and a change shows as Net quantity", () => {
    const a = snap(t, { netQuantity: "500g" });
    const b = snap(t, { netQuantity: "450g" });
    expect(a.netQuantity).toBe("500g");
    expect(content(a).netQuantity).toEqual([[{ text: "500g", bold: true }]]);
    expect(snapshotKey(a)).not.toBe(snapshotKey(b));
    expect(diffSnapshots(a, b).find(x => x.key === "netQuantity")).toMatchObject({ label: "Net quantity", before: "500g", after: "450g" });
  });
  it("lays out: fits, three full-height step circles, the band and its snowflakes, 500g above the barcode", () => {
    const p = proofLabel(snap(t, { netQuantity: "500g" }), when, fonts);
    expect(p.layout.problems).toEqual([]);
    expect(p.layout.circles).toHaveLength(3);
    const steps = p.layout.fields.find(f => f.key === "steps")!;
    for (const [i, c] of p.layout.circles.entries()) {
      for (const r of steps.runs.filter(r => !r.white && r.x >= steps.boxes[i].x && r.x < steps.boxes[i].x + steps.boxes[i].w)) expect(r.x).toBeGreaterThan(c.cx + c.r);
    }
    const band = p.layout.banner!;
    expect(band.flakes).toHaveLength(2);
    // The band is solid black except its white words and flakes.
    const bm = p.bitmap;
    expect(bm.get(band.rect.x + 1, band.rect.y + 1)).toBe(1);
    expect(bm.get(Math.round(band.flakes[0].cx), Math.round(band.flakes[0].cy))).toBe(0);
    const net = p.layout.extraRuns.find(r => r.text === "500g")!;
    expect(net.face.weight).toBe(700);
    expect(net.y).toBeLessThan(p.layout.barcode.barsTop);
    const dates = p.layout.fields.find(f => f.key === "dates")!;
    expect(dates.boxes[0].y + dates.usedHeight).toBeLessThan(net.y - fonts.ink("500g", net.face, net.sizeDots, 0).top);
  });
  it("building it never changes the standard template", () => {
    friedChickenTemplate();
    expect(DEFAULT_TEMPLATE.text.steps).toHaveLength(2);
    expect(DEFAULT_TEMPLATE.storageBanner.on).toBe(false);
    expect(DEFAULT_TEMPLATE.fields.ingredients.narrowest).toBe("semi-condensed");
  });
});

describe("drawn snowflake", () => {
  it("six arms with two pairs of branches, all inside its radius", () => {
    const cs = snowflakeContours(100, 100, 20);
    expect(cs).toHaveLength(6 * 5);
    for (const c of cs) for (const [x, y] of c) expect(Math.hypot(x - 100, y - 100)).toBeLessThanOrEqual(20 + 1e-6);
  });
});

describe("template changes are named in the change list", () => {
  it("switching to the fried chicken options lists each one", () => {
    const keys = diffSnapshots(snap(normaliseTemplate(DEFAULT_TEMPLATE)), snap(friedChickenTemplate(), { netQuantity: "500g" })).map(c => c.key);
    for (const k of ["template.storageBanner", "template.chilledUseByOn", "template.netQuantity", "template.warningPlacement", "netQuantity"]) expect(keys).toContain(k);
  });
});
