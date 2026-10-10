import { describe, it, expect } from "vitest";
import { buildLabelContent } from "./content";
import { labelDates } from "./dates";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, type RecipeLabelSettings } from "./snapshot";
import { DEFAULT_TEMPLATE, normaliseTemplate } from "./template";
import { plainText } from "./text";

function content(settings: Partial<RecipeLabelSettings> = {}, deck = "Chicken, **Wheat** Flour") {
  const s = buildSnapshot({
    recipe: { name: "Chicken & Chorizo", packSize: "2.0000", shelfLifeDays: 13 },
    deck: { deckText: deck, mayContainStatement: "May also contain traces of nuts and milk" },
    settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode: "5065018206009", ...settings },
    templateId: 1,
    template: normaliseTemplate(DEFAULT_TEMPLATE),
  });
  const d = labelDates({ printDate: "2026-10-10", productionDate: "2026-10-10", chilled: s.chilled, frozen: s.frozen, batchBasis: "production-day" });
  return buildLabelContent(s, d);
}

describe("label content", () => {
  it("builds Graeme's label text", () => {
    const c = content();
    expect(plainText(c.title[0])).toBe("Chicken & Chorizo - 2 PACK");
    expect(plainText(c.steps[0][0])).toBe("Remove the film but leave the calzones in the wooden tray.");
    // Step 2: two lines, kept whole (non-breaking spaces), times halved.
    const nb = (s: string) => s.replace(/ /g, " ");
    expect(c.steps[1].map(p => nb(plainText(p)))).toEqual([
      "OVEN 210°C (190°C fan): 9–11 min ➜ TURN OVER ➜ 9–11 min",
      "AIR FRYER 180°C: 8–9 min ➜ TURN OVER ➜ 8–10 min",
    ]);
    // OVEN / AIR FRYER / TURN OVER are bold.
    const bold = c.steps[1].flatMap(p => p.filter(r => r.bold).map(r => nb(r.text)));
    expect(bold).toEqual(["OVEN", "TURN OVER", "AIR FRYER", "TURN OVER"]);
    expect(plainText(c.steps[2][0])).toBe("Check they're piping hot throughout before serving.");
    expect(c.dates.map(plainText)).toEqual(["IF CHILLED USE BY: 23/10/26", "IF FROZEN USE BY: 10/04/27", "BATCH NUMBER: 26283"]);
    expect(c.allergenInfo.map(plainText)).toEqual([
      "Allergens are shown in Bold.",
      "May also contain traces of nuts and milk.",
      "WARNING: Whilst every effort has been made to remove all bones, some may remain.",
    ]);
    expect(c.problems).toEqual([]);
  });

  it("no air fryer → only the oven line", () => {
    const s = content({ airFryerOn: false }).steps[1];
    expect(s).toHaveLength(1);
    expect(plainText(s[0]).replace(/ /g, " ")).toBe("OVEN 210°C (190°C fan): 9–11 min ➜ TURN OVER ➜ 9–11 min");
  });

  it("single-line wording still wraps normally (ordinary spaces)", () => {
    expect(plainText(content().steps[0][0])).not.toContain(" ");
  });

  it("warning off leaves it out", () => {
    expect(content({ warningOn: false }).allergenInfo).toHaveLength(2);
  });

  it("blocks publishing with no cooking values, a bad barcode or an empty deck", () => {
    const c = content({ ovenOn: false, airFryerOn: false, barcode: "5065018206008" }, "");
    expect(c.problems.some(p => p.includes("Step 2 has no cooking values"))).toBe(true);
    expect(c.problems.some(p => p.includes("Barcode number isn't valid"))).toBe(true);
    expect(c.problems.some(p => p.includes("deck is empty"))).toBe(true);
  });

  it("flags minutes that run backwards", () => {
    const c = content({ cooking: { ...DEFAULT_RECIPE_LABEL_SETTINGS.cooking, ovenMinMinutes: 25 } });
    expect(c.problems.some(p => p.includes("Oven minutes run backwards"))).toBe(true);
  });
});
