import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import {
  boldTextWidthPt, fitFontSize, KANBAN_FRONT_TYPE, kanbanFrontLayout, kanbanNameFontSize, kanbanSheetLayout, kanbanWordPieces, mm, pageSize,
  PAPER_PT, qrModulesPath, wrappedLineCount, type KanbanFrontField,
} from "./kanban-card-layout";

describe("paper sizes in points", () => {
  it("A5 is 419.53 x 595.28 pt portrait and swaps for landscape", () => {
    expect(pageSize("A5")).toEqual({ width: 419.53, height: 595.28 });
    expect(pageSize("A5", "landscape")).toEqual({ width: 595.28, height: 419.53 });
  });

  it("matches the millimetre sizes (A4 210x297, A5 148x210, A6 105x148)", () => {
    expect(PAPER_PT.A4.width).toBeCloseTo(mm(210), 1);
    expect(PAPER_PT.A4.height).toBeCloseTo(mm(297), 1);
    expect(PAPER_PT.A5.width).toBeCloseTo(mm(148), 1);
    expect(PAPER_PT.A5.height).toBeCloseTo(mm(210), 1);
    expect(PAPER_PT.A6.width).toBeCloseTo(mm(105), 1);
    expect(PAPER_PT.A6.height).toBeCloseTo(mm(148), 1);
  });
});

describe("kanban fold sheet (the cause of the wrong-size prints)", () => {
  it("a5: the page IS an A5 sheet — no browser/printer guesswork about size", () => {
    const L = kanbanSheetLayout("a5");
    expect(L.page).toEqual(pageSize("A5"));
    expect(L.card).toEqual({ x: 0, y: 0, width: 419.53, height: 595.28 });
    expect(L.cropMarks).toEqual([]);
  });

  it("each face is exactly an A6 landscape card, front over back, fold in the middle", () => {
    const L = kanbanSheetLayout("a5");
    const a6Landscape = pageSize("A6", "landscape");
    for (const face of [L.front, L.back]) {
      expect(face.width).toBeCloseTo(a6Landscape.width, 2);
      expect(face.height).toBeCloseTo(a6Landscape.height, 2);
    }
    expect(L.front.y).toBe(0);
    expect(L.back.y).toBeCloseTo(L.front.y + L.front.height, 2);
    expect(L.fold.y1).toBe(L.back.y);
    expect(L.fold.y2).toBe(L.back.y);
    expect(L.fold.x2 - L.fold.x1).toBeCloseTo(L.card.width, 2);
  });

  it("the back is turned 180° so it reads the right way up once folded", () => {
    expect(kanbanSheetLayout("a5").backRotationDeg).toBe(180);
  });

  it("colour stops a printer-safe 4 mm from the sheet edges, flush at the fold", () => {
    const L = kanbanSheetLayout("a5");
    expect(L.frontFill.x).toBeCloseTo(mm(4), 2);
    expect(L.frontFill.y).toBeCloseTo(mm(4), 2);
    expect(L.frontFill.y + L.frontFill.height).toBeCloseTo(L.fold.y1, 1);
    expect(L.backFill.y).toBe(L.fold.y1);
    expect(L.backFill.y + L.backFill.height).toBeCloseTo(L.page.height - mm(4), 1);
  });

  it("a4: the same A5 card centred on A4, with 8 corner trim marks outside it", () => {
    const L = kanbanSheetLayout("a4");
    expect(L.page).toEqual(pageSize("A4"));
    expect(L.card.width).toBe(419.53);
    expect(L.card.height).toBe(595.28);
    expect(L.card.x).toBeCloseTo((595.28 - 419.53) / 2, 2);
    expect(L.card.y).toBeCloseTo((841.89 - 595.28) / 2, 2);
    expect(L.cropMarks).toHaveLength(8);
    for (const m of L.cropMarks) {
      const insideX = (x: number) => x > L.card.x + 0.01 && x < L.card.x + L.card.width - 0.01;
      const insideY = (y: number) => y > L.card.y + 0.01 && y < L.card.y + L.card.height - 0.01;
      // No mark ever crosses into the card itself.
      expect(insideX(m.x1) && insideY(m.y1)).toBe(false);
      expect(insideX(m.x2) && insideY(m.y2)).toBe(false);
    }
  });
});

describe("qrModulesPath", () => {
  it("draws exactly the dark modules of the real QR code (vector, so it scans in the PDF)", () => {
    const qr = QRCode.create("https://planner.example/scan?type=ingredient&id=12", { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const d = qrModulesPath(n, (r, c) => Boolean(qr.modules.get(r, c)));
    const drawn = new Set<string>();
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const [x, y, run] = [Number(m[1]), Number(m[2]), Number(m[3])];
      for (let i = 0; i < run; i++) drawn.add(`${y},${x + i}`);
    }
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const isDark = Boolean(qr.modules.get(r, c));
      if (isDark) dark++;
      expect(drawn.has(`${r},${c}`)).toBe(isDark);
    }
    expect(drawn.size).toBe(dark);
  });

  it("offsets by the quiet zone", () => {
    expect(qrModulesPath(2, (r, c) => r === 0 && c === 0, 2)).toBe("M2 2h1v1h-1z");
    expect(qrModulesPath(3, (r) => r === 1, 0)).toBe("M0 1h3v1h-3z");
  });
});

describe("kanbanNameFontSize", () => {
  it("shrinks long names so they never push the fields off the card", () => {
    expect(kanbanNameFontSize("Salt")).toBe(KANBAN_FRONT_TYPE.nameMaxPt);
    expect(kanbanNameFontSize("Mature cheddar cheese, grated, free-flowing, 2 kg bag, from the wholesale cash and carry")).toBeLessThan(KANBAN_FRONT_TYPE.nameMaxPt);
    expect(kanbanNameFontSize("x".repeat(200))).toBe(KANBAN_FRONT_TYPE.nameMinPt);
  });
});

describe("text measuring", () => {
  it("uses real Helvetica-Bold widths (W is wider than i)", () => {
    expect(boldTextWidthPt("W", 10)).toBeCloseTo(9.44, 2);
    expect(boldTextWidthPt("i", 10)).toBeCloseTo(2.78, 2);
  });

  it("word-wraps, and breaks a word longer than the line", () => {
    expect(wrappedLineCount("Salt", 20, 300)).toBe(1);
    const w = boldTextWidthPt("Salt", 20);
    expect(wrappedLineCount("Salt Salt Salt", 20, w * 2.5)).toBe(2);
    expect(wrappedLineCount("x".repeat(100), 20, 100)).toBeGreaterThan(5);
  });

  it("ordinary words are never split; a run-on code gets break points so it can wrap", () => {
    expect(kanbanWordPieces("Wholesale")).toEqual(["Wholesale"]);
    const pieces = kanbanWordPieces("y".repeat(40));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe("y".repeat(40));
  });

  it("fitFontSize picks the biggest size that fits, never below the minimum", () => {
    expect(fitFontSize("Salt", { maxPt: 20, minPt: 10, widthPt: 300, maxLines: 1 })).toBe(20);
    const size = fitFontSize("Walk-in fridge, top shelf, left", { maxPt: 20, minPt: 10, widthPt: 150, maxLines: 1 });
    expect(size).toBeLessThan(20);
    expect(wrappedLineCount("Walk-in fridge, top shelf, left", size, 150)).toBe(1);
    expect(fitFontSize("x".repeat(500), { maxPt: 20, minPt: 10, widthPt: 100, maxLines: 2 })).toBe(10);
  });
});

// Issue #353: printed on A5 the card text was too small to read.
describe("kanban front face is readable and still fits (#353)", () => {
  const fieldsOf = (pull: string, order: string, location: string, supplier: string, part: string | null): KanbanFrontField[] => [
    { label: "Pull when using last", value: pull, part: null },
    { label: "Order amount", value: order, part: null },
    { label: "Location", value: location, part: null },
    { label: "Supplier", value: supplier, part },
  ];

  it("type is ~1.5-1.7x the old sizes (labels 6.5, values 10.5, part 8.5, footer 6.5, QR 6)", () => {
    const T = KANBAN_FRONT_TYPE;
    expect(T.labelPt).toBeGreaterThanOrEqual(9);
    expect(T.valueMaxPt).toBeGreaterThanOrEqual(16);
    expect(T.partPt).toBeGreaterThanOrEqual(12);
    expect(T.footerPt).toBeGreaterThanOrEqual(9);
    expect(T.qrLabelPt).toBeGreaterThanOrEqual(9);
  });

  it("a typical card prints every value at full size, on one line, and fits the face", () => {
    for (const sheet of ["a5", "a4"] as const) {
      const L = kanbanFrontLayout("Salt", fieldsOf("2 packs", "6 packs", "Dry store", "Brakes", "SALT-25"), sheet);
      expect(L.fits).toBe(true);
      expect(L.namePt).toBe(KANBAN_FRONT_TYPE.nameMaxPt);
      for (const f of L.fields) {
        expect(f.valuePt).toBe(KANBAN_FRONT_TYPE.valueMaxPt);
        expect(f.valueLines).toBe(1);
      }
      expect(L.fieldsHeight).toBeLessThanOrEqual(L.fieldsAvailableHeight);
    }
  });

  it("long names and long values shrink/wrap but never run off the face", () => {
    const L = kanbanFrontLayout(
      "Mature cheddar cheese, grated, free-flowing, 2 kg bag (Wholesale)",
      fieldsOf("12 boxes of 6 x 2 kg bags", "48 boxes of 6 x 2 kg bags", "Walk-in fridge 2, top shelf, back left corner", "Bidfood Foodservice Wholesale Ltd", "BF-1234567-XL-2KG"),
    );
    expect(L.fits).toBe(true);
    expect(L.fieldsHeight).toBeLessThanOrEqual(L.fieldsAvailableHeight);
    expect(L.nameLines).toBeLessThanOrEqual(KANBAN_FRONT_TYPE.nameMaxLines);
    expect(wrappedLineCount(L.fields[0].label, KANBAN_FRONT_TYPE.labelPt, L.fieldColumnWidth)).toBe(1);
    for (const f of L.fields) {
      expect(f.valueLines).toBeLessThanOrEqual(KANBAN_FRONT_TYPE.valueMaxLines);
      expect(f.valuePt).toBeGreaterThanOrEqual(KANBAN_FRONT_TYPE.valueMinPt);
    }
  });

  it("absurd text (hundreds of characters) is cut at two lines, never drawn off the face", () => {
    const L = kanbanFrontLayout("x".repeat(300), fieldsOf("y".repeat(200), "y".repeat(200), "y".repeat(200), "y".repeat(200), "z".repeat(100)));
    expect(L.fits).toBe(true);
    expect(L.nameClipped).toBe(true);
    expect(L.nameLines).toBe(KANBAN_FRONT_TYPE.nameMaxLines);
    for (const f of L.fields) {
      expect(f.clipped).toBe(true);
      expect(f.valueLines).toBe(KANBAN_FRONT_TYPE.valueMaxLines);
    }
  });

  it("a medium-long name stays on one big line; a long one wraps to two, smaller lines", () => {
    const typical = fieldsOf("2 packs", "6 packs", "Dry store", "Brakes", "SALT-25");
    const medium = kanbanFrontLayout("Mature cheddar, grated, 2 kg bag", typical);
    expect(medium.nameLines).toBe(1);
    expect(medium.namePt).toBeGreaterThanOrEqual(KANBAN_FRONT_TYPE.nameOneLineMinPt);
    const long = kanbanFrontLayout("Chopped tomatoes in tomato juice, 2.5 kg tin", typical);
    expect(long.nameLines).toBe(2);
    expect(long.namePt).toBeLessThanOrEqual(KANBAN_FRONT_TYPE.nameTwoLineMaxPt);
    expect(long.fits).toBe(true);
    for (const f of long.fields) expect(f.valuePt).toBe(KANBAN_FRONT_TYPE.valueMaxPt);
  });

  it("every field label fits on one line beside the QR code", () => {
    const L = kanbanFrontLayout("Salt", fieldsOf("1", "1", "x", "x", null));
    for (const f of L.fields) {
      expect(wrappedLineCount(f.label.toUpperCase(), KANBAN_FRONT_TYPE.labelPt, L.fieldColumnWidth)).toBe(1);
    }
  });
});
