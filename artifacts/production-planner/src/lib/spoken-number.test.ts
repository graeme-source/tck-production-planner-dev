import { describe, expect, it } from "vitest";
import { parseSpokenNumber } from "./spoken-number";

describe("parseSpokenNumber — a dictated stock count", () => {
  it("reads digits as the recogniser usually sends them", () => {
    expect(parseSpokenNumber("550")).toBe(550);
    expect(parseSpokenNumber("12.4")).toBe(12.4);
    expect(parseSpokenNumber("550 g")).toBe(550);
    expect(parseSpokenNumber("550g")).toBe(550);
    expect(parseSpokenNumber("12.4 kilos")).toBe(12.4);
    expect(parseSpokenNumber("1,200 grams")).toBe(1200);
    expect(parseSpokenNumber("550.")).toBe(550);
    expect(parseSpokenNumber("about 12 kg")).toBe(12);
  });
  it("reads Graeme's examples spoken as words", () => {
    expect(parseSpokenNumber("five hundred and fifty")).toBe(550);
    expect(parseSpokenNumber("Five hundred and fifty grams")).toBe(550);
    expect(parseSpokenNumber("12 point 4")).toBe(12.4);
    expect(parseSpokenNumber("twelve point four")).toBe(12.4);
    expect(parseSpokenNumber("twelve point four five kilograms")).toBe(12.45);
  });
  it("handles hundreds, thousands and teens", () => {
    expect(parseSpokenNumber("one thousand two hundred")).toBe(1200);
    expect(parseSpokenNumber("a thousand")).toBe(1000);
    expect(parseSpokenNumber("twelve hundred")).toBe(1200);
    expect(parseSpokenNumber("a hundred and five")).toBe(105);
    expect(parseSpokenNumber("forty-two")).toBe(42);
    expect(parseSpokenNumber("2 thousand 500")).toBe(2500);
  });
  it("handles halves and quarters", () => {
    expect(parseSpokenNumber("two and a half")).toBe(2.5);
    expect(parseSpokenNumber("a half")).toBe(0.5);
    expect(parseSpokenNumber("point five")).toBe(0.5);
    expect(parseSpokenNumber("three quarters")).toBe(0.75);
    expect(parseSpokenNumber("one and three quarters")).toBe(1.75);
    expect(parseSpokenNumber("a quarter")).toBe(0.25);
  });
  it("zero is a real count", () => {
    expect(parseSpokenNumber("zero")).toBe(0);
    expect(parseSpokenNumber("0")).toBe(0);
    expect(parseSpokenNumber("none")).toBe(0);
  });
  it("won't guess at things it can't read", () => {
    expect(parseSpokenNumber("")).toBeNull();
    expect(parseSpokenNumber(null)).toBeNull();
    expect(parseSpokenNumber("grams")).toBeNull();
    expect(parseSpokenNumber("loads of basil")).toBeNull();
    expect(parseSpokenNumber("5 500")).toBeNull();
    expect(parseSpokenNumber("twelve point")).toBeNull();
  });
});
