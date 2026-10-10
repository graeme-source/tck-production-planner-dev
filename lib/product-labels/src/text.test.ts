import { describe, it, expect } from "vitest";
import { fillTemplate, mayContainParagraph, parseBold, plainText, wordDiff } from "./text";
import { DEFAULT_TEMPLATE } from "./template";
import { cookingPlaceholderValues } from "./cooking";

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

describe("wordDiff", () => {
  it("shows a re-ordered deck as removed + added words", () => {
    const d = wordDiff("Chicken (40%), Wheat Flour", "Wheat Flour, Chicken (35%)");
    expect(d.filter(p => p.kind !== "removed").map(p => p.text).join("")).toBe("Wheat Flour, Chicken (35%)");
    expect(d.filter(p => p.kind !== "added").map(p => p.text).join("")).toBe("Chicken (40%), Wheat Flour");
    expect(d.some(p => p.kind === "added")).toBe(true);
  });
  it("identical texts are all 'same'", () => {
    expect(wordDiff("a b c", "a b c")).toEqual([{ text: "a b c", kind: "same" }]);
  });
});

describe("fillTemplate — the default step 2: one line per appliance, turn in the middle, halves", () => {
  const values = cookingPlaceholderValues(DEFAULT_TEMPLATE.cooking);
  it("both appliances, times halved (oven 18–22 → 9–11 + 9–11; air fryer 16–19 → 8–9 + 8–10)", () => {
    expect(fillTemplate(DEFAULT_TEMPLATE.text.steps[1], values).text).toBe(
      "**OVEN** 210°C (190°C fan): 9–11 min ➜ **TURN OVER** ➜ 9–11 min\n**AIR FRYER** 180°C: 8–9 min ➜ **TURN OVER** ➜ 8–10 min",
    );
  });
  it("a blank appliance drops its whole line", () => {
    const noAir = cookingPlaceholderValues({ ...DEFAULT_TEMPLATE.cooking, airFryerTempC: null });
    expect(fillTemplate(DEFAULT_TEMPLATE.text.steps[1], noAir).text.trim()).toBe(
      "**OVEN** 210°C (190°C fan): 9–11 min ➜ **TURN OVER** ➜ 9–11 min",
    );
    const noOven = cookingPlaceholderValues({ ...DEFAULT_TEMPLATE.cooking, ovenMinMinutes: null });
    expect(fillTemplate(DEFAULT_TEMPLATE.text.steps[1], noOven).text.trim()).toBe(
      "**AIR FRYER** 180°C: 8–9 min ➜ **TURN OVER** ➜ 8–10 min",
    );
  });
  it("placeholder names may contain digits ({ovenHalf2Min})", () => {
    expect(fillTemplate("{ovenHalf2Min}", { ovenHalf2Min: 9 }).text).toBe("9");
  });
});

describe("fillTemplate — sentence-style wording with {or}", () => {
  // The previous default step 2, still a valid way to write it.
  const step2 = "Cook[ in the oven at {ovenTemp}°C[ ({fanTemp}°C fan)] for {ovenMin}–{ovenMax} minutes]{or}[ in the air fryer at {airTemp}°C for {airMin}–{airMax} minutes].";
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
