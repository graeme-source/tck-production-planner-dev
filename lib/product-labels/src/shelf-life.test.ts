/**
 * One source of truth for shelf life, and a recipe's wrapping vs despatch
 * labels (Graeme, 2026-10-27). Objective D.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { normaliseUseByRule, resolveChilledPeriod, useByIgnoresShelfLife } from "./shelf-life";
import { labelRoleTitle, normaliseLabelRole, wrappingStationRole, wrappingTemplateChoice } from "./label-roles";
import {
  cinnamonBunsTemplate, DEFAULT_TEMPLATE, friedChickenTemplate, garlicMayoTemplate, internalFreezerTemplate, macaroniCheeseTemplate,
  normaliseTemplate, TEMPLATE_PRESETS, type LabelTemplate,
} from "./template";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, diffSnapshots, snapshotKey, snapshotsMatch, type LabelSnapshot } from "./snapshot";
import { labelFormat } from "./formats";
import { buildLabelContent } from "./content";
import { buildSmallLabelContent } from "./small-label";
import { labelDates } from "./dates";
import { loadBundledFonts } from "./node-fonts";
import { proofLabel } from "./render";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const copy = (t: LabelTemplate): LabelTemplate => normaliseTemplate(JSON.parse(JSON.stringify(t)));
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as { hash: string; snapshot: LabelSnapshot };

describe("shelf life → chilled use-by: one source of truth", () => {
  const standard = copy(DEFAULT_TEMPLATE);
  it("the recipe's shelf life is the use-by period", () => {
    expect(resolveChilledPeriod(standard, 10)).toEqual({ period: { amount: 10, unit: "days" }, source: "recipe-shelf-life" });
  });
  it("a recipe with no shelf life falls back to the template's standard (13 days)", () => {
    expect(resolveChilledPeriod(standard, null)).toEqual({ period: { amount: 13, unit: "days" }, source: "template-standard" });
    expect(resolveChilledPeriod(standard, 0)).toEqual({ period: { amount: 13, unit: "days" }, source: "template-standard" });
    expect(resolveChilledPeriod({ ...standard, chilledDefault: null }, null)).toEqual({ period: null, source: "none" });
  });
  it("a despatch template counts its own period from despatch and ignores the recipe's shelf life", () => {
    const buns = cinnamonBunsTemplate();
    expect(useByIgnoresShelfLife(buns)).toBe(true);
    expect(useByIgnoresShelfLife(standard)).toBe(false);
    expect(resolveChilledPeriod(buns, 180)).toEqual({ period: { amount: 5, unit: "days" }, source: "despatch" });
    expect(resolveChilledPeriod(buns, null).source).toBe("despatch");
  });
  it("changing the recipe's shelf life changes the label — and nothing else can (no label-only override)", () => {
    const make = (shelf: number) => buildSnapshot({
      recipe: { name: "Margherita", packSize: "2", shelfLifeDays: shelf },
      deck: { deckText: "**Wheat** Flour", mayContainStatement: null },
      settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode: "5065018206009" },
      templateId: 1, template: copy(DEFAULT_TEMPLATE),
    });
    expect(make(13).chilled).toEqual({ amount: 13, unit: "days" });
    expect(diffSnapshots(make(13), make(10)).map(c => c.key)).toEqual(["chilled"]);
    expect("chilled" in DEFAULT_RECIPE_LABEL_SETTINGS).toBe(false);
  });
  it("normalises stored rules: anything odd is the recipe's shelf life", () => {
    expect(normaliseUseByRule(undefined)).toEqual({ from: "recipe-shelf-life" });
    expect(normaliseUseByRule({ from: "despatch" })).toEqual({ from: "recipe-shelf-life" });
    expect(normaliseUseByRule({ from: "despatch", period: { amount: 0, unit: "days" } })).toEqual({ from: "recipe-shelf-life" });
    expect(normaliseUseByRule({ from: "despatch", period: { amount: 5, unit: "weeks" } })).toEqual({ from: "despatch", period: { amount: 5, unit: "weeks" } });
    expect(normaliseTemplate({}).useBy).toEqual({ from: "recipe-shelf-life" });
    expect(normaliseTemplate({ useBy: { from: "despatch", period: { amount: 5, unit: "days" } } }).useBy).toEqual({ from: "despatch", period: { amount: 5, unit: "days" } });
  });
  it("only the cinnamon buns preset counts from despatch", () => {
    for (const p of TEMPLATE_PRESETS) expect(p.build().useBy.from).toBe(p.key === "cinnamon-buns" ? "despatch" : "recipe-shelf-life");
  });
});

describe("Cinnamon Buns (recipe 27, shelf life 180, pack 6) after migrations 0310–0311", () => {
  const fonts = loadBundledFonts();
  const printed = { printDate: "2026-10-27", productionDate: "2026-10-27" };
  const recipe = { name: "Cinnamon Buns", packSize: "6", shelfLifeDays: 180 };
  const deck = { deckText: "Bun Dough (00 Flour (**Wheat**)), Salted **Butter**", mayContainStatement: null };
  const settings = { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode: "5065018206795" };
  const text = (ps: { text: string }[][]) => ps.map(p => p.map(r => r.text).join(""));

  it("despatch label printed 27 Oct: BEST BEFORE 30/10/26, USE BY 01/11/26", () => {
    const s = buildSnapshot({ recipe, deck, settings, templateId: 7, template: cinnamonBunsTemplate() });
    const d = labelDates({ ...printed, chilled: s.chilled, frozen: s.frozen, batchBasis: s.template.batchBasis });
    expect(text(buildLabelContent(s, d).dates).slice(0, 2)).toEqual(["BEST BEFORE: 30/10/26", "USE BY: 01/11/26"]);
  });
  it("internal freezer label printed 27 Oct: name, USE BY 25/04/27 (27 Oct + 180 days), batch, no barcode", () => {
    const s = buildSnapshot({ recipe, deck, settings, templateId: 9, template: internalFreezerTemplate() });
    expect(s.barcode).toBeNull();
    const d = labelDates({ ...printed, chilled: s.chilled, frozen: null, batchBasis: s.template.batchBasis });
    const c = buildSmallLabelContent(s, d);
    expect(c.problems).toEqual([]);
    expect(c.input).toEqual({ name: "Cinnamon Buns", useBy: "25/04/27", batch: "26300", barcode: null });
    const proof = proofLabel(s, printed, fonts);
    expect(proof.format).toBe("small-102x25");
    expect(proof.layout.fits).toBe(true);
    expect(proof.small?.layout.barcode).toBeNull();
  });
  it("the internal freezer template: small format, barcode off, shelf life from the recipe", () => {
    const t = internalFreezerTemplate();
    expect(labelFormat(t).key).toBe("small-102x25");
    expect(t.barcodeOn).toBe(false);
    expect(t.useBy).toEqual({ from: "recipe-shelf-life" });
    expect(t.chilledDefault).toBeNull();
    // Building it never changes the garlic mayo preset it starts from.
    expect(garlicMayoTemplate().barcodeOn).toBe(true);
  });
});

describe("published labels keep their hashes", () => {
  it("Chicken and Chorizo (back label) — live snapshot and the current one read through today's template", () => {
    const fx = fixture("live-snapshot-chicken-chorizo.json");
    expect(sha(snapshotKey(fx.snapshot))).toBe(fx.hash);
    const current = { ...fx.snapshot, template: normaliseTemplate(fx.snapshot.template) };
    expect(current.template.useBy).toEqual({ from: "recipe-shelf-life" });
    expect(current.template.barcodeOn).toBe(true);
    expect(sha(snapshotKey(current))).toBe(fx.hash);
  });
  it("TCK Garlic Mayo (small label) — the same", () => {
    const fx = fixture("live-snapshot-garlic-mayo.json");
    expect(sha(snapshotKey(fx.snapshot))).toBe(fx.hash);
    expect(sha(snapshotKey({ ...fx.snapshot, template: normaliseTemplate(fx.snapshot.template) }))).toBe(fx.hash);
  });
  it("fried chicken and mac cheese still take the recipe's shelf life exactly as before", () => {
    for (const t of [friedChickenTemplate(), macaroniCheeseTemplate()]) {
      const s = buildSnapshot({ recipe: { name: "X", packSize: "1", shelfLifeDays: 8 }, deck: { deckText: "Y", mayContainStatement: null }, settings: DEFAULT_RECIPE_LABEL_SETTINGS, templateId: 2, template: t });
      expect(s.chilled).toEqual({ amount: 8, unit: "days" });
      const { useBy: _u, barcodeOn: _b, ...legacy } = s.template;
      expect(snapshotsMatch(s, { ...s, template: legacy as LabelTemplate })).toBe(true);
    }
  });
  it("switching a template to count from despatch IS a change (listed as such)", () => {
    const base = buildSnapshot({ recipe: { name: "X", packSize: "6", shelfLifeDays: 5 }, deck: { deckText: "Y", mayContainStatement: null }, settings: DEFAULT_RECIPE_LABEL_SETTINGS, templateId: 7, template: copy(DEFAULT_TEMPLATE) });
    const t = copy(DEFAULT_TEMPLATE);
    t.useBy = { from: "despatch", period: { amount: 5, unit: "days" } };
    const despatch = { ...base, template: t };
    expect(snapshotsMatch(base, despatch)).toBe(false);
    expect(diffSnapshots(base, despatch).map(c => c.key)).toContain("template.useBy");
  });
});

describe("wrapping vs despatch labels", () => {
  it("no wrapping label: the wrapping station prints the main (back) label, as for calzones", () => {
    expect(wrappingTemplateChoice(null, [1, 7, 9])).toBeNull();
    expect(wrappingStationRole(false)).toBe("main");
    expect(labelRoleTitle("main", false)).toBe("Back label");
  });
  it("a wrapping label: the station prints it; the main one becomes the despatch label", () => {
    expect(wrappingTemplateChoice(9, [1, 7, 9])).toBe(9);
    expect(wrappingStationRole(true)).toBe("wrapping");
    expect(labelRoleTitle("main", true)).toBe("Despatch label");
    expect(labelRoleTitle("wrapping", true)).toBe("Wrapping label");
  });
  it("a deleted wrapping template counts as none; roles normalise to main", () => {
    expect(wrappingTemplateChoice(42, [1, 7, 9])).toBeNull();
    expect(normaliseLabelRole("wrapping")).toBe("wrapping");
    expect(normaliseLabelRole("anything")).toBe("main");
    expect(normaliseLabelRole(undefined)).toBe("main");
  });
});
