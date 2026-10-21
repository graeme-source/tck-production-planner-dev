import { describe, expect, it } from "vitest";
import { contrastRatio, premiumStyle } from "./improvement-premium";

describe("the premium look for a ×2 / ×3 improvement", () => {
  it("a standard improvement looks as it always has: no badge, no extra classes", () => {
    const s = premiumStyle(1);
    expect(s.tier).toBe("standard");
    expect(s.badgeText).toBeNull();
    expect(s.cardClass).toBe("");
    expect(s.stripClass).toBe("");
  });

  it("×2 is a Great one, in gold with a star", () => {
    const s = premiumStyle(2);
    expect(s).toMatchObject({ tier: "great", weight: 2, badgeText: "Great one ×2", icon: "star" });
    expect(s.cardClass).toMatch(/amber/);
    expect(s.stripClass).not.toBe("");
  });

  it("×3 is Substantial: richer gold, a crown and a glow", () => {
    const s = premiumStyle(3);
    expect(s).toMatchObject({ tier: "substantial", weight: 3, badgeText: "Substantial ×3", icon: "crown" });
    expect(s.cardClass).toMatch(/shadow-lg/);
    expect(s.cardClass).toMatch(/ring-2/);
  });

  it("×3 stands out more than ×2", () => {
    expect(premiumStyle(3).cardClass).not.toBe(premiumStyle(2).cardClass);
    expect(premiumStyle(3).stripClass).toMatch(/h-2\.5/);
    expect(premiumStyle(2).stripClass).toMatch(/h-1\.5/);
  });

  it("odd values read safely: strings from the API, nulls, rubbish", () => {
    expect(premiumStyle("3").tier).toBe("substantial");
    expect(premiumStyle("2").tier).toBe("great");
    expect(premiumStyle(undefined).tier).toBe("standard");
    expect(premiumStyle(null).tier).toBe("standard");
    expect(premiumStyle(7).tier).toBe("standard");
  });

  it("the gold never uses the idea edge colour (amber-400 left edge)", () => {
    expect(premiumStyle(2).cardClass).not.toMatch(/border-l-/);
    expect(premiumStyle(3).cardClass).not.toMatch(/border-l-/);
  });

  it("badge text is readable (WCAG AA, 4.5:1) at the weakest gradient stop", () => {
    for (const w of [2, 3]) {
      const c = premiumStyle(w).badgeContrast!;
      expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("contrast maths matches the known black-on-white 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});
