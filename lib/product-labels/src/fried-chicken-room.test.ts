/**
 * Korean Fried Chicken outgrew its label (Graeme, 2026-10-27): the deck got
 * longer and the address no longer fitted at the bottom of the ingredients
 * column. The Fried chicken template now runs the allergen note on after
 * the may-contain sentence and closes the ingredients column's gaps to
 * 1.5 mm (migration 0330 + friedChickenTemplate). Nothing is printed smaller
 * than it was already allowed to go, and no other template changes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allergenParagraphs } from "./content";
import { checkLabel } from "./render";
import { loadBundledFonts } from "./node-fonts";
import { diffSnapshots, snapshotKey, type LabelSnapshot } from "./snapshot";
import { DEFAULT_TEMPLATE, friedChickenTemplate, normaliseTemplate, TEMPLATE_PRESETS, type LabelTemplate } from "./template";
import { layoutLabel } from "./layout";
import { buildLabelContent } from "./content";
import { labelDates } from "./dates";

const fonts = loadBundledFonts();
const when = { printDate: "2026-10-27", productionDate: "2026-10-27" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;

/** Recipe 29 as built from the local copy of live, with the Fried chicken
 *  template as it was stored before 0330. */
const korean500 = fixture<{ snapshot: LabelSnapshot }>("korean-fried-chicken-500g.json").snapshot;
const korean1200: LabelSnapshot = { ...korean500, recipeName: "Korean Fried Chicken 1.2kg", labelName: "Korean Fried Chicken 1.2kg", netQuantity: "1.2kg" };

/** Live's deck may already be longer than the local copy's: lengthen it by
 *  `pct` (more sauce ingredients, some of them allergens in bold). */
function longerDeck(s: LabelSnapshot, pct: number): LabelSnapshot {
  const base = s.deckText.replace(/\.$/, "");
  const want = Math.round((base.length * pct) / 100);
  const more = "Rice Vinegar, Sesame Oil (**Sesame**), Spring Onion, Ginger, Brown Sugar, Toasted **Sesame** Seeds, Garlic Powder, Onion Powder, Chilli Flakes, Modified Maize Starch, Acidity Regulator (Citric Acid), ";
  let add = "";
  while (add.length < want) add += more;
  return { ...s, deckText: `${base}, ${add.slice(0, want).replace(/[ ,]+\S*$/, "")}.` };
}

/** The stored template with exactly what migration 0330 sets. */
function migrated(t: LabelTemplate): LabelTemplate {
  const raw = JSON.parse(JSON.stringify(t)) as Record<string, unknown> & { page: Record<string, unknown> };
  raw.page.ingredientsGapMm = 1.5;
  raw.allergenNoteAfterMayContain = true;
  return normaliseTemplate(raw);
}

/** …and then exactly what migration 0332 sets. */
function migrated0332(t: LabelTemplate): LabelTemplate {
  const raw = JSON.parse(JSON.stringify(migrated(t))) as Record<string, unknown> & { page: Record<string, unknown> };
  raw.page.bandGapMm = 2;
  raw.page.columnSplitPct = 38;
  raw.page.barcodeSizePct = 114;
  return normaliseTemplate(raw);
}

const withTemplate = (s: LabelSnapshot, t: LabelTemplate): LabelSnapshot => ({ ...s, template: t });
const field = (s: LabelSnapshot, key: string) => checkLabel(s, when, fonts).layout.fields.find(f => f.key === key)!;
const mm = (dots: number) => (dots * 25.4) / 203;

describe("Korean fried chicken: the address fits again", () => {
  it("before: a 20% longer deck pushed the address off the bottom", () => {
    const before = checkLabel(longerDeck(korean500, 20), when, fonts).layout;
    expect(before.fits).toBe(false);
    expect(before.problems.map(p => p.field)).toEqual(["address"]);
  });

  for (const [name, t] of [["the live template after 0330", migrated(korean500.template)], ["the live template after 0332", migrated0332(korean500.template)], ["the preset", friedChickenTemplate()]] as const) {
    describe(`with ${name}`, () => {
      it("500g, 1.2kg and a 20% longer deck all fit with no problems", () => {
        for (const s of [korean500, korean1200, longerDeck(korean500, 20), longerDeck(korean1200, 20)]) {
          const { layout } = checkLabel(withTemplate(s, t), when, fonts);
          expect(layout.problems).toEqual([]);
          expect(layout.fits).toBe(true);
        }
      });

      it("the 20% longer deck still has room to spare above the address", () => {
        const { layout } = checkLabel(withTemplate(longerDeck(korean500, 20), t), when, fonts);
        const allergen = layout.fields.find(f => f.key === "allergenInfo")!;
        const address = layout.fields.find(f => f.key === "address")!;
        const spare = address.boxes[0].y - (allergen.boxes[0].y + allergen.usedHeight) - (1.5 * 203) / 25.4;
        expect(mm(spare)).toBeGreaterThan(1);
      });

      it("nothing goes below what it was already allowed: ingredients, allergens and address at 6.75 pt or more; headings 12.5 pt", () => {
        const s = withTemplate(longerDeck(korean500, 20), t);
        for (const k of ["ingredients", "allergenInfo", "address"]) expect(field(s, k).sizePt).toBeGreaterThanOrEqual(6.75);
        for (const k of ["ingredients", "allergenInfo", "address"]) expect(field(s, k).xHeightMm).toBeGreaterThanOrEqual(1.2);
        expect(field(s, "headings").sizePt).toBe(12.5);
        // The address keeps its own width rules (never condensed).
        expect(field(s, "address").width).not.toBe("condensed");
      });

      it("the local deck now prints bigger than before (it was at the 6.75 pt floor)", () => {
        expect(field(korean500, "ingredients").sizePt).toBe(6.75);
        expect(field(withTemplate(korean500, t), "ingredients").sizePt).toBeGreaterThan(6.75);
      });

      it("allergens stay bold and the note runs on after the may-contain sentence", () => {
        const c = buildLabelContent(withTemplate(korean500, t), labelDates({ ...when, chilled: korean500.chilled, frozen: korean500.frozen, batchBasis: "production-day" }));
        expect(c.allergenInfo).toHaveLength(1);
        const text = c.allergenInfo[0].map(r => r.text).join("");
        expect(text).toBe("May also contain traces of nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk. For allergens, see ingredients in bold.");
        expect(c.allergenInfo[0].filter(r => r.bold).map(r => r.text)).toEqual(["nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk", "bold"]);
        expect(c.ingredients[0].some(r => r.bold && /milk/i.test(r.text))).toBe(true);
        // The storage side is untouched: FREEZE ON ARRIVAL and "Delivered chilled".
        expect(c.storageBanner).toBe("FREEZE ON ARRIVAL");
        expect(c.storage[0].map(r => r.text).join("")).toMatch(/^Delivered chilled — that's how it should arrive\./);
      });

      it.skipIf(name !== "the live template after 0330")("the storage column keeps its 3 mm gaps and lays out exactly as before", () => {
        const before = checkLabel(korean500, when, fonts).layout;
        const after = checkLabel(withTemplate(korean500, t), when, fonts).layout;
        for (const k of ["storage", "dates", "title", "steps"]) {
          expect(after.fields.find(f => f.key === k)).toEqual(before.fields.find(f => f.key === k));
        }
        expect(after.barcode).toEqual(before.barcode);
        expect(after.banner).toEqual(before.banner);
      });
    });
  }

  it("the migrated live template matches the preset on the two new settings", () => {
    const m = migrated(korean500.template);
    const p = friedChickenTemplate();
    expect(m.page.ingredientsGapMm).toBe(p.page.ingredientsGapMm);
    expect(m.allergenNoteAfterMayContain).toBe(p.allergenNoteAfterMayContain);
    const sql = readFileSync(new URL("../../db/migrations/0330_fried_chicken_ingredients_room.sql", import.meta.url), "utf8");
    expect(sql).toContain(`'{page,ingredientsGapMm}', '${p.page.ingredientsGapMm}'`);
    expect(sql).toContain(`'{allergenNoteAfterMayContain}', 'true'`);
  });

  it("the change shows as a template change on the label's publish check", () => {
    const keys = diffSnapshots(korean500, withTemplate(korean500, migrated(korean500.template))).map(c => c.key);
    expect(keys).toEqual(expect.arrayContaining(["template.page", "template.allergenNoteAfterMayContain"]));
  });
});

describe("no other template changes", () => {
  it("every other preset and older stored templates leave both settings off", () => {
    for (const p of TEMPLATE_PRESETS.filter(x => x.key !== "fried-chicken")) {
      const t = p.build();
      expect(t.page.ingredientsGapMm).toBeNull();
      expect(t.allergenNoteAfterMayContain).toBe(false);
    }
    const old = normaliseTemplate({});
    expect(old.page.ingredientsGapMm).toBeNull();
    expect(old.allergenNoteAfterMayContain).toBe(false);
  });

  it("off = exactly the old layout (an unset gap is the field gap; the note keeps its own line)", () => {
    const s = fixture<{ snapshot: LabelSnapshot }>("live-snapshot-chicken-chorizo.json").snapshot;
    const t = normaliseTemplate(s.template);
    const content = buildLabelContent(withTemplate(s, t), labelDates({ ...when, chilled: s.chilled, frozen: s.frozen, batchBasis: t.batchBasis }));
    expect(content.allergenInfo.length).toBeGreaterThanOrEqual(2);
    const explicit = normaliseTemplate({ ...t, page: { ...t.page, ingredientsGapMm: t.page.fieldGapMm } });
    expect(layoutLabel(explicit, content, fonts)).toEqual(layoutLabel(t, content, fonts));
  });

  it("published hashes are unchanged: Chicken & Chorizo, and the Korean label read through today's code", () => {
    const fx = fixture<{ hash: string; snapshot: LabelSnapshot }>("live-snapshot-chicken-chorizo.json");
    expect(sha(snapshotKey(fx.snapshot))).toBe(fx.hash);
    expect(sha(snapshotKey({ ...fx.snapshot, template: normaliseTemplate(fx.snapshot.template) }))).toBe(fx.hash);
    // The pre-0330 Korean snapshot and the same read through the normaliser
    // (which now adds the two settings, off) compare equal.
    expect(snapshotKey({ ...korean500, template: normaliseTemplate(korean500.template) })).toBe(snapshotKey(korean500));
    expect(snapshotKey({ ...fx.snapshot, template: { ...fx.snapshot.template, allergenNoteAfterMayContain: false } as LabelTemplate })).toBe(snapshotKey(fx.snapshot));
  });

  it("the standard template is untouched", () => {
    expect(DEFAULT_TEMPLATE.page.ingredientsGapMm).toBeNull();
    expect(DEFAULT_TEMPLATE.allergenNoteAfterMayContain).toBe(false);
  });
});

describe("allergenParagraphs", () => {
  const note = "For allergens, see ingredients in **bold**.";
  const may = "May also contain traces of nuts and milk";
  it("on its own line by default", () => {
    expect(allergenParagraphs(note, may, true, false).map(p => p.map(r => r.text).join(""))).toEqual([
      "For allergens, see ingredients in bold.", "May also contain traces of nuts and milk.",
    ]);
  });
  it("run on after the statement when asked", () => {
    expect(allergenParagraphs(note, may, true, true).map(p => p.map(r => r.text).join(""))).toEqual([
      "May also contain traces of nuts and milk. For allergens, see ingredients in bold.",
    ]);
  });
  it("no statement: the note alone either way", () => {
    for (const after of [false, true]) {
      expect(allergenParagraphs(note, null, true, after).map(p => p.map(r => r.text).join(""))).toEqual(["For allergens, see ingredients in bold."]);
    }
  });
});

/** Live's deck was longer than the local copy: 0330 alone still left the
 *  address 0.9 mm over on the live 1.2kg label (Graeme's screenshot,
 *  2026-10-27). 0332 widens the ingredients column and closes the band
 *  gaps, with nothing printed smaller. */
describe("0332: room for live's longer Korean deck", () => {
  const after0330 = migrated(korean500.template);
  const after0332 = migrated0332(korean500.template);

  it("before: 0330 alone leaves the address 0.9 mm over on a 30% longer deck (as on live)", () => {
    const { layout } = checkLabel(withTemplate(longerDeck(korean1200, 30), after0330), when, fonts);
    expect(layout.fits).toBe(false);
    expect(layout.problems.map(p => p.message)).toEqual([expect.stringMatching(/^Address runs 0\.9 mm past the bottom of its column/)]);
  });

  for (const [name, t] of [["the live template after 0332", after0332], ["the preset", friedChickenTemplate()]] as const) {
    it(`${name}: 500g and 1.2kg fit with decks up to 40% longer`, () => {
      for (const s of [korean500, korean1200]) {
        for (const pct of [0, 30, 35, 40]) {
          const { layout } = checkLabel(withTemplate(longerDeck(s, pct), t), when, fonts);
          expect({ pct, problems: layout.problems }).toEqual({ pct, problems: [] });
        }
      }
    });
  }

  it("nothing prints smaller than after 0330: steps, storage and the deck the same size or bigger", () => {
    for (const pct of [0, 30]) {
      const a = withTemplate(longerDeck(korean1200, pct), after0330);
      const b = withTemplate(longerDeck(korean1200, pct), after0332);
      for (const k of ["title", "steps", "storage", "dates", "ingredients", "allergenInfo", "address", "headings"]) {
        expect(field(b, k).sizePt).toBeGreaterThanOrEqual(field(a, k).sizePt);
      }
      expect(field(b, "steps").sizePt).toBe(field(a, "steps").sizePt);
    }
    // The live deck (about 30% longer) prints above the 6.75 pt floor.
    expect(field(withTemplate(longerDeck(korean1200, 30), after0332), "ingredients").sizePt).toBeGreaterThan(6.75);
  });

  it("the barcode prints at 114% (3-dot bars), above the standard size, with no barcode problem", () => {
    const { layout } = checkLabel(withTemplate(korean1200, after0332), when, fonts);
    expect(layout.problems.filter(p => p.field === "barcode")).toEqual([]);
    expect(layout.barcode.module).toMatchObject({ ok: true, moduleDots: 3, magnificationPct: 114 });
  });

  it("the migration sets exactly what the preset has, and only while the old values are there", () => {
    const p = friedChickenTemplate();
    expect(after0332.page).toEqual(p.page);
    const sql = readFileSync(new URL("../../db/migrations/0332_fried_chicken_more_ingredient_room.sql", import.meta.url), "utf8");
    expect(sql).toContain(`'{page,bandGapMm}', '${p.page.bandGapMm}'`);
    expect(sql).toContain(`'{page,columnSplitPct}', '${p.page.columnSplitPct}'`);
    expect(sql).toContain(`'{page,barcodeSizePct}', '${p.page.barcodeSizePct}'`);
    expect(sql).toMatch(/lower\(trim\(name\)\) = 'fried chicken'/);
    for (const [k, v] of [["bandGapMm", 3], ["columnSplitPct", 41], ["barcodeSizePct", 151]] as const) {
      expect(korean500.template.page[k]).toBe(v);
      expect(sql).toContain(`settings -> 'page' -> '${k}' = '${v}'::jsonb`);
    }
  });
});
