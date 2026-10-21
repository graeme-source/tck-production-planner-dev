import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHASE_COLOUR, MIN_TEXT_CONTRAST, PHASE_COLOURS, PHASE_COLOUR_KEYS, contrastRatio, isHexColour, isPhaseColour,
  isStoredPhaseColour, mixHex, normalisePhaseColour, phaseColour, phaseColourLabel, readableTextOn, relativeLuminance,
  tonesFromHex,
} from "./phase-colours";
import { describeFieldChanges } from "./history";

describe("phase colours — the pastel palette", () => {
  it("has eight light pastels, each defined once with its key", () => {
    expect(PHASE_COLOUR_KEYS).toHaveLength(8);
    for (const k of PHASE_COLOUR_KEYS) expect(PHASE_COLOURS[k].key).toBe(k);
  });

  it("no colour (or an unknown one) with no calendar default is soft lavender", () => {
    expect(DEFAULT_PHASE_COLOUR).toBe("lavender");
    expect(phaseColour(null).key).toBe("lavender");
    expect(phaseColour(undefined).key).toBe("lavender");
    expect(phaseColour("violet-600").key).toBe("lavender");
    expect(phaseColour("sky").key).toBe("sky");
    expect(phaseColourLabel("mint")).toBe("Mint");
    expect(isPhaseColour("peach")).toBe(true);
    expect(isPhaseColour("")).toBe(false);
  });

  it("the fills really are light (in light mode), much lighter than the old violet-600 bar", () => {
    for (const k of PHASE_COLOUR_KEYS) expect(relativeLuminance(PHASE_COLOURS[k].light.bg)).toBeGreaterThan(0.75);
    expect(relativeLuminance("#7c3aed")).toBeLessThan(0.15); // the old bar
  });

  it("text is easy to read on its fill, in light and dark mode", () => {
    for (const k of PHASE_COLOUR_KEYS) {
      const c = PHASE_COLOURS[k];
      expect(contrastRatio(c.light.text, c.light.bg), `${k} light`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(c.dark.text, c.dark.bg), `${k} dark`).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("phase colours — any colour from the picker", () => {
  it("accepts palette keys (back-compat) and #rrggbb, nothing else", () => {
    expect(isStoredPhaseColour("sky")).toBe(true);
    expect(isStoredPhaseColour("#2E86C1")).toBe(true);
    expect(isStoredPhaseColour("#2e86c")).toBe(false);
    expect(isStoredPhaseColour("2e86c1")).toBe(false);
    expect(isStoredPhaseColour("red")).toBe(false);
    expect(isHexColour("#ABCDEF")).toBe(true);
    expect(normalisePhaseColour("#2E86C1")).toBe("#2e86c1");
    expect(normalisePhaseColour("mint")).toBe("mint");
    expect(normalisePhaseColour("nope")).toBeNull();
    expect(normalisePhaseColour(null)).toBeNull();
  });

  it("a palette key keeps its hand-tuned tones exactly", () => {
    const c = phaseColour("sky");
    expect(c.light).toEqual(PHASE_COLOURS.sky.light);
    expect(c.dark).toEqual(PHASE_COLOURS.sky.dark);
    expect(c.hex).toBe(PHASE_COLOURS.sky.light.bg);
  });

  it("a hex is drawn in that colour, labelled by its code", () => {
    const c = phaseColour("#2E86C1");
    expect(c.key).toBe("#2e86c1");
    expect(c.label).toBe("#2E86C1");
    expect(c.light.bg).toBe("#2e86c1");
    expect(c.light.stripe).toBe("#2e86c1");
    // border a little darker than the fill
    expect(relativeLuminance(c.light.border)).toBeLessThan(relativeLuminance(c.light.bg));
    // dark mode: muted, darker than the colour itself
    expect(relativeLuminance(c.dark.bg)).toBeLessThan(relativeLuminance("#2e86c1"));
  });

  it("the mid-blue #2E86C1 gets readable text in both modes", () => {
    const t = tonesFromHex("#2E86C1");
    expect(contrastRatio(t.light.text, t.light.bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(t.dark.text, t.dark.bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("dark text on light colours, light text on dark colours", () => {
    expect(relativeLuminance(readableTextOn("#fff5cc"))).toBeLessThan(0.1);
    expect(relativeLuminance(readableTextOn("#14213d"))).toBeGreaterThan(0.6);
  });

  it("ANY colour gets text at 4.5:1 or better, in light and dark mode", () => {
    // A grid through the whole RGB cube, edges included.
    const steps = [0, 31, 63, 95, 127, 140, 159, 191, 223, 255];
    for (const r of steps) for (const g of steps) for (const b of steps) {
      const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
      const t = tonesFromHex(hex);
      expect(contrastRatio(t.light.text, t.light.bg), `${hex} light`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(contrastRatio(t.dark.text, t.dark.bg), `${hex} dark`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it("near-white and near-black colours still show a stripe", () => {
    expect(tonesFromHex("#ffffff").light.stripe).not.toBe("#ffffff");
    expect(tonesFromHex("#000000").dark.stripe).not.toBe("#000000");
  });

  it("mixHex blends", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("phase colours — the calendar default", () => {
  it("a phase with no colour follows the calendar default (key or hex)", () => {
    expect(phaseColour(null, "#2e86c1").key).toBe("#2e86c1");
    expect(phaseColour(null, "mint").key).toBe("mint");
    expect(phaseColour(undefined, "#ABCDEF").key).toBe("#abcdef");
  });

  it("a phase's own colour beats the default", () => {
    expect(phaseColour("peach", "#2e86c1").key).toBe("peach");
    expect(phaseColour("#112233", "mint").key).toBe("#112233");
  });

  it("no default (or a junk one) falls back to soft lavender", () => {
    expect(phaseColour(null, null).key).toBe("lavender");
    expect(phaseColour(null, "bogus").key).toBe("lavender");
    expect(phaseColour("bogus", "also-bogus").key).toBe("lavender");
  });
});

describe("phase colours — history lines", () => {
  it("a colour change reads plainly", () => {
    expect(describeFieldChanges({ color: { from: null, to: "sky" } })).toBe("changed the colour to sky blue");
    expect(describeFieldChanges({ color: { from: "sky", to: "#2e86c1" } })).toBe("changed the colour to #2E86C1");
    expect(describeFieldChanges({ color: { from: "sky", to: null } })).toBe("changed the colour to the default colour");
  });
});
