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

export type FieldKey = "title" | "steps" | "storage" | "dates" | "ingredients" | "allergenInfo" | "address";
export const FIELD_KEYS: FieldKey[] = ["title", "steps", "storage", "dates", "ingredients", "allergenInfo", "address"];
export const FIELD_LABEL: Record<FieldKey, string> = {
  title: "Title",
  steps: "Cooking steps",
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
  /** Height of the barcode BARS (digits sit underneath). At least 80% of
   *  the EAN-13 nominal 22.85 mm — EAN13_MIN_BAR_HEIGHT_MM. */
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
  step1: string;
  step2: string;
  step3: string;
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
    titleBandMm: 9, stepsBandMm: 13, bandGapMm: 2, fieldGapMm: 2,
    stepCircleMm: 5.5,
    // His current EAN-13: ~47 mm wide with quiet zones × ~21 mm bars ≈ 126%.
    barcodeHeightMm: 21, barcodeSizePct: 126,
    smallPack: false,
  },
  fields: {
    title: field({ weight: 700, bold: true, caps: true, minPt: 12, maxPt: 22, lineHeight: 1.0, align: "center" }),
    steps: field({ maxPt: 10, lineHeight: 1.1 }),
    storage: field({ maxPt: 10 }),
    dates: field({ weight: 700, bold: true, maxPt: 11 }),
    ingredients: field({ maxPt: 10 }),
    allergenInfo: field({ maxPt: 10 }),
    address: field({ maxPt: 9 }),
  },
  text: {
    title: "{name} - {packSize} PACK",
    step1: "Remove the film but leave the calzones in the wooden tray.",
    step2: "Cook[ in the oven at {ovenTemp}°C[ ({fanTemp}°C fan)] for {ovenMin}–{ovenMax} minutes]{or}[ in the air fryer at {airTemp}°C for {airMin}–{airMax} minutes].",
    step3: "Turn the calzones over halfway through, and make sure they're piping hot throughout.",
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
  for (const k of Object.keys(D.text) as (keyof TemplateText)[]) text[k] = str(t[k], D.text[k]);
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
    frozenDefault: "frozenDefault" in r ? normalisePeriod(r.frozenDefault) : D.frozenDefault,
    batchBasis: r.batchBasis === "print-day" ? "print-day" : r.batchBasis === "production-day" ? "production-day" : D.batchBasis,
    mayContainBoldList: bool(r.mayContainBoldList, D.mayContainBoldList),
  };
}
