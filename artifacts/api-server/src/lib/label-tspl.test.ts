import { describe, it, expect } from "vitest";
import {
  renderIngredientLabel,
  renderTinLabel,
  renderTestLabel,
  fmtLabelDate,
  tsplSanitize,
  labelGeometryFor,
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

const zebra = labelGeometryFor("zebra-203");
const fields = { itemName: "Chicken Thighs", useBy: "2026-09-10", openedOn: "2026-09-08", initials: "gc" };

/** Text fields of a ZPL label: { x, y, h, text, reverse }. */
function zplTexts(zpl: string) {
  return [...zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+(\^FR)?\^FD([^^]*)\^FS/g)].map(m => ({
    x: Number(m[1]), y: Number(m[2]), h: Number(m[3]), reverse: !!m[4], text: m[5]!,
  }));
}

describe("label design (Graeme, 22 Oct: read it at a glance)", () => {
  it("TSC: declares 102x25mm and one copy by default", () => {
    const tspl = renderIngredientLabel(fields);
    expect(tspl).toContain("SIZE 102 mm,25 mm");
    expect(tspl).toContain("GAP 3 mm,0 mm");
    expect(tspl).toContain("PRINT 1,1");
    expect(tspl.endsWith("\r\n")).toBe(true);
  });

  it("a short name prints huge on one line", () => {
    const name = zplTexts(renderIngredientLabel(fields, 1, zebra)).find(t => t.text === "CHICKEN THIGHS")!;
    expect(name.h).toBeGreaterThanOrEqual(56);
  });

  it("the use-by date is big and white on a black bar", () => {
    const zpl = renderIngredientLabel(fields, 1, zebra);
    const date = zplTexts(zpl).find(t => t.text === "THU 10 SEP")!;
    expect(date.h).toBeGreaterThanOrEqual(44);
    expect(date.reverse).toBe(true);
    expect(zplTexts(zpl).find(t => t.text === "USE BY")!.reverse).toBe(true);
  });

  it("a long name wraps onto two lines rather than shrinking to nothing", () => {
    const texts = zplTexts(renderIngredientLabel({ ...fields, itemName: "Skinless and Boneless Chicken Thighs", rawMarker: true }, 1, zebra));
    const nameLines = texts.filter(t => /SKINLESS|THIGHS/.test(t.text));
    expect(nameLines).toHaveLength(2);
    for (const l of nameLines) expect(l.h).toBeGreaterThanOrEqual(30);
  });

  it("raw meat gets a black RAW tag, not a word lost in the name", () => {
    const texts = zplTexts(renderIngredientLabel({ ...fields, rawMarker: true }, 1, zebra));
    expect(texts.find(t => t.text === "RAW")?.reverse).toBe(true);
    expect(texts.some(t => t.text.includes("*RAW*"))).toBe(false);
  });

  it("footer carries opened date and initials", () => {
    const texts = zplTexts(renderIngredientLabel(fields, 1, zebra));
    expect(texts.some(t => t.text === "OPENED TUE 8 SEP - GC")).toBe(true);
  });

  it("nothing is placed inside the 3mm side / 1.5mm top-bottom safe margins", () => {
    const names = ["Yeast", "Chicken Thighs", "Skinless and Boneless Chicken Thighs", "Free Range Corn Fed Chicken Thigh Fillets Skinless Boneless Extra"];
    for (const itemName of names) {
      for (const t of zplTexts(renderIngredientLabel({ ...fields, itemName, rawMarker: true, storageNote: "keep <5c" }, 1, zebra))) {
        expect(t.x).toBeGreaterThanOrEqual(24);
        expect(t.y).toBeGreaterThanOrEqual(12);
        expect(t.y + t.h).toBeLessThanOrEqual(200 - 12);
        expect(t.x + Math.ceil(t.text.length * t.h * 0.75)).toBeLessThanOrEqual(816 - 24);
      }
    }
  });

  it("copies land in the print command", () => {
    expect(renderIngredientLabel(fields, 4)).toContain("PRINT 4,1");
    expect(renderIngredientLabel(fields, 4, zebra)).toContain("^PQ4");
  });

  it("TSC: white-on-black is the text with its bar inverted afterwards", () => {
    const tspl = renderIngredientLabel(fields);
    expect(tspl).toMatch(/TEXT \d+,\d+,"\d",0,\d,\d,"THU 10 SEP"[\s\S]*REVERSE \d+,\d+,\d+,\d+/);
  });
});

describe("renderTinLabel", () => {
  it("same layout; footer leads with the day it's for", () => {
    const texts = zplTexts(renderTinLabel({ recipeName: "Philly Cheese Steak", intendedUse: "2026-09-09", useBy: "2026-09-11", contents: "Philly beef", initials: "gc" }, 1, zebra));
    expect(texts.some(t => t.text.startsWith("PHILLY"))).toBe(true);
    expect(texts.find(t => t.text === "FRI 11 SEP")?.reverse).toBe(true);
    expect(texts.some(t => t.text === "FOR WED 9 SEP - PHILLY BEEF - GC")).toBe(true);
  });
});

describe("renderTestLabel", () => {
  it("prints a frame on the safe margins so a cut edge shows at once", () => {
    const zpl = renderTestLabel("gc", "2026-09-10", 2, zebra);
    expect(zpl).toContain("TCK LABEL TEST");
    expect(zpl).toContain("^FO18,6^GB780,188,2^FS");
    expect(zpl).toContain("^PQ2");
  });
});

describe("printer models", () => {
  it("a 203dpi Zebra gets ZPL, 816 x 200 dots", () => {
    const zpl = renderIngredientLabel(fields, 1, zebra);
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
    expect(zpl).toContain("^PW816");
    expect(zpl).toContain("^LL200");
    expect(zpl).not.toContain("SIZE ");
  });

  it("a 300dpi Zebra scales the layout up by half", () => {
    const zpl = renderTestLabel("gc", "2026-09-10", 1, labelGeometryFor("zebra-300"));
    expect(zpl).toContain("^PW1224");
    expect(zpl).toContain("^LL300");
    expect(zpl).toContain("^FO27,9^GB1170,282,3^FS");
  });

  it("ZPL control characters in a name can't end the field early", () => {
    const zpl = renderTestLabel("g^c~", "2026-09-10", 1, zebra);
    expect(zpl).toContain("G-C-");
  });

  it("an unknown or missing printer setting keeps the TSC output", () => {
    expect(renderTestLabel("gc", "2026-09-10", 1, labelGeometryFor(undefined))).toContain("SIZE 102 mm,25 mm");
    expect(renderTestLabel("gc", "2026-09-10", 1, labelGeometryFor("nonsense"))).toContain("SIZE 102 mm,25 mm");
  });
});
