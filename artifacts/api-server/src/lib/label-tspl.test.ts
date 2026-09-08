import { describe, it, expect } from "vitest";
import {
  renderIngredientLabel,
  renderTinLabel,
  renderTestLabel,
  fmtLabelDate,
  tsplSanitize,
} from "./label-tspl";

describe("fmtLabelDate", () => {
  it("formats with the weekday doing the day-dot job", () => {
    expect(fmtLabelDate("2026-09-10")).toBe("THU 10 SEP");
    expect(fmtLabelDate("2026-12-25")).toBe("FRI 25 DEC");
  });

  it("falls back to the raw string rather than printing 'Invalid Date'", () => {
    expect(fmtLabelDate("soon")).toBe("SOON");
  });
});

describe("tsplSanitize", () => {
  it("double quotes would break the TSPL TEXT command — they become singles", () => {
    expect(tsplSanitize('12" tray')).toBe("12' tray");
  });

  it("flattens accents instead of printing mojibake", () => {
    expect(tsplSanitize("Jalapeño purée")).toBe("Jalapeno puree");
  });

  it("non-ASCII that can't flatten becomes ? not garbage", () => {
    expect(tsplSanitize("50℃")).toBe("50?C");
  });
});

describe("renderIngredientLabel", () => {
  const fields = { itemName: "Chicken Thighs", useBy: "2026-09-10", openedOn: "2026-09-08", initials: "gc" };

  it("declares the 100x25mm geometry and prints one copy by default", () => {
    const tspl = renderIngredientLabel(fields);
    expect(tspl).toContain("SIZE 100 mm,25 mm");
    expect(tspl).toContain("GAP 3 mm,0 mm");
    expect(tspl).toContain("PRINT 1,1");
    expect(tspl.endsWith("\r\n")).toBe(true);
  });

  it("carries the name (upper-cased), both dates and the initials", () => {
    const tspl = renderIngredientLabel(fields);
    expect(tspl).toContain("CHICKEN THIGHS");
    expect(tspl).toContain("THU 10 SEP");
    expect(tspl).toContain("Opened TUE 8 SEP");
    expect(tspl).toContain("GC");
  });

  it("boxes the use-by so it reads from across the fridge", () => {
    expect(renderIngredientLabel(fields)).toMatch(/BOX \d+,\d+,\d+,\d+/);
  });

  it("copies land in the PRINT command", () => {
    expect(renderIngredientLabel(fields, 4)).toContain("PRINT 4,1");
  });

  it("a long name drops to a smaller font instead of running off the label", () => {
    const long = renderIngredientLabel({ ...fields, itemName: "Free Range Corn Fed Chicken Thigh Fillets Skinless" });
    // The big rendering is 32 dots/char — 50 chars would need 1600 dots on a
    // ~475-dot left column, so the fitter must have picked a smaller font.
    expect(long).toContain('"2",0,1,1,"FREE RANGE CORN FED');
  });

  it("raw marker and storage note appear when asked for", () => {
    const tspl = renderIngredientLabel({ ...fields, rawMarker: true, storageNote: "Keep <5C" });
    expect(tspl).toContain("*RAW*");
    expect(tspl).toContain("KEEP <5C");
  });
});

describe("renderTinLabel", () => {
  it("leads with intended use and boxes the food-safe use-by", () => {
    const tspl = renderTinLabel({
      recipeName: "Philly Cheese Steak",
      intendedUse: "2026-09-09",
      useBy: "2026-09-11",
      contents: "Philly beef",
      initials: "GC",
    });
    expect(tspl).toContain("PHILLY CHEESE STEAK");
    expect(tspl).toContain("USE: WED 9 SEP");
    expect(tspl).toContain("FRI 11 SEP");
    expect(tspl).toContain("Philly beef");
  });
});

describe("renderTestLabel", () => {
  it("says enough to prove the pipe and the geometry", () => {
    const tspl = renderTestLabel("GC", "2026-09-08", 1);
    expect(tspl).toContain("TCK LABEL TEST");
    expect(tspl).toContain("TUE 8 SEP");
    expect(tspl).toContain("IF YOU CAN READ THIS, IT WORKS");
  });
});
