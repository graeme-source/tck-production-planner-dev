/**
 * The product-label template: page size, typography per text field, the
 * fixed wording, and the default cooking / shelf-life values a recipe falls
 * back to. One template is stored per label design (product_label_templates);
 * the default one reproduces Graeme's Chicken & Chorizo 2-pack label.
 *
 * Text may carry **bold** (same markup as the ingredient deck) and the
 * placeholders listed in TEMPLATE_PLACEHOLDERS. In the cooking steps, a part
 * in [square brackets] disappears when any number inside it is blank, and
 * {or} joins two parts with ", or" only when both are there (text.ts).
 */
import type { BatchBasis, PeriodUnit, ShelfPeriod } from "./dates";
import { PERIOD_UNITS } from "./dates";
import { EAN13_MIN_BAR_HEIGHT_MM } from "./ean13";

export type WidthVariant = "normal" | "semi-condensed" | "condensed";
/** Widest first — the layout tries them in this order before going smaller. */
export const WIDTH_ORDER: WidthVariant[] = ["normal", "semi-condensed", "condensed"];
export const WIDTH_LABEL: Record<WidthVariant, string> = {
  normal: "Barlow",
  "semi-condensed": "Barlow Semi Condensed",
  condensed: "Barlow Condensed",
};

export type BodyWeight = 400 | 500 | 700;
export const BODY_WEIGHTS: BodyWeight[] = [400, 500, 700];

export type FieldKey = "title" | "steps" | "headings" | "storage" | "dates" | "ingredients" | "allergenInfo" | "address";
export const FIELD_KEYS: FieldKey[] = ["title", "steps", "headings", "storage", "dates", "ingredients", "allergenInfo", "address"];
export const FIELD_LABEL: Record<FieldKey, string> = {
  title: "Title",
  steps: "Cooking steps",
  // "STORAGE INSTRUCTIONS:" and "THE INGREDIENTS:" — ONE style so they can't
  // drift apart, printed at a FIXED size (its biggest): only the text under
  // them shrinks to fit (Graeme, 2026-10-11).
  headings: "Section headings (storage & ingredients)",
  storage: "Storage instructions",
  dates: "Use-by dates & batch",
  ingredients: "Ingredients",
  allergenInfo: "Allergen note, may contain & warning",
  address: "Address",
};

export interface FieldStyle {
  /** Preferred width; the layout tries narrower ones before smaller sizes
   *  when allowNarrower is on. */
  width: WidthVariant;
  allowNarrower: boolean;
  /** Weight of ordinary text (bold text always uses 700). */
  weight: BodyWeight;
  /** Point sizes. minPt is raised to the legal minimum if set below it. */
  minPt: number;
  maxPt: number;
  /** Extra space between letters, in ems (−0.05 … 0.2). */
  letterSpacingEm: number;
  /** Line pitch as a multiple of the type size. */
  lineHeight: number;
  /** Whole field bold / capitals. */
  bold: boolean;
  caps: boolean;
  /** Line alignment inside the block (the title is centred). */
  align: "left" | "center";
}

export interface PageSettings {
  widthMm: number;
  heightMm: number;
  dpi: number;
  marginMm: number;
  /** Left column width as a % of the space inside the margins. */
  columnSplitPct: number;
  columnGapMm: number;
  titleBandMm: number;
  stepsBandMm: number;
  /** Space between the title, steps and the columns. */
  bandGapMm: number;
  /** Space between stacked fields inside a column. */
  fieldGapMm: number;
  stepCircleMm: number;
  /** Height of the barcode BARS (digits sit underneath). At least
   *  EAN13_MIN_BAR_HEIGHT_MM (12 mm); under GS1's recommended 18.3 mm the
   *  settings warn. */
  barcodeHeightMm: number;
  /** Barcode width as a % of EAN-13 nominal size (0.33 mm bars), 80–200.
   *  The bars are then snapped to whole printer dots, so the printed size is
   *  the nearest whole-dot size (shown on the proof). */
  barcodeSizePct: number;
  /** UK FIC Art. 13(3): the pack's largest surface is under 80 cm², so the
   *  minimum x-height is 0.9 mm instead of 1.2 mm. About the PACK, not the
   *  label. */
  smallPack: boolean;
}

export interface TemplateText {
  /** e.g. "{name} - {packSize} PACK" */
  title: string;
  /** The numbered cooking steps, in order (1..n). A blank step isn't drawn
   *  and the numbering closes up. Up to MAX_STEPS. */
  steps: string[];
  storageHeading: string;
  storage: string;
  chilledLabel: string;
  frozenLabel: string;
  batchLabel: string;
  ingredientsHeading: string;
  allergenNote: string;
  warning: string;
  address: string;
}

/** Customer cooking instructions. NOT the factory oven setting on the recipe
 *  (that's the part-bake: 205 °C for ~6 minutes) — printing those would tell
 *  a customer to under-cook. Null = blank (the part drops from the sentence). */
export interface CookingValues {
  ovenTempC: number | null;
  fanTempC: number | null;
  ovenMinMinutes: number | null;
  ovenMaxMinutes: number | null;
  airFryerTempC: number | null;
  airFryerMinMinutes: number | null;
  airFryerMaxMinutes: number | null;
}
export const COOKING_KEYS: (keyof CookingValues)[] = [
  "ovenTempC", "fanTempC", "ovenMinMinutes", "ovenMaxMinutes", "airFryerTempC", "airFryerMinMinutes", "airFryerMaxMinutes",
];

export interface LabelTemplate {
  page: PageSettings;
  fields: Record<FieldKey, FieldStyle>;
  text: TemplateText;
  cooking: CookingValues;
  /** Chilled use-by when neither the recipe's label nor its shelf life sets
   *  one (Graeme, 2026-10-10: calzone standard 13 days). */
  chilledDefault: ShelfPeriod | null;
  /** Frozen use-by when the recipe doesn't set its own. Null = no frozen line. */
  frozenDefault: ShelfPeriod | null;
  batchBasis: BatchBasis;
  /** Bold the allergen list in the may-contain statement. */
  mayContainBoldList: boolean;
}

export const TEMPLATE_PLACEHOLDERS: Record<string, string> = {
  "{name}": "Label name (the recipe name unless the recipe sets its own)",
  "{packSize}": "Pack size, e.g. 2",
  "{ovenTemp}": "Oven °C",
  "{fanTemp}": "Fan oven °C",
  "{ovenMin}": "Oven minutes, from",
  "{ovenMax}": "Oven minutes, to",
  "{airTemp}": "Air fryer °C",
  "{airMin}": "Air fryer minutes, from",
  "{airMax}": "Air fryer minutes, to",
  "{ovenFirst}": "Oven minutes before turning (one number, e.g. 10)",
  "{ovenSecond}": "Oven minutes after turning (e.g. 8–12)",
  "{airFirst}": "Air fryer minutes before turning",
  "{airSecond}": "Air fryer minutes after turning",
  // Older fill-ins, still working: the first half is now one fixed number,
  // so {ovenHalfMin} and {ovenHalfMax} are the same and "10–10" prints "10".
  "{ovenHalfMin}": "Oven, before turning (same as {ovenFirst})",
  "{ovenHalfMax}": "Oven, before turning (same as {ovenFirst})",
  "{ovenHalf2Min}": "Oven, after turning — from",
  "{ovenHalf2Max}": "Oven, after turning — to",
  "{airHalfMin}": "Air fryer, before turning (same as {airFirst})",
  "{airHalfMax}": "Air fryer, before turning (same as {airFirst})",
  "{airHalf2Min}": "Air fryer, after turning — from",
  "{airHalf2Max}": "Air fryer, after turning — to",
};

const field = (f: Partial<FieldStyle>): FieldStyle => ({
  width: "normal", allowNarrower: true, weight: 400, minPt: 6.75, maxPt: 9,
  letterSpacingEm: 0, lineHeight: 1.12, bold: false, caps: false, align: "left", ...f,
});

export const DEFAULT_TEMPLATE: LabelTemplate = {
  page: {
    // Graeme's label stock: 140 × 94 mm on a 203 dpi printer, with ~4.5 mm
    // clear all round (rounded corners; ink closer to the edge gets cut off).
    widthMm: 140, heightMm: 94, dpi: 203, marginMm: 4.5,
    columnSplitPct: 44, columnGapMm: 4,
    // Steps band 9 mm (2026-10-12, was 13): room for exactly two lines at
    // ~10.75 pt, so step 1 sits on two lines instead of three, and the
    // 4 mm saved goes to the storage / ingredients / barcode columns.
    titleBandMm: 9, stepsBandMm: 9, bandGapMm: 2, fieldGapMm: 2,
    stepCircleMm: 5.5,
    // Step widths are worked out automatically (layout.ts): a step written as
    // whole lines (step 2's cooking lines) gets just the width its longest
    // line needs, the rest share what's left.
    // Graeme 2026-10-10: 21 mm looked too tall, 11 mm too short — "wider
    // but shorter, somewhere in the middle". 151% = whole 4-dot modules at
    // 203 dpi (bars 47.5 mm wide, ~56.5 mm with quiet zones, like his current
    // ~47 mm barcode). Bars 15 mm (2026-10-12: 18.5 was still too tall) —
    // under GS1's recommended 18.3 mm, which handheld scanners read fine;
    // the settings say so.
    barcodeHeightMm: 15, barcodeSizePct: 151,
    smallPack: false,
  },
  fields: {
    title: field({ weight: 700, bold: true, caps: true, minPt: 12, maxPt: 22, lineHeight: 1.0, align: "center" }),
    // Two steps share the row now, so they can be bigger: up to 12 pt (11.25
    // pt condensed with the real Chicken & Chorizo, without squeezing the deck).
    steps: field({ maxPt: 12, lineHeight: 1.1 }),
    storage: field({ maxPt: 10 }),
    dates: field({ weight: 700, bold: true, maxPt: 11 }),
    ingredients: field({ maxPt: 10 }),
    allergenInfo: field({ maxPt: 10 }),
    address: field({ maxPt: 9 }),
    // Fixed size: printed at maxPt, never shrunk or narrowed.
    headings: field({ weight: 700, bold: true, caps: true, minPt: 10, maxPt: 10, lineHeight: 1.1, allowNarrower: false }),
  },
  text: {
    title: "{name} - {packSize} PACK",
    // Two steps (Graeme, 2026-10-11): the old step 3 ("Check they're piping
    // hot…") is gone. Step 1 is the one "some people get wrong", so its key
    // words are bold. Step 2: one line per appliance, the turn in the middle
    // and the time halved; a line with a blank number drops out.
    steps: [
      "Remove the film but **leave the calzones in the wooden tray**.",
      "[**OVEN** {ovenTemp}°C[ ({fanTemp}°C fan)]: {ovenHalfMin}–{ovenHalfMax} min ➜ **TURN OVER** ➜ {ovenHalf2Min}–{ovenHalf2Max} min]\n[**AIR FRYER** {airTemp}°C: {airHalfMin}–{airHalfMax} min ➜ **TURN OVER** ➜ {airHalf2Min}–{airHalf2Max} min]",
    ],
    storageHeading: "STORAGE INSTRUCTIONS:",
    storage: "If chilled, keep me below 5°C. If frozen, keep below -18°C. If you decide to freeze me, please do so immediately, fully defrost in a fridge before cooking and eat within 24 hours of defrosting.",
    chilledLabel: "IF CHILLED USE BY:",
    frozenLabel: "IF FROZEN USE BY:",
    batchLabel: "BATCH NUMBER:",
    ingredientsHeading: "THE INGREDIENTS:",
    allergenNote: "Allergens are shown in **Bold**.",
    warning: "**WARNING:** Whilst every effort has been made to remove all bones, some may remain.",
    address: "Handcrafted at The Calzone Kitchen, Unit 1b, Lower Rectory Farm, Mill Lane, Great Brickhill, Buckinghamshire, MK17 9FX",
  },
  // Oven values from Graeme's current printed label; air fryer 180 °C for
  // 16–19 minutes (Graeme, 2026-10-10). Recipes can override any of them.
  cooking: {
    ovenTempC: 210, fanTempC: 190, ovenMinMinutes: 18, ovenMaxMinutes: 22,
    airFryerTempC: 180, airFryerMinMinutes: 16, airFryerMaxMinutes: 19,
  },
  chilledDefault: { amount: 13, unit: "days" },
  frozenDefault: { amount: 6, unit: "months" },
  batchBasis: "production-day",
  mayContainBoldList: true,
};

// ── Normalising stored settings ────────────────────────────────────────────
// Stored JSON may be partial (an older template, a hand-edited row). Every
// value is checked and clamped here so the layout never sees nonsense.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function num(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function obj(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
export function nullableInt(v: unknown, lo: number, hi: number): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return clamp(Math.round(n), lo, hi);
}
export function normalisePeriod(v: unknown): ShelfPeriod | null {
  const o = obj(v);
  if (o.amount == null) return null;
  const amount = nullableInt(o.amount, 0, 999);
  const unit = PERIOD_UNITS.includes(o.unit as PeriodUnit) ? (o.unit as PeriodUnit) : "days";
  return amount == null || amount <= 0 ? null : { amount, unit };
}

function normaliseField(v: unknown, d: FieldStyle): FieldStyle {
  const o = obj(v);
  const minPt = num(o.minPt, d.minPt, 3, 72);
  return {
    width: WIDTH_ORDER.includes(o.width as WidthVariant) ? (o.width as WidthVariant) : d.width,
    allowNarrower: bool(o.allowNarrower, d.allowNarrower),
    weight: BODY_WEIGHTS.includes(o.weight as BodyWeight) ? (o.weight as BodyWeight) : d.weight,
    minPt,
    maxPt: Math.max(minPt, num(o.maxPt, d.maxPt, 3, 72)),
    letterSpacingEm: num(o.letterSpacingEm, d.letterSpacingEm, -0.05, 0.2),
    lineHeight: num(o.lineHeight, d.lineHeight, 0.8, 2),
    bold: bool(o.bold, d.bold),
    caps: bool(o.caps, d.caps),
    align: o.align === "center" ? "center" : o.align === "left" ? "left" : d.align,
  };
}

export const MAX_STEPS = 4;

/** The steps list. Templates saved before it existed have step1/step2/step3
 *  — read in order, blank ones left out (a blank step isn't drawn). */
function normaliseSteps(t: Record<string, unknown>): string[] {
  if (Array.isArray(t.steps)) {
    return t.steps.filter((s): s is string => typeof s === "string").slice(0, MAX_STEPS);
  }
  const legacy = ["step1", "step2", "step3"].filter(k => k in t);
  if (legacy.length) {
    return legacy.map(k => str(t[k], "")).filter(s => s.trim() !== "");
  }
  return [...DEFAULT_TEMPLATE.text.steps];
}

export function normaliseTemplate(raw: unknown): LabelTemplate {
  const r = obj(raw);
  const p = obj(r.page);
  const D = DEFAULT_TEMPLATE;
  const f = obj(r.fields);
  const t = obj(r.text);
  const c = obj(r.cooking);
  const fields = {} as Record<FieldKey, FieldStyle>;
  for (const k of FIELD_KEYS) fields[k] = normaliseField(f[k], D.fields[k]);
  const text = {} as TemplateText;
  for (const k of Object.keys(D.text) as (keyof TemplateText)[]) {
    if (k === "steps") continue;
    (text as unknown as Record<string, string>)[k] = str(t[k], D.text[k] as string);
  }
  text.steps = normaliseSteps(t);
  const cooking = {} as CookingValues;
  for (const k of COOKING_KEYS) cooking[k] = k in c ? nullableInt(c[k], 0, 400) : D.cooking[k];
  return {
    page: {
      widthMm: num(p.widthMm, D.page.widthMm, 20, 300),
      heightMm: num(p.heightMm, D.page.heightMm, 20, 300),
      dpi: [203, 300, 600].includes(Number(p.dpi)) ? Number(p.dpi) : D.page.dpi,
      marginMm: num(p.marginMm, D.page.marginMm, 0, 20),
      columnSplitPct: num(p.columnSplitPct, D.page.columnSplitPct, 20, 80),
      columnGapMm: num(p.columnGapMm, D.page.columnGapMm, 0, 20),
      titleBandMm: num(p.titleBandMm, D.page.titleBandMm, 2, 60),
      stepsBandMm: num(p.stepsBandMm, D.page.stepsBandMm, 2, 60),
      bandGapMm: num(p.bandGapMm, D.page.bandGapMm, 0, 20),
      fieldGapMm: num(p.fieldGapMm, D.page.fieldGapMm, 0, 20),
      stepCircleMm: num(p.stepCircleMm, D.page.stepCircleMm, 2, 20),
      barcodeHeightMm: num(p.barcodeHeightMm, D.page.barcodeHeightMm, EAN13_MIN_BAR_HEIGHT_MM, 60),
      barcodeSizePct: num(p.barcodeSizePct, D.page.barcodeSizePct, 80, 200),
      smallPack: bool(p.smallPack, D.page.smallPack),
    },
    fields,
    text,
    cooking,
    chilledDefault: "chilledDefault" in r ? normalisePeriod(r.chilledDefault) : D.chilledDefault,
    frozenDefault: "frozenDefault" in r ? normalisePeriod(r.frozenDefault) : D.frozenDefault,
    batchBasis: r.batchBasis === "print-day" ? "print-day" : r.batchBasis === "production-day" ? "production-day" : D.batchBasis,
    mayContainBoldList: bool(r.mayContainBoldList, D.mayContainBoldList),
  };
}
