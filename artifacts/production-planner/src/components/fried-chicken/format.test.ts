import { describe, it, expect } from "vitest";
import { formatQuantity } from "./format";

describe("formatQuantity", () => {
  it("reads grams in kilos once there is a kilo of them", () => {
    expect(formatQuantity(74771, "g")).toBe("74.77 kg");
    expect(formatQuantity(1000, "g")).toBe("1 kg");
  });

  it("leaves small weights in grams", () => {
    expect(formatQuantity(250, "g")).toBe("250 g");
    expect(formatQuantity(999, "g")).toBe("999 g");
  });

  it("reads millilitres in litres the same way", () => {
    expect(formatQuantity(2500, "ml")).toBe("2.5 L");
    expect(formatQuantity(400, "ml")).toBe("400 ml");
  });

  it("leaves units it doesn't know alone", () => {
    expect(formatQuantity(12, "each")).toBe("12 each");
    expect(formatQuantity(3000, "kg")).toBe("3000 kg");
  });

  it("drops trailing zeros rather than printing 3.00 kg", () => {
    expect(formatQuantity(3000, "g")).toBe("3 kg");
    expect(formatQuantity(3500, "g")).toBe("3.5 kg");
  });

  it("survives a missing unit and a non-number", () => {
    expect(formatQuantity(5, "")).toBe("5");
    expect(formatQuantity(Number.NaN, "g")).toBe("0 g");
  });
});
