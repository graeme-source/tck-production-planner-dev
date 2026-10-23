import { describe, it, expect } from "vitest";
import { parseReadingText, cleanReadingTyping, readingRangeText, labelsFromText } from "./checklist-reading-input";

describe("parseReadingText", () => {
  it("blank is no reading, not zero", () => {
    expect(parseReadingText("")).toBeNull();
    expect(parseReadingText("   ")).toBeNull();
  });
  it("whole, decimal and negative numbers", () => {
    expect(parseReadingText("1000")).toBe(1000);
    expect(parseReadingText("999.5")).toBe(999.5);
    expect(parseReadingText("-18.25")).toBe(-18.25);
  });
  it("half-typed or junk is not a reading yet", () => {
    expect(parseReadingText("-")).toBeUndefined();
    expect(parseReadingText("10.")).toBeUndefined();
    expect(parseReadingText("1.234")).toBeUndefined();
    expect(parseReadingText("abc")).toBeUndefined();
  });
});

describe("cleanReadingTyping", () => {
  it("keeps digits, one point and a leading minus; comma = point", () => {
    expect(cleanReadingTyping("1,5")).toBe("1.5");
    expect(cleanReadingTyping("10.0.5g")).toBe("10.05");
    expect(cleanReadingTyping("-1-8")).toBe("-18");
  });
});

describe("readingRangeText", () => {
  it("reads the pass range in plain words", () => {
    expect(readingRangeText(999, 1001, "g")).toBe("Pass: 999 to 1001 g");
    expect(readingRangeText(null, 5, "°C")).toBe("Pass: up to 5 °C");
    expect(readingRangeText(0.5, null, "kg")).toBe("Pass: at least 0.5 kg");
    expect(readingRangeText(null, null, "g")).toBeNull();
  });
});

describe("labelsFromText", () => {
  it("one per line or comma-separated, blanks dropped", () => {
    expect(labelsFromText("Scale 1\nScale 2,  Prep scale\n\n")).toEqual(["Scale 1", "Scale 2", "Prep scale"]);
  });
});
