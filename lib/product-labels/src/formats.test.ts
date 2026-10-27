/**
 * Template formats (2026-10-27): the size belongs to the template, fixed —
 * the 140 × 94 back label and the 102 × 25 small pot label (garlic mayo).
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { labelFormat, LABEL_FORMATS, normaliseFormat } from "./formats";
import {
  DEFAULT_TEMPLATE, garlicMayoTemplate, normaliseTemplate, TEMPLATE_PRESETS, friedChickenTemplate, type LabelTemplate,
} from "./template";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, diffSnapshots, snapshotKey, snapshotsMatch, type LabelSnapshot, type RecipeLabelSettings } from "./snapshot";
import { buildLabelContent } from "./content";
import { buildSmallLabelContent } from "./small-label";
import { labelDates } from "./dates";
import { publishBlockers } from "./status";
import { resolveTemplateChoice } from "./template-choice";
import { loadBundledFonts } from "./node-fonts";
import { proofLabel } from "./render";
import { labelPageSizeMm, labelsPdf } from "./pdf";

const fonts = loadBundledFonts();
const MAYO_CODE = "97748478844497";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const mayo = (o: { name?: string; deck?: string; settings?: Partial<RecipeLabelSettings>; shelf?: number | null } = {}) =>
  buildSnapshot({
    recipe: { name: o.name ?? "TCK Garlic Mayo 200ml", packSize: "1.0000", shelfLifeDays: o.shelf === undefined ? 0 : o.shelf },
    deck: { deckText: o.deck ?? "Mayonnaise (**Egg**), Garlic", mayContainStatement: null },
    settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, labelName: "TCK Garlic Mayo", barcode: MAYO_CODE, ...o.settings },
    templateId: 8,
    template: garlicMayoTemplate(),
  });

const calzone = (template: LabelTemplate = normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE))), barcode = "5065018206009") =>
  buildSnapshot({
    recipe: { name: "Chicken and Chorizo", packSize: "2.0000", shelfLifeDays: 13 },
    deck: { deckText: "Chicken (40%), **Wheat** Flour", mayContainStatement: null },
    settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode },
    templateId: 1,
    template,
  });

const datesFor = (s: LabelSnapshot, day = "2026-10-27") =>
  labelDates({ printDate: day, productionDate: day, chilled: s.chilled, frozen: null, batchBasis: s.template.batchBasis });

describe("format normalisation", () => {
  it("a template stored before formats existed is the 140 × 94 back label", () => {
    const { format: _f, ...legacy } = JSON.parse(JSON.stringify(DEFAULT_TEMPLATE));
    const t = normaliseTemplate(legacy);
    expect(t.format).toBe("back-140x94");
    expect(t.page.widthMm).toBe(140);
    expect(t.page.heightMm).toBe(94);
    expect(normaliseTemplate({}).format).toBe("back-140x94");
    expect(normaliseFormat("a4-poster")).toBe("back-140x94");
  });

  it("the size follows the format, never a typed-in width or height", () => {
    expect(normaliseTemplate({ page: { widthMm: 200, heightMm: 50 } }).page).toMatchObject({ widthMm: 140, heightMm: 94 });
    const small = normaliseTemplate({ format: "small-102x25", page: { widthMm: 140, heightMm: 94, dpi: 300 } });
    expect(small.format).toBe("small-102x25");
    expect(small.page).toMatchObject({ widthMm: 102, heightMm: 25, dpi: 203 });
    // A back label keeps its own printer resolution.
    expect(normaliseTemplate({ page: { dpi: 300 } }).page.dpi).toBe(300);
  });

  it("each format names its size", () => {
    expect(labelFormat({}).sizeText).toBe("140 × 94 mm");
    expect(labelFormat({ format: "small-102x25" })).toMatchObject({ sizeText: "102 × 25 mm", backLabel: false });
    expect(Object.keys(LABEL_FORMATS)).toEqual(["back-140x94", "small-102x25"]);
  });

  it("the Garlic mayo preset is the small format: 38-day use-by, batch from the print day, no category", () => {
    const preset = TEMPLATE_PRESETS.find(p => p.key === "garlic-mayo")!;
    expect(preset.name).toBe("Garlic mayo");
    const t = preset.build();
    expect(labelFormat(t).key).toBe("small-102x25");
    expect(t.chilledDefault).toEqual({ amount: 38, unit: "days" });
    expect(t.batchBasis).toBe("print-day");
    expect(t.defaultForCategories).toEqual([]);
    // Every other preset is a back label.
    for (const p of TEMPLATE_PRESETS.filter(x => x.key !== "garlic-mayo")) expect(labelFormat(p.build()).backLabel).toBe(true);
  });
});

describe("published back labels keep their hash", () => {
  it("Chicken and Chorizo's live snapshot (published before formats) still hashes to its stored hash", () => {
    const fx = JSON.parse(readFileSync(new URL("./fixtures/live-snapshot-chicken-chorizo.json", import.meta.url), "utf8")) as { hash: string; snapshot: LabelSnapshot };
    expect("format" in fx.snapshot.template).toBe(false);
    expect(sha(snapshotKey(fx.snapshot))).toBe(fx.hash);
    // The CURRENT label is built from the normalised template, which now
    // carries a format — it must still match the live one.
    const current = { ...fx.snapshot, template: normaliseTemplate(fx.snapshot.template) };
    expect(current.template.format).toBe("back-140x94");
    expect(sha(snapshotKey(current))).toBe(fx.hash);
  });

  it("a back label with and without the format field compares equal", () => {
    const now = calzone();
    const { format: _f, ...legacyTemplate } = now.template;
    expect(snapshotsMatch(now, { ...now, template: legacyTemplate as LabelTemplate })).toBe(true);
    const chicken = calzone(friedChickenTemplate());
    const { format: _g, ...legacyChicken } = chicken.template;
    expect(snapshotKey(chicken)).toBe(snapshotKey({ ...chicken, template: legacyChicken as LabelTemplate }));
  });
});

describe("small-format snapshots", () => {
  it("only what the small label prints decides whether it changed", () => {
    expect(snapshotsMatch(mayo(), mayo({ deck: "Rapeseed Oil, **Egg** Yolk, Garlic" }))).toBe(true);
    expect(snapshotsMatch(mayo(), mayo({ settings: { warningOn: true, frozen: { amount: 3, unit: "months" } } }))).toBe(true);
    expect(snapshotsMatch(mayo(), mayo({ settings: { labelName: "Garlic Mayo" } }))).toBe(false);
    expect(snapshotsMatch(mayo(), mayo({ settings: { chilled: { amount: 30, unit: "days" } } }))).toBe(false);
    expect(snapshotsMatch(mayo(), mayo({ settings: { barcode: "5065018206009" } }))).toBe(false);
  });

  it("lists the small label's own changes, and a switch of size", () => {
    expect(diffSnapshots(mayo(), mayo({ settings: { chilled: { amount: 30, unit: "days" } } })).map(c => c.key)).toEqual(["chilled"]);
    const switched = diffSnapshots(calzone(), mayo());
    expect(switched.map(c => c.key)).toEqual(expect.arrayContaining(["templateId", "template.format"]));
    expect(switched.find(c => c.key === "template.format")).toMatchObject({ before: "140 × 94 mm", after: "102 × 25 mm" });
    expect(switched.some(c => c.key === "deckText" || c.key.startsWith("cooking."))).toBe(false);
  });

  it("use-by: the label's period, else the shelf life, else the template's 38 days (printed 27 Oct → 04/12/26)", () => {
    expect(datesFor(mayo()).chilledUseBy).toBe("2026-12-04");
    expect(buildSmallLabelContent(mayo(), datesFor(mayo())).input).toMatchObject({ name: "TCK Garlic Mayo", useBy: "04/12/26", batch: "26300", barcode: MAYO_CODE });
    expect(datesFor(mayo({ shelf: 30 })).chilledUseBy).toBe("2026-11-26");
    expect(datesFor(mayo({ settings: { chilled: { amount: 2, unit: "weeks" } } })).chilledUseBy).toBe("2026-11-10");
  });
});

describe("barcodes by format", () => {
  it("the small label takes Shopify's 14-digit code; the back label still refuses it", () => {
    expect(buildSmallLabelContent(mayo(), datesFor(mayo())).problems).toEqual([]);
    const back = calzone(undefined, MAYO_CODE);
    const problems = buildLabelContent(back, datesFor(back)).problems;
    expect(problems.some(p => /Needs 13 digits/.test(p))).toBe(true);
  });

  it("the small label flags a 13-digit code with a wrong check digit, and a missing code", () => {
    const bad = mayo({ settings: { barcode: "5065018206949" } });
    expect(buildSmallLabelContent(bad, datesFor(bad)).problems.join(" ")).toMatch(/Barcode number isn't valid/);
    const none = mayo({ settings: { barcode: null } });
    expect(buildSmallLabelContent(none, datesFor(none)).problems).toContain("No barcode number yet.");
  });
});

describe("publishing a small label", () => {
  it("deck declaration problems don't block it (they still block a back label)", () => {
    const base = { archived: false, fits: true, fitProblems: [], contentProblems: [], deckBlockers: ["1 ingredient(s) have no label declaration: Garlic."] };
    expect(publishBlockers({ ...base, template: garlicMayoTemplate() })).toEqual([]);
    expect(publishBlockers({ ...base, template: DEFAULT_TEMPLATE })).toHaveLength(1);
    expect(publishBlockers(base)).toHaveLength(1);
  });
});

describe("small-format proof, publish image and print", () => {
  it("renders at 102 × 25 mm, fits, and prints a 102 × 25 mm PDF page", () => {
    const proof = proofLabel(mayo(), { printDate: "2026-10-27", productionDate: "2026-10-27" }, fonts);
    expect(proof.format).toBe("small-102x25");
    expect(proof.layout.fits).toBe(true);
    expect(proof.content.problems).toEqual([]);
    expect(proof.layout.fields).toEqual([]);
    expect(proof.small?.layout.barcode?.kind).toBe("code128");
    expect(proof.dates.batchCode).toBe("26300");
    const size = labelPageSizeMm(proof.bitmap, proof.layout.dpi);
    expect(size.widthMm).toBeCloseTo(102, 0);
    expect(size.heightMm).toBeCloseTo(25, 0);
    const pdf = new TextDecoder("latin1").decode(labelsPdf({ bitmap: proof.bitmap, dpi: proof.layout.dpi, copies: 2, title: "TCK Garlic Mayo - pot labels" }));
    // 102 × 25 mm in points, rounded as the PDF writes them (whole dots).
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!;
    expect(Number(box[1]) / 72 * 25.4).toBeCloseTo(102, 0);
    expect(Number(box[2]) / 72 * 25.4).toBeCloseTo(25, 0);
  });

  it("a back label still renders through the back-label layout", () => {
    const proof = proofLabel(calzone(), { printDate: "2026-10-27", productionDate: "2026-10-27" }, fonts);
    expect(proof.format).toBe("back-140x94");
    expect(proof.small).toBeNull();
    expect(proof.layout.fields.length).toBeGreaterThan(0);
    expect(labelPageSizeMm(proof.bitmap, proof.layout.dpi).widthMm).toBeCloseTo(140, 0);
  });
});

describe("category defaults (migration 0280)", () => {
  const templates = [
    { id: 1, name: "Standard calzone label", defaultForCategories: ["Calzones"] },
    { id: 2, name: "Fried chicken", defaultForCategories: ["Fried Chicken"] },
    { id: 6, name: "Macaroni cheese", defaultForCategories: ["Macaroni Cheese"] },
    { id: 7, name: "Cinnamon buns", defaultForCategories: ["Desserts"] },
    { id: 8, name: "Garlic mayo", defaultForCategories: [] },
  ];
  it("each category gets its template automatically", () => {
    expect(resolveTemplateChoice(null, "Calzones", templates)).toEqual({ id: 1, reason: "category" });
    expect(resolveTemplateChoice(null, "fried chicken", templates)).toEqual({ id: 2, reason: "category" });
    expect(resolveTemplateChoice(null, "Macaroni Cheese", templates)).toEqual({ id: 6, reason: "category" });
  });
  it("the garlic mayo (no category) is set by hand; a picked template always wins", () => {
    expect(resolveTemplateChoice(null, null, templates)).toEqual({ id: null, reason: "standard" });
    expect(resolveTemplateChoice(8, null, templates)).toEqual({ id: 8, reason: "chosen" });
    expect(resolveTemplateChoice(8, "Calzones", templates)).toEqual({ id: 8, reason: "chosen" });
  });
});
