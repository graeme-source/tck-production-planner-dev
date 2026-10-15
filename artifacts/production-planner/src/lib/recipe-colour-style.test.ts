import { describe, expect, it } from "vitest";
import { DARK_TEXT, LIGHT_TEXT, effectiveSecondary, readableTextOn, recipeColourStyle, relativeLuminance } from "./recipe-colour-style";

const RED = "#dc2626";
const YELLOW = "#facc15";

describe("recipeColourStyle — no secondary colour looks exactly as before", () => {
  it("dot and band are a plain background", () => {
    expect(recipeColourStyle(RED, null, "dot")).toEqual({ backgroundColor: RED });
    expect(recipeColourStyle(RED, undefined, "band")).toEqual({ backgroundColor: RED });
    expect(recipeColourStyle(RED, "", "dot")).toEqual({ backgroundColor: RED });
  });
  it("text is just the colour; chip is colour + border", () => {
    expect(recipeColourStyle(RED, null, "text")).toEqual({ color: RED });
    expect(recipeColourStyle(RED, null, "chip")).toEqual({ color: RED, borderColor: RED });
  });
  it("no primary → no style at all (callers keep their fallback)", () => {
    expect(recipeColourStyle(null, YELLOW, "dot")).toEqual({});
    expect(recipeColourStyle("", YELLOW, "text")).toEqual({});
  });
  it("secondary equal to the primary is ignored", () => {
    expect(effectiveSecondary(RED, RED.toUpperCase())).toBeNull();
    expect(recipeColourStyle(RED, RED, "dot")).toEqual({ backgroundColor: RED });
  });
  it("non-hex primaries (rack fallbacks, CSS vars) pass straight through", () => {
    expect(recipeColourStyle("hsl(var(--muted))", null, "dot")).toEqual({ backgroundColor: "hsl(var(--muted))" });
  });
});

describe("recipeColourStyle — a secondary colour is no longer drawn (Graeme, 2026-10-15)", () => {
  it("every shape looks exactly as with one colour", () => {
    for (const shape of ["dot", "band", "strip", "text", "chip", "fill"] as const) {
      expect(recipeColourStyle(RED, YELLOW, shape)).toEqual(recipeColourStyle(RED, null, shape));
    }
  });
  it("names are just the colour — no pill, no underline", () => {
    expect(recipeColourStyle(RED, YELLOW, "text")).toEqual({ color: RED });
  });
  it("fill keeps readable text against the primary", () => {
    expect(recipeColourStyle(YELLOW, RED, "fill")).toEqual({ backgroundColor: YELLOW, color: DARK_TEXT });
  });
});

describe("readableTextOn", () => {
  it("picks dark text on light colours and white on dark ones", () => {
    expect(readableTextOn("#ffffff")).toBe(DARK_TEXT);
    expect(readableTextOn(YELLOW)).toBe(DARK_TEXT);
    expect(readableTextOn("#000000")).toBe(LIGHT_TEXT);
    expect(readableTextOn("#1e3a8a")).toBe(LIGHT_TEXT);
    expect(readableTextOn(RED)).toBe(LIGHT_TEXT);
  });
  it("handles 3-digit hex and falls back to white for non-hex", () => {
    expect(readableTextOn("#fff")).toBe(DARK_TEXT);
    expect(readableTextOn("hsl(var(--primary))")).toBe(LIGHT_TEXT);
    expect(relativeLuminance("nope")).toBeNull();
  });
});
