import { describe, it, expect } from "vitest";
import { fillTemplate, mayContainParagraph, parseBold, plainText } from "./text";
import { DEFAULT_TEMPLATE } from "./template";

describe("parseBold", () => {
  it("splits **allergens** into bold runs", () => {
    expect(parseBold("Wheat **Flour**, (**Milk**)")).toEqual([
      { text: "Wheat ", bold: false }, { text: "Flour", bold: true }, { text: ", (", bold: false },
      { text: "Milk", bold: true }, { text: ")", bold: false },
    ]);
  });
  it("keeps an unmatched ** as text rather than losing anything", () => {
    expect(plainText(parseBold("a **b"))).toBe("a **b");
  });
});

describe("mayContainParagraph", () => {
  it("bolds the list and adds the full stop", () => {
    const p = mayContainParagraph("May also contain traces of nuts, peanuts and milk", true);
    expect(p).toEqual([
      { text: "May also contain traces of ", bold: false },
      { text: "nuts, peanuts and milk", bold: true },
      { text: ".", bold: false },
    ]);
  });
  it("prints an unusual statement as written", () => {
    expect(plainText(mayContainParagraph("Made in a kitchen that handles nuts", true))).toBe("Made in a kitchen that handles nuts.");
  });
});

describe("fillTemplate — cooking step wording", () => {
  const step2 = DEFAULT_TEMPLATE.text.step2;
  const all = { ovenTemp: 210, fanTemp: 190, ovenMin: 18, ovenMax: 22, airTemp: 180, airMin: 12, airMax: 15 };
  it("oven and air fryer", () => {
    expect(fillTemplate(step2, all).text).toBe(
      "Cook in the oven at 210°C (190°C fan) for 18–22 minutes, or in the air fryer at 180°C for 12–15 minutes.",
    );
  });
  it("no air-fryer values → oven only, no dangling 'or'", () => {
    expect(fillTemplate(step2, { ...all, airTemp: null, airMin: null, airMax: null }).text).toBe(
      "Cook in the oven at 210°C (190°C fan) for 18–22 minutes.",
    );
  });
  it("no fan temperature → the bracket drops, the rest stays", () => {
    expect(fillTemplate(step2, { ...all, fanTemp: null, airTemp: null }).text).toBe(
      "Cook in the oven at 210°C for 18–22 minutes.",
    );
  });
  it("air fryer only", () => {
    expect(fillTemplate(step2, { ...all, ovenTemp: null }).text).toBe(
      "Cook in the air fryer at 180°C for 12–15 minutes.",
    );
  });
  it("reports blanks, fills and typos", () => {
    const r = fillTemplate("{name} at {tmep}", { name: "X" });
    expect(r.unknown).toEqual(["tmep"]);
    expect(r.filled).toEqual(["name"]);
    expect(r.text).toBe("X at {tmep}");
  });
});
