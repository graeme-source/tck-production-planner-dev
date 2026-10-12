import { describe, it, expect } from "vitest";
import { formatQuantity, formatSentAt, sentToShopifyLabel } from "./format";

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

describe("formatSentAt / sentToShopifyLabel", () => {
  it("shows the stored UTC send time in London time (BST)", () => {
    // The live plan 192 record: 15:24 UTC = 16:24 in London on 12 Oct.
    expect(formatSentAt("2026-10-12T15:24:16.614Z")).toBe("12 Oct, 16:24");
  });

  it("shows GMT once the clocks go back", () => {
    expect(formatSentAt("2026-11-12T15:24:00.000Z")).toBe("12 Nov, 15:24");
  });

  it("uses London's date, not UTC's, just after midnight in summer", () => {
    expect(formatSentAt("2026-07-01T23:30:00.000Z")).toBe("2 Jul, 00:30");
  });

  it("gives nothing for a missing or broken time", () => {
    expect(formatSentAt("")).toBe("");
    expect(formatSentAt("nonsense")).toBe("");
  });

  it("reads as one sent line, with no 'send again' wording", () => {
    expect(sentToShopifyLabel({ at: "2026-10-12T15:24:16.614Z", bags: 155 }))
      .toBe("Sent to Shopify ✓ — 12 Oct, 16:24 · 155 bags");
    expect(sentToShopifyLabel({ at: "", bags: 1 })).toBe("Sent to Shopify ✓ — 1 bag");
  });
});
