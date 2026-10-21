import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHASE_COLOUR, PHASE_COLOURS, PHASE_COLOUR_KEYS, isPhaseColour, phaseColour, phaseColourLabel,
} from "./phase-colours";
import { describeFieldChanges } from "./history";

// WCAG relative luminance / contrast ratio.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("phase colours", () => {
  it("has eight light pastels, each defined once with its key", () => {
    expect(PHASE_COLOUR_KEYS).toHaveLength(8);
    for (const k of PHASE_COLOUR_KEYS) expect(PHASE_COLOURS[k].key).toBe(k);
  });

  it("no colour (or an unknown one) is soft lavender", () => {
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
    for (const k of PHASE_COLOUR_KEYS) expect(luminance(PHASE_COLOURS[k].light.bg)).toBeGreaterThan(0.75);
    expect(luminance("#7c3aed")).toBeLessThan(0.15); // the old bar
  });

  it("text is easy to read on its fill, in light and dark mode (WCAG AA, 4.5:1 or better)", () => {
    for (const k of PHASE_COLOUR_KEYS) {
      const c = PHASE_COLOURS[k];
      expect(contrast(c.light.text, c.light.bg), `${k} light`).toBeGreaterThanOrEqual(7);
      expect(contrast(c.dark.text, c.dark.bg), `${k} dark`).toBeGreaterThanOrEqual(7);
    }
  });

  it("a colour change reads plainly in the phase history", () => {
    expect(describeFieldChanges({ color: { from: null, to: "sky" } })).toBe("changed the colour to sky blue");
    expect(describeFieldChanges({ color: { from: "sky", to: null } })).toBe("changed the colour to soft lavender");
  });
});
