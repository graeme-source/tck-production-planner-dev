import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { kanbanNameFontSize, kanbanSheetLayout, mm, pageSize, PAPER_PT, qrModulesPath } from "./kanban-card-layout";

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
    expect(kanbanNameFontSize("Salt")).toBe(24);
    expect(kanbanNameFontSize("x".repeat(30))).toBeLessThan(24);
    expect(kanbanNameFontSize("x".repeat(80))).toBe(11);
  });
});
