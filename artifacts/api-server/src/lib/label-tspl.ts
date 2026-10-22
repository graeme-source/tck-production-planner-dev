/**
 * TSPL renderers for the prep-room label printer (Graeme, 2026-09-08).
 *
 * TSPL is the TSC printer's native text language: a handful of commands
 * (SIZE / TEXT / BOX / PRINT) sent as plain text straight to the printer —
 * no driver, no design app. Everything here is a pure string builder so the
 * layouts are unit-testable without a printer within reach.
 *
 * Geometry: 102 x 25mm direct-thermal stock on a 203dpi printer → 8 dots/mm,
 * an 816 x 200 dot canvas. Design (Graeme, 2026-10-22, after the first real
 * prints: "we need to be able to read these quickly… much bigger text for the
 * item and the use-by"):
 *
 *   ┌────────────────────────────────────────────────┐
 *   │ CHICKEN THIGHS                                 │  item, as big as fits
 *   │█ USE BY  SAT 24 OCT ███████████████████████████│  white on black bar
 *   │ OPENED THU 22 OCT - CT                   [RAW] │  small footer + tag
 *   └────────────────────────────────────────────────┘
 *
 * Everything sits inside a 3mm left/right and 1.5mm top/bottom safe margin,
 * so a roll a little off-centre never cuts text (the first prints lost ~2mm
 * on the right).
 *
 * Two printer languages from the same layouts (Graeme, 2026-10-22: the
 * printer on hand for testing is a Zebra ZD421, which speaks ZPL, not TSPL).
 * Each layout is a list of text/box shapes in dots; buildLabel() writes them
 * out as TSPL (TSC) or ZPL (Zebra) according to `language`.
 *
 * Text is sized by height in dots. ZPL uses the built-in scalable font at a
 * square aspect (wide, bold — the default condensed shape read badly); TSPL
 * picks the biggest built-in bitmap font + multiplier that fits the height.
 * Widths are estimated at 0.75 x height per character, deliberately
 * generous, so a name that "fits" really does.
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

type Shape =
  | { kind: "text"; x: number; y: number; h: number; text: string; reverse?: boolean }
  | { kind: "box"; x1: number; y1: number; x2: number; y2: number; thickness: number }
  | { kind: "fill"; x: number; y: number; w: number; h: number };

/** Layouts are drawn on an 8-dots/mm canvas; a 300dpi printer scales them up. */
const LAYOUT_DOTS_PER_MM = 8;
/** Safe margins in layout dots: 3mm left/right, 1.5mm top/bottom. */
const MARGIN_X = 24;
const MARGIN_Y = 12;
/** Estimated character width as a share of text height (see header). */
const CHAR_W = 0.75;

const textWidth = (s: string, h: number) => Math.ceil(s.length * h * CHAR_W);

// TSPL built-in bitmap fonts: name → cell size in dots.
const TSPL_FONTS = [
  { font: "5", w: 32, h: 48 },
  { font: "4", w: 24, h: 32 },
  { font: "3", w: 16, h: 24 },
  { font: "2", w: 12, h: 20 },
];

/** Biggest TSPL bitmap font × multiplier no taller than `h`. */
function tsplFont(h: number): { font: string; mul: number; cellH: number } {
  let best = { font: "2", mul: 1, cellH: 20 };
  for (const f of TSPL_FONTS) {
    for (let mul = 1; mul <= 4; mul++) {
      const cellH = f.h * mul;
      if (cellH <= h && cellH > best.cellH) best = { font: f.font, mul, cellH };
    }
  }
  return best;
}

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
  // TSPL has no white text: white-on-black is plain text with its bar
  // area inverted afterwards (REVERSE), so bars go out last.
  const out: string[] = [];
  const bars: string[] = [];
  for (const s of shapes) {
    if (s.kind === "box") out.push(`BOX ${d(s.x1)},${d(s.y1)},${d(s.x2)},${d(s.y2)},${d(s.thickness)}`);
    else if (s.kind === "fill") bars.push(`REVERSE ${d(s.x)},${d(s.y)},${d(s.w)},${d(s.h)}`);
    else {
      const f = tsplFont(d(s.h));
      out.push(`TEXT ${d(s.x)},${d(s.y)},"${f.font}",0,${f.mul},${f.mul},"${tsplSanitize(s.text)}"`);
    }
  }
  out.push(...bars);
  return [
    `SIZE ${g.widthMm} mm,${g.heightMm} mm`,
    `GAP ${g.gapMm} mm,0 mm`,
    "DENSITY 10",
    "SPEED 4",
    "DIRECTION 1",
    "REFERENCE 0,0",
    "CLS",
    ...out,
    `PRINT ${copies},1`,
  ].join("\r\n") + "\r\n";
}

/** ZPL for Zebra printers: ^PW/^LL set the label size in dots, ^A0 is the
 *  built-in scalable font at a square aspect, ^GB draws boxes and solid
 *  bars, ^FR prints white-on-black over a bar, ^PQ the copies. Media type
 *  and darkness stay as set on the printer. */
function toZpl(g: Required<LabelGeometry>, shapes: Shape[], copies: number): string {
  const k = g.dotsPerMm / LAYOUT_DOTS_PER_MM;
  const d = (v: number) => Math.round(v * k);
  return [
    "^XA",
    "^CI0",
    `^PW${g.widthMm * g.dotsPerMm}`,
    `^LL${g.heightMm * g.dotsPerMm}`,
    "^LH0,0",
    ...shapes.map(s => {
      if (s.kind === "box") return `^FO${d(s.x1)},${d(s.y1)}^GB${d(s.x2 - s.x1)},${d(s.y2 - s.y1)},${d(s.thickness)}^FS`;
      if (s.kind === "fill") return `^FO${d(s.x)},${d(s.y)}^GB${d(s.w)},${d(s.h)},${d(Math.min(s.w, s.h))}^FS`;
      return `^FO${d(s.x)},${d(s.y)}^A0N,${d(s.h)},${d(s.h)}${s.reverse ? "^FR" : ""}^FD${tsplSanitize(s.text)}^FS`;
    }),
    `^PQ${copies}`,
    "^XZ",
  ].join("\n") + "\n";
}

/** Greedy word wrap into at most `maxLines` lines of `maxDots` at height
 *  `h`; null when the words don't fit (a single over-long word included). */
function wrapLines(s: string, h: number, maxDots: number, maxLines: number): string[] | null {
  const lines: string[] = [];
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (textWidth(word, h) > maxDots) return null;
    const last = lines[lines.length - 1];
    if (last != null && textWidth(`${last} ${word}`, h) <= maxDots) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
    if (lines.length > maxLines) return null;
  }
  return lines.length ? lines : null;
}

/**
 * The item name, as big as it will go in its block: one huge line, else two
 * lines, stepping the height down until the words fit. Last resort is the
 * smallest size on two lines with the overflow cut — a name never prints
 * outside the label.
 */
function nameBlock(name: string, x: number, y: number, maxW: number, maxH: number): Shape[] {
  const gap = 4;
  for (let h = maxH; h >= 24; h -= 2) {
    const one = wrapLines(name, h, maxW, 1);
    if (one) return [{ kind: "text", x, y: y + Math.floor((maxH - h) / 2), h, text: one[0]! }];
    const lineH = Math.floor((maxH - gap) / 2);
    if (h <= lineH) {
      const two = wrapLines(name, h, maxW, 2);
      if (two) {
        const top = y + Math.floor((maxH - (h * 2 + gap)) / 2);
        return two.map((t, i) => ({ kind: "text" as const, x, y: top + i * (h + gap), h, text: t }));
      }
    }
  }
  const h = 24;
  const perLine = Math.floor(maxW / (h * CHAR_W));
  return [name.slice(0, perLine), name.slice(perLine, perLine * 2)]
    .filter(Boolean)
    .map((t, i) => ({ kind: "text" as const, x, y: y + i * (h + gap), h, text: t.trim() }));
}

interface CoreLabel {
  name: string;
  /** The bar: label ("USE BY") + date text. */
  barLabel: string;
  barValue: string;
  footer: string;
  /** Black tag at the footer's right end, e.g. RAW. */
  tag?: string | null;
}

/** The shared layout — see the diagram in the header. Rows, top to bottom,
 *  inside the safe margins (176 dots tall): name 84, gap 6, bar 56, gap 6,
 *  footer 24. */
function coreLayout(c: CoreLabel, w: number, h: number): Shape[] {
  const left = MARGIN_X;
  const right = w - MARGIN_X;
  const innerW = right - left;
  const top = MARGIN_Y;
  const nameH = 84;
  const barY = top + nameH + 6;
  const barH = 56;
  const footY = barY + barH + 6;
  const footH = h - MARGIN_Y - footY; // 24

  const shapes: Shape[] = [...nameBlock(c.name, left, top, innerW, nameH)];

  // USE BY bar: small label, big date, both white on black.
  shapes.push({ kind: "fill", x: left, y: barY, w: innerW, h: barH });
  const labelH = 28;
  const valueH = 46;
  shapes.push({ kind: "text", x: left + 12, y: barY + Math.floor((barH - labelH) / 2), h: labelH, text: c.barLabel, reverse: true });
  const valueX = left + 12 + textWidth(c.barLabel, labelH) + 16;
  shapes.push({ kind: "text", x: valueX, y: barY + Math.floor((barH - valueH) / 2), h: valueH, text: c.barValue, reverse: true });

  // Footer: details left, optional black tag right.
  let footRight = right;
  if (c.tag) {
    const tagW = textWidth(c.tag, footH) + 16;
    shapes.push({ kind: "fill", x: right - tagW, y: footY, w: tagW, h: footH });
    shapes.push({ kind: "text", x: right - tagW + 8, y: footY + 2, h: footH - 2, text: c.tag, reverse: true });
    footRight = right - tagW - 8;
  }
  const footer = wrapLines(c.footer, footH - 2, footRight - left, 1)?.[0]
    ?? c.footer.slice(0, Math.floor((footRight - left) / ((footH - 2) * CHAR_W)));
  shapes.push({ kind: "text", x: left, y: footY + 2, h: footH - 2, text: footer });
  return shapes;
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
  /** Prints a RAW tag so raw-meat segregation survives decanting. */
  rawMarker?: boolean;
}

/** Opened-ingredient label. */
export function renderIngredientLabel(f: IngredientLabelFields, copies = 1, geo?: LabelGeometry): string {
  return buildLabel(geo, (w, h) => coreLayout({
    name: f.itemName.toUpperCase(),
    barLabel: "USE BY",
    barValue: fmtLabelDate(f.useBy),
    footer: [`OPENED ${fmtLabelDate(f.openedOn)}`, f.initials.toUpperCase(), f.storageNote?.toUpperCase()]
      .filter(Boolean).join(" - "),
    tag: f.rawMarker ? "RAW" : null,
  }, w, h), copies);
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

/** Tin label — same layout; the footer leads with the day it's for. */
export function renderTinLabel(f: TinLabelFields, copies = 1, geo?: LabelGeometry): string {
  return buildLabel(geo, (w, h) => coreLayout({
    name: f.recipeName.toUpperCase(),
    barLabel: "USE BY",
    barValue: fmtLabelDate(f.useBy),
    footer: [`FOR ${fmtLabelDate(f.intendedUse)}`, f.contents?.toUpperCase(), f.initials.toUpperCase()]
      .filter(Boolean).join(" - "),
  }, w, h), copies);
}

/** Setup/test label — the real layout, plus a thin frame on the safe
 *  margins: if all four sides of the frame print, nothing will be cut. */
export function renderTestLabel(initials: string, todayIso: string, copies = 1, geo?: LabelGeometry): string {
  return buildLabel(geo, (w, h) => [
    ...coreLayout({
      name: "TCK LABEL TEST",
      barLabel: "TODAY",
      barValue: fmtLabelDate(todayIso),
      footer: `${initials.toUpperCase()} - IF THE FRAME IS WHOLE, IT FITS`,
    }, w, h),
    { kind: "box", x1: MARGIN_X - 6, y1: MARGIN_Y - 6, x2: w - MARGIN_X + 6, y2: h - MARGIN_Y + 6, thickness: 2 },
  ], copies);
}
