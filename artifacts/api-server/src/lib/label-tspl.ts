/**
 * TSPL renderers for the prep-room label printer (Graeme, 2026-09-08).
 *
 * TSPL is the TSC printer's native text language: a handful of commands
 * (SIZE / TEXT / BOX / PRINT) sent as plain text straight to the printer —
 * no driver, no design app. Everything here is a pure string builder so the
 * layouts are unit-testable without a printer within reach.
 *
 * Geometry: 4" x ~25mm direct-thermal stock on a 203dpi printer → 8 dots/mm,
 * a printable canvas of roughly 800 x 200 dots. The layouts lean on that
 * width: item name big on the left, the USE BY date boxed and huge on the
 * right, because the use-by is the thing a fridge check reads from a metre
 * away.
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
}

const DEFAULTS: Required<LabelGeometry> = { dotsPerMm: 8, widthMm: 100, heightMm: 25, gapMm: 3 };

/** TSPL TEXT content sits in double quotes; the language has no escape for
 *  a literal double quote, so they become singles. Thermal bitmap fonts are
 *  ASCII — accents flatten rather than printing as mojibake mid-service. */
export function tsplSanitize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents left by NFKD
    .replace(/"/g, "'")
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

function buildLabel(geo: LabelGeometry | undefined, body: (w: number, h: number) => string[], copies: number): string {
  const g = { ...DEFAULTS, ...geo };
  const w = g.widthMm * g.dotsPerMm;
  const h = g.heightMm * g.dotsPerMm;
  const lines = [
    `SIZE ${g.widthMm} mm,${g.heightMm} mm`,
    `GAP ${g.gapMm} mm,0 mm`,
    "DENSITY 10",
    "SPEED 4",
    "DIRECTION 1",
    "REFERENCE 0,0",
    "CLS",
    ...body(w, h),
    `PRINT ${Math.max(1, Math.floor(copies))},1`,
  ];
  return lines.join("\r\n") + "\r\n";
}

const text = (c: TextCmd) => `TEXT ${c.x},${c.y},"${c.font}",0,${c.xMul},${c.yMul},"${tsplSanitize(c.text)}"`;
const box = (x1: number, y1: number, x2: number, y2: number, thickness = 3) => `BOX ${x1},${y1},${x2},${y2},${thickness}`;

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
