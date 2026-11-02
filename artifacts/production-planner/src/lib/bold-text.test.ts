import { describe, it, expect } from "vitest";
import { parseBold, hasBold, wrapBold } from "./bold-text";

// Regression for fix-queue #355: bold in improvement notes.
describe("parseBold", () => {
  it("leaves plain text as one unchanged run, newlines and spaces kept", () => {
    const text = "Moved the tape gun.\n\n  Saves   a walk.";
    expect(parseBold(text)).toEqual([{ text, bold: false }]);
    expect(hasBold(text)).toBe(false);
  });

  it("returns nothing for empty text", () => {
    expect(parseBold("")).toEqual([]);
    expect(hasBold(null)).toBe(false);
  });

  it("makes **x** bold", () => {
    expect(parseBold("Always **wear gloves** here")).toEqual([
      { text: "Always ", bold: false },
      { text: "wear gloves", bold: true },
      { text: " here", bold: false },
    ]);
    expect(hasBold("**x**")).toBe(true);
    expect(parseBold("**x**")).toEqual([{ text: "x", bold: true }]);
  });

  it("handles several bold runs", () => {
    expect(parseBold("**a** and **b**")).toEqual([
      { text: "a", bold: true },
      { text: " and ", bold: false },
      { text: "b", bold: true },
    ]);
  });

  it("leaves an unmatched ** exactly as typed", () => {
    expect(parseBold("2 ** 3")).toEqual([{ text: "2 ** 3", bold: false }]);
    expect(parseBold("odd **one** out **")).toEqual([
      { text: "odd ", bold: false },
      { text: "one", bold: true },
      { text: " out **", bold: false },
    ]);
  });

  it("does not bold empty marks or marks split across lines", () => {
    expect(parseBold("****")).toEqual([{ text: "****", bold: false }]);
    expect(parseBold("**line one\nline two**")).toEqual([{ text: "**line one\nline two**", bold: false }]);
  });
});

describe("wrapBold", () => {
  it("wraps the selected words and keeps them selected", () => {
    const r = wrapBold("Check the probe first", 10, 15);
    expect(r.value).toBe("Check the **probe** first");
    expect(r.value.slice(r.selectionStart, r.selectionEnd)).toBe("probe");
    expect(parseBold(r.value).find(s => s.bold)?.text).toBe("probe");
  });

  it("with nothing selected, inserts marks with the cursor between them", () => {
    const r = wrapBold("Note: ", 6, 6);
    expect(r.value).toBe("Note: ****");
    expect(r.selectionStart).toBe(8);
    expect(r.selectionEnd).toBe(8);
  });

  it("keeps edge spaces outside the marks", () => {
    const r = wrapBold("wash hands now", 4, 11);
    expect(r.value).toBe("wash **hands** now");
  });

  it("copes with a backwards or out-of-range selection", () => {
    expect(wrapBold("abc", 3, 0).value).toBe("**abc**");
    expect(wrapBold("abc", 0, 99).value).toBe("**abc**");
  });
});
