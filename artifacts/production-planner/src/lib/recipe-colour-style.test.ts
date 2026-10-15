import { describe, expect, it } from "vitest";
import { DARK_TEXT, LIGHT_TEXT, PILL_BLACK, PILL_LIGHT, effectiveSecondary, readableTextOn, recipeColourStyle, relativeLuminance } from "./recipe-colour-style";

const RED = "#dc2626";
const YELLOW = "#facc15";

describe("recipeColourStyle — no secondary colour looks exactly as before", () => {
  it("dot and band are a plain background", () => {
    expect(recipeColourStyle(RED, null, "dot")).toEqual({ backgroundColor: RED });
    expect(recipeColourStyle(RED, undefined, "band")).toEqual({ backgroundColor: RED });
    expect(recipeColourStyle(RED, "", "dot")).toEqual({ backgroundColor: RED });
  });
  it("text is just the colour; chip is colour + border", () => {
    expect(recipeColourStyle(RED, null, "text")).toMatchObject({ color: RED, backgroundColor: PILL_BLACK });
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

describe("recipeColourStyle — with a secondary colour", () => {
  it("dot splits diagonally, primary first, hard edge (no blend)", () => {
    expect(recipeColourStyle(RED, YELLOW, "dot")).toEqual({
      background: `linear-gradient(135deg, ${RED} 0 50%, ${YELLOW} 50% 100%)`,
    });
  });
  it("band stacks primary over secondary", () => {
    expect(recipeColourStyle(RED, YELLOW, "band")).toEqual({
      background: `linear-gradient(to bottom, ${RED} 0 50%, ${YELLOW} 50% 100%)`,
    });
  });
  it("strip puts primary left, secondary right; plain without one", () => {
    expect(recipeColourStyle(RED, YELLOW, "strip")).toEqual({
      background: `linear-gradient(to right, ${RED} 0 50%, ${YELLOW} 50% 100%)`,
    });
    expect(recipeColourStyle(RED, null, "strip")).toEqual({ backgroundColor: RED });
  });
  it("text is a pill: two colours → secondary background, primary text; never an underline (2026-10-15)", () => {
    const s = recipeColourStyle(RED, YELLOW, "text");
    expect(s.color).toBe(RED);
    expect(s.backgroundColor).toBe(YELLOW);
    expect(s.borderRadius).toBe("9999px");
    expect(s.textDecorationLine).toBeUndefined();
  });
  it("one colour → the colour on black; a near-black colour gets a light pill", () => {
    expect(recipeColourStyle(RED, null, "text").backgroundColor).toBe(PILL_BLACK);
    expect(recipeColourStyle("#000000", null, "text").backgroundColor).toBe(PILL_LIGHT);
  });
  it("chip keeps a primary border, filled with the secondary", () => {
    const s = recipeColourStyle(RED, YELLOW, "chip");
    expect(s.borderColor).toBe(RED);
    expect(s.backgroundColor).toBe(YELLOW);
    expect(s.textDecorationLine).toBeUndefined();
  });
  it("fill is the primary with a secondary band, text against the primary", () => {
    const s = recipeColourStyle(YELLOW, RED, "fill");
    expect(s.backgroundColor).toBe(YELLOW);
    expect(s.color).toBe(DARK_TEXT);
    expect(s.boxShadow).toBe(`inset 0 -6px 0 0 ${RED}`);
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
