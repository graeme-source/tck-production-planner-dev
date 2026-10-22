/**
 * TSPL renderers for the prep-room label printer (Graeme, 2026-09-08).
 *
 * TSPL is the TSC printer's native text language: a handful of commands
 * (SIZE / TEXT / BOX / PRINT) sent as plain text straight to the printer —
 * no driver, no design app. Everything here is a pure string builder so the
 * layouts are unit-testable without a printer within reach.
 *
 * Geometry: 102 x 25mm direct-thermal stock (Graeme, 2026-10-22) on a 203dpi
 * printer → 8 dots/mm, a printable canvas of roughly 816 x 200 dots. The layouts lean on that
 * width: item name big on the left, the USE BY date boxed and huge on the
 * right, because the use-by is the thing a fridge check reads from a metre
 * away.
 *
 * Two printer languages from the same layouts (Graeme, 2026-10-22: the
 * printer on hand for testing is a Zebra ZD421, which speaks ZPL, not TSPL).
 * Each layout is a list of text/box shapes in dots; buildLabel() writes them
 * out as TSPL (TSC) or ZPL (Zebra) according to `language`.
 *
 * Fonts are the TSC built-in bitmaps ("2" = 12x20, "3" = 16x24, "4" = 24x32
 * dots per char before multipliers) — available on every TSPL printer, so
 * this works whichever TSC model the courier handed over.
 */

export interface LabelGeometry {
  /** Dots per mm — 8 on a 203dpi printer, 12 on 300dpi. */
  dotsPerMm?: number;
  widthMm?: number;
  heightMm?: number;
  /** Gap between labels on the roll. */
  gapMm?: number;
  /** TSPL for TSC printers, ZPL for Zebra. */
  language?: "tspl" | "zpl";
}

const DEFAULTS: Required<LabelGeometry> = { dotsPerMm: 8, widthMm: 102, heightMm: 25, gapMm: 3, language: "tspl" };

/** The printers we can drive, stored in app_settings under
 *  LABEL_PRINTER_SETTINGS_KEY. Unknown/missing = the original TSC setup. */
export const LABEL_PRINTER_SETTINGS_KEY = "label_printer_model";
export const LABEL_PRINTER_MODELS = {
  "tsc-203": { label: "TSC (203 dpi)", dotsPerMm: 8, language: "tspl" },
  "zebra-203": { label: "Zebra ZD421 (203 dpi)", dotsPerMm: 8, language: "zpl" },
  "zebra-300": { label: "Zebra ZD421 (300 dpi)", dotsPerMm: 12, language: "zpl" },
} as const satisfies Record<string, { label: string; dotsPerMm: number; language: "tspl" | "zpl" }>;
export type LabelPrinterModel = keyof typeof LABEL_PRINTER_MODELS;

export function labelGeometryFor(model: string | null | undefined): LabelGeometry {
  const m = LABEL_PRINTER_MODELS[(model ?? "") as LabelPrinterModel] ?? LABEL_PRINTER_MODELS["tsc-203"];
  return { dotsPerMm: m.dotsPerMm, language: m.language };
}

/** TSPL TEXT content sits in double quotes; the language has no escape for
 *  a literal double quote, so they become singles. Thermal bitmap fonts are
 *  ASCII — accents flatten rather than printing as mojibake mid-service. */
export function tsplSanitize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents left by NFKD
    .replace(/"/g, "'")
    .replace(/[\^~]/g, "-") // ZPL command prefixes — would end the field mid-text
    .replace(/[^\x20-\x7E]/g, "?")
    .trim();
}

/** "2026-09-10" → "WED 10 SEP" — the weekday does the day-dot job: a fridge
 *  check reads "WED" faster than it does a date. */
export function fmtLabelDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (isNaN(d.getTime())) return iso.toUpperCase();
  const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay()];
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mon}`;
}

interface TextCmd { x: number; y: number; font: string; xMul: number; yMul: number; text: string }
type Shape = ({ kind: "text" } & TextCmd) | { kind: "box"; x1: number; y1: number; x2: number; y2: number; thickness: number };

// TSC bitmap font cell sizes in dots — the ZPL output scales its built-in
// font to the same cell so a layout looks the same on either printer.
const FONT_CELL: Record<string, { w: number; h: number }> = { "2": { w: 12, h: 20 }, "3": { w: 16, h: 24 }, "4": { w: 24, h: 32 } };

/** Layouts are drawn on an 8-dots/mm canvas; a 300dpi Zebra scales them up. */
const LAYOUT_DOTS_PER_MM = 8;

function buildLabel(geo: LabelGeometry | undefined, body: (w: number, h: number) => Shape[], copies: number): string {
  const g = { ...DEFAULTS, ...geo };
  const w = g.widthMm * LAYOUT_DOTS_PER_MM;
  const h = g.heightMm * LAYOUT_DOTS_PER_MM;
  const shapes = body(w, h);
  const n = Math.max(1, Math.floor(copies));
  return g.language === "zpl" ? toZpl(g, shapes, n) : toTspl(g, shapes, n);
}

function toTspl(g: Required<LabelGeometry>, shapes: Shape[], copies: number): string {
  const k = g.dotsPerMm / LAYOUT_DOTS_PER_MM;
  const d = (v: number) => Math.round(v * k);
  const lines = [
    `SIZE ${g.widthMm} mm,${g.heightMm} mm`,
    `GAP ${g.gapMm} mm,0 mm`,
    "DENSITY 10",
    "SPEED 4",
    "DIRECTION 1",
    "REFERENCE 0,0",
    "CLS",
    ...shapes.map(s => s.kind === "text"
      ? `TEXT ${d(s.x)},${d(s.y)},"${s.font}",0,${s.xMul},${s.yMul},"${tsplSanitize(s.text)}"`
      : `BOX ${d(s.x1)},${d(s.y1)},${d(s.x2)},${d(s.y2)},${d(s.thickness)}`),
    `PRINT ${copies},1`,
  ];
  return lines.join("\r\n") + "\r\n";
}

/** ZPL for Zebra printers: ^PW/^LL set the label size in dots, ^A0 is the
 *  built-in scalable font sized to the TSC cell, ^GB draws the box outline,
 *  ^PQ the copies. Media type and darkness stay as set on the printer. */
function toZpl(g: Required<LabelGeometry>, shapes: Shape[], copies: number): string {
  const k = g.dotsPerMm / LAYOUT_DOTS_PER_MM;
  const d = (v: number) => Math.round(v * k);
  const lines = [
    "^XA",
    "^CI0",
    `^PW${g.widthMm * g.dotsPerMm}`,
    `^LL${g.heightMm * g.dotsPerMm}`,
    "^LH0,0",
    ...shapes.map(s => {
      if (s.kind === "box") {
        return `^FO${d(s.x1)},${d(s.y1)}^GB${d(s.x2 - s.x1)},${d(s.y2 - s.y1)},${d(s.thickness)}^FS`;
      }
      const cell = FONT_CELL[s.font] ?? FONT_CELL["3"];
      return `^FO${d(s.x)},${d(s.y)}^A0N,${d(cell.h * s.yMul)},${d(cell.w * s.xMul)}^FD${tsplSanitize(s.text)}^FS`;
    }),
    `^PQ${copies}`,
    "^XZ",
  ];
  return lines.join("\n") + "\n";
}

const text = (c: TextCmd): Shape => ({ kind: "text", ...c });
const box = (x1: number, y1: number, x2: number, y2: number, thickness = 3): Shape => ({ kind: "box", x1, y1, x2, y2, thickness });

/** Pick the biggest rendering of `s` that fits `maxDots` wide, from widest
 *  to narrowest. Bitmap font widths: font 4 = 24, font 3 = 16, font 2 = 12
 *  dots/char, times the x-multiplier. */
function fitText(s: string, maxDots: number): { font: string; xMul: number; yMul: number } {
  const options = [
    { font: "4", xMul: 2, yMul: 2, charW: 48 },
    { font: "3", xMul: 2, yMul: 2, charW: 32 },
    { font: "4", xMul: 1, yMul: 1, charW: 24 },
    { font: "3", xMul: 1, yMul: 1, charW: 16 },
    { font: "2", xMul: 1, yMul: 1, charW: 12 },
  ];
  for (const o of options) {
    if (s.length * o.charW <= maxDots) return o;
  }
  return options[options.length - 1];
}

export interface IngredientLabelFields {
  itemName: string;
  /** yyyy-mm-dd — the food-safe use-by after opening. */
  useBy: string;
  /** yyyy-mm-dd — the day it was opened (usually today). */
  openedOn: string;
  /** Who printed it — initials are the pen-label convention kept. */
  initials: string;
  /** e.g. "KEEP <5C" — optional storage instruction. */
  storageNote?: string | null;
  /** Prints a RAW marker so raw-meat segregation survives decanting. */
  rawMarker?: boolean;
}

/**
 * Opened-ingredient label:
 * ┌──────────────────────────────────┬──────────────┐
 * │ CHICKEN THIGHS            [RAW]  │   USE BY     │
 * │ Opened MON 8 SEP · GC · KEEP <5C │  WED 10 SEP  │
 * └──────────────────────────────────┴──────────────┘
 */
export function renderIngredientLabel(f: IngredientLabelFields, copies = 1, geo?: LabelGeometry): string {
  return buildLabel(geo, (w, h) => {
    const useByText = fmtLabelDate(f.useBy);
    // Right block: wide enough for "USE BY" + the date at font 3 x2.
    const boxW = Math.max(useByText.length * 32 + 30, 300);
    const boxX = w - boxW - 8;
    const leftW = boxX - 24;

    const name = f.itemName.toUpperCase() + (f.rawMarker ? "  *RAW*" : "");
    const nameFit = fitText(name, leftW);
    const footer = [`Opened ${fmtLabelDate(f.openedOn)}`, f.initials.toUpperCase(), f.storageNote?.toUpperCase()]
      .filter(Boolean).join(" - ");
    const footerFit = fitText(footer, leftW);

    return [
      text({ x: 12, y: 18, ...nameFit, text: name }),
      text({ x: 12, y: h - 46, ...footerFit, text: footer }),
      box(boxX, 8, w - 8, h - 8),
      text({ x: boxX + 16, y: 18, font: "2", xMul: 1, yMul: 1, text: "USE BY" }),
      text({ x: boxX + 16, y: h - 78, font: "3", xMul: 2, yMul: 2, text: useByText }),
    ];
  }, copies);
}

export interface TinLabelFields {
  recipeName: string;
  /** yyyy-mm-dd — the production day this tin is being prepped FOR. */
  intendedUse: string;
  /** yyyy-mm-dd — the food-safe use-by. */
  useBy: string;
  /** What's in the tin, when it isn't obvious from the recipe name. */
  contents?: string | null;
  initials: string;
}

/**
 * Tin label — intended-use leads (that's the tin's job), use-by boxed:
 * ┌──────────────────────────────────┬──────────────┐
 * │ PHILLY CHEESE STEAK              │   USE BY     │
 * │ USE: TUE 9 SEP · Philly beef · GC│  THU 11 SEP  │
 * └──────────────────────────────────┴──────────────┘
 */
export function renderTinLabel(f: TinLabelFields, copies = 1, geo?: LabelGeometry): string {
  return buildLabel(geo, (w, h) => {
    const useByText = fmtLabelDate(f.useBy);
    const boxW = Math.max(useByText.length * 32 + 30, 300);
    const boxX = w - boxW - 8;
    const leftW = boxX - 24;

    const name = f.recipeName.toUpperCase();
    const nameFit = fitText(name, leftW);
    const footer = [`USE: ${fmtLabelDate(f.intendedUse)}`, f.contents ?? undefined, f.initials.toUpperCase()]
      .filter(Boolean).join(" - ");
    const footerFit = fitText(footer, leftW);

    return [
      text({ x: 12, y: 18, ...nameFit, text: name }),
      text({ x: 12, y: h - 46, ...footerFit, text: footer }),
      box(boxX, 8, w - 8, h - 8),
      text({ x: boxX + 16, y: 18, font: "2", xMul: 1, yMul: 1, text: "USE BY" }),
      text({ x: boxX + 16, y: h - 78, font: "3", xMul: 2, yMul: 2, text: useByText }),
    ];
  }, copies);
}

/** Setup/test label — proves app → queue → bridge → printer end to end and
 *  shows the geometry is right on the actual stock. */
export function renderTestLabel(initials: string, todayIso: string, copies = 1, geo?: LabelGeometry): string {
  return buildLabel(geo, (w, h) => [
    text({ x: 12, y: 18, font: "4", xMul: 1, yMul: 1, text: "TCK LABEL TEST" }),
    text({ x: 12, y: h - 46, font: "3", xMul: 1, yMul: 1, text: `${fmtLabelDate(todayIso)} - ${initials.toUpperCase()} - IF YOU CAN READ THIS, IT WORKS` }),
    box(4, 4, w - 4, h - 4, 2),
  ], copies);
}
