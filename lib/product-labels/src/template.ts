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
import { mmToDots } from "@workspace/units";
import type { BatchBasis, PeriodUnit, ShelfPeriod } from "./dates";
import { PERIOD_UNITS } from "./dates";
import { EAN13_MIN_BAR_HEIGHT_MM } from "./ean13";
import { DEFAULT_COOKING_TIERS, normaliseCookingTiers, type CookingTiersConfig } from "./cooking-tiers";

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

export type FieldKey = "title" | "subtitle" | "steps" | "headings" | "storage" | "dates" | "ingredients" | "allergenInfo" | "address";
export const FIELD_KEYS: FieldKey[] = ["title", "subtitle", "steps", "headings", "storage", "dates", "ingredients", "allergenInfo", "address"];
export const FIELD_LABEL: Record<FieldKey, string> = {
  title: "Title",
  // A small line under the title (e.g. "Recipe by Chris"); blank = not
  // drawn and the label is laid out exactly as without it (2026-10-27).
  subtitle: "Subtitle (under the title)",
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
  /** Preferred width; the layout tries narrower ones (down to `narrowest`)
   *  before smaller sizes. */
  width: WidthVariant;
  /** The narrowest width this field may go to. Equal to `width` = never
   *  narrower. Body text stops at Semi Condensed: Barlow Condensed — bold
   *  allergen words above all — was hard to read on the printed label
   *  (Graeme, 2026-10-12). Replaces the old on/off `allowNarrower` (true =
   *  condensed, false = the preferred width; normaliseTemplate reads both). */
  narrowest: WidthVariant;
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
  /** Step-number circles as tall as the step's text (cap top of the first
   *  line to the bottom of the last — two lines = about the steps band),
   *  worked out from the size the steps actually fit at (Graeme, 2026-10-12:
   *  "make those 1 and 2 steps really obvious", like his original design).
   *  Off = a fixed circle of stepCircleMm. */
  stepCircleAuto: boolean;
  /** The circle's size when stepCircleAuto is off. */
  stepCircleMm: number;
  /** Height of the barcode BARS (digits sit underneath). At least
   *  EAN13_MIN_BAR_HEIGHT_MM (12 mm); under GS1's recommended 18.3 mm the
   *  settings warn. */
  barcodeHeightMm: number;
  /** Barcode width as a % of EAN-13 nominal size (0.33 mm bars), 80–200.
   *  The bars are then snapped to whole printer dots, so the printed size is
   *  the nearest whole-dot size (shown on the proof). */
  barcodeSizePct: number;
  /** A thin rule across the label between the cooking steps and the two
   *  columns, splitting it into "how to cook" and "what's in it" (Graeme,
   *  2026-10-12). Drawn centred in the band gap, in whole printer dots. */
  dividerOn: boolean;
  /** Its thickness; rounded to whole dots, never under one dot. */
  dividerMm: number;
  /** UK FIC Art. 13(3): the pack's largest surface is under 80 cm², so the
   *  minimum x-height is 0.9 mm instead of 1.2 mm. About the PACK, not the
   *  label. */
  smallPack: boolean;
}

export interface TemplateText {
  /** e.g. "{name} - {packSize} PACK" */
  title: string;
  /** A small line under the title, e.g. "Recipe by Chris". Blank = none. */
  subtitle: string;
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
  /** Suggested cooking times by weight per calzone (cooking-tiers.ts):
   *  the tiers, their times and the longest cook ever printed. Off until a
   *  manager switches it on. Like the standard cooking values, it only
   *  matters through the resolved cooking in a snapshot. */
  cookingTiers: CookingTiersConfig;
  /** Chilled use-by when neither the recipe's label nor its shelf life sets
   *  one (Graeme, 2026-10-10: calzone standard 13 days). */
  chilledDefault: ShelfPeriod | null;
  /** Frozen use-by when the recipe doesn't set its own. Null = no frozen line. */
  frozenDefault: ShelfPeriod | null;
  batchBasis: BatchBasis;
  /** Bold the allergen list in the may-contain statement. */
  mayContainBoldList: boolean;
  /** Words that switch the bones warning on for a recipe left on
   *  Automatic: any of them anywhere in its ingredients (whole word, any
   *  case — bones.ts). Empty = Automatic is always off. */
  boneRiskWords: string[];
  /** A solid black band at the top of the storage column — white bold
   *  capitals with a drawn snowflake either side (direct thermal prints
   *  black only) — for products that must be stored frozen (fried chicken,
   *  2026-10-12). Off on the standard calzone label. */
  storageBanner: StorageBanner;
  /** Print the chilled use-by line. Off = frozen use-by only (labelled by
   *  text.frozenLabel, e.g. "USE BY:"), for frozen-only products. */
  chilledUseByOn: boolean;
  /** A big bold net-quantity line (e.g. "500g") above the barcode, from the
   *  recipe's label settings. Off on the standard label. */
  netQuantity: { on: boolean; sizePt: number };
  /** Where the bones warning goes: with the allergen note (standard) or at
   *  the end of the storage text. */
  warningPlacement: "allergens" | "storage";
  /** Recipe categories (recipes.category, any case) that use this template
   *  when the recipe hasn't picked one (template-choice.ts) — e.g. a new
   *  macaroni cheese gets the Macaroni cheese label, not the calzone one.
   *  Doesn't change what prints, so it isn't part of a label's comparison. */
  defaultForCategories: string[];
}

export interface StorageBanner {
  on: boolean;
  /** e.g. "KEEP FROZEN" — printed in capitals. */
  text: string;
  snowflake: boolean;
  /** Band height. */
  heightMm: number;
}

export const TEMPLATE_PLACEHOLDERS: Record<string, string> = {
  "{name}": "Label name (the recipe name unless the recipe sets its own)",
  "{weightFirstName}": "The weight, then the name — e.g. 500g - Korean Fried Chicken (the net quantity, else the weight in the name; just the name if neither)",
  "{packSize}": "Pack size, e.g. 2",
  "{ovenTemp}": "Oven °C",
  "{fanTemp}": "Fan oven °C",
  "{ovenTemps}": "Oven temperatures, fan first, e.g. 180°C fan (200°C)",
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
  width: "normal", narrowest: "semi-condensed", weight: 400, minPt: 6.75, maxPt: 9,
  letterSpacingEm: 0, lineHeight: 1.12, bold: false, caps: false, align: "left", ...f,
});

export const DEFAULT_TEMPLATE: LabelTemplate = {
  page: {
    // Graeme's label stock: 140 × 94 mm on a 203 dpi printer, with ~4.5 mm
    // clear all round (rounded corners; ink closer to the edge gets cut off).
    widthMm: 140, heightMm: 94, dpi: 203, marginMm: 4.5,
    // Left column 41% (was 44), gap 3 mm (was 4): ~5 mm more width for the
    // ingredients, so a big deck reads wide and short rather than tall
    // (Graeme, 2026-10-12). The 151% barcode still fits because its blank
    // quiet zones may sit in the margin and the column gap (layout.ts).
    columnSplitPct: 41, columnGapMm: 3,
    // Gaps 3 mm (2026-10-12, were 2): the printed label looked crowded —
    // the steps sat on STORAGE INSTRUCTIONS and the use-by lines ran on
    // from the storage text like one paragraph. The band gap also holds the
    // divider rule. The extra 2 mm comes out of the title band (7 mm, was 9:
    // a one-line 22 pt title still fits) and the steps band (8 mm, was 9:
    // two lines up to ~10.5 pt), so the longest real deck (The Godfather)
    // still fits at the legal minimum in Semi Condensed.
    titleBandMm: 7, stepsBandMm: 8, bandGapMm: 3, fieldGapMm: 3,
    stepCircleAuto: true, stepCircleMm: 5.5,
    // 0.25 mm = 2 dots at 203 dpi: a hairline that still prints solidly.
    dividerOn: true, dividerMm: 0.25,
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
    // Readability (Graeme, 2026-10-12, after the first DA210 prints): a
    // touch smaller, with more white space, and body text never narrower
    // than Barlow Semi Condensed. Only the title (big, short) may still go
    // fully condensed.
    title: field({ weight: 700, bold: true, caps: true, minPt: 12, maxPt: 22, lineHeight: 1.0, align: "center", narrowest: "condensed" }),
    // Only drawn when the template's subtitle wording isn't blank.
    subtitle: field({ maxPt: 9, lineHeight: 1.1, align: "center" }),
    steps: field({ maxPt: 10.5, lineHeight: 1.1 }),
    // Storage and ingredients up to "a couple of points bigger" (Graeme,
    // 2026-10-12, after the proofs). Storage 10.5 is the biggest that stays
    // in plain Barlow beside the dates and barcode (11 only fits Semi
    // Condensed); a long deck still shrinks — biggest first, so it squeezes
    // down to the allergen note's 9 pt before that gets any smaller.
    // Storage and dates prefer Barlow Semi Condensed now the left column is
    // narrower (Graeme, 2026-10-12: "we can afford to make those storage
    // instructions a bit narrower").
    storage: field({ maxPt: 10.5, width: "semi-condensed" }),
    dates: field({ weight: 700, bold: true, maxPt: 10, width: "semi-condensed" }),
    // Never bigger than the storage text (Graeme, 2026-10-12): a short deck
    // like the Margherita grew to 11 pt and looked like the most important
    // thing on the label. Long decks still shrink as before.
    ingredients: field({ maxPt: 10.5 }),
    allergenInfo: field({ maxPt: 9 }),
    address: field({ maxPt: 8 }),
    // Fixed size: printed at maxPt, never shrunk or narrowed. 12.5 pt: a
    // clear step up from the 10.5–11 pt text under it, and "STORAGE
    // INSTRUCTIONS:" almost fills the storage column (Graeme, 2026-10-12).
    // The longest deck (The Godfather) still fits at its usual size.
    headings: field({ weight: 700, bold: true, caps: true, minPt: 12.5, maxPt: 12.5, lineHeight: 1.1, narrowest: "normal" }),
  },
  text: {
    title: "{name} - {packSize} PACK",
    subtitle: "",
    // Two steps (Graeme, 2026-10-11): the old step 3 ("Check they're piping
    // hot…") is gone. Step 1 is the one "some people get wrong", so its key
    // words are bold. Step 2: one line per appliance, the turn in the middle
    // and the time halved; a line with a blank number drops out.
    steps: [
      "Remove the film but **leave the calzones in the wooden tray**.",
      "[**OVEN** {ovenTemps}: {ovenHalfMin}–{ovenHalfMax} min ➜ **TURN OVER** ➜ {ovenHalf2Min}–{ovenHalf2Max} min]\n[**AIR FRYER** {airTemp}°C: {airHalfMin}–{airHalfMax} min ➜ **TURN OVER** ➜ {airHalf2Min}–{airHalf2Max} min]",
    ],
    storageHeading: "STORAGE INSTRUCTIONS:",
    // Every fact of the old wording, shorter (2026-10-12): chilled below
    // 5 °C; frozen below -18 °C; freeze immediately; defrost fully in the
    // fridge before cooking; eat within 24 hours of defrosting.
    storage: "Keep chilled below 5°C, or freeze immediately and keep below -18°C. Defrost fully in the fridge before cooking and eat within 24 hours of defrosting.",
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
  cookingTiers: DEFAULT_COOKING_TIERS,
  chilledDefault: { amount: 13, unit: "days" },
  frozenDefault: { amount: 6, unit: "months" },
  batchBasis: "production-day",
  mayContainBoldList: true,
  // Graeme, 2026-10-12: "anything with chicken in it" may have bones —
  // and turkey too.
  boneRiskWords: ["chicken", "turkey"],
  storageBanner: { on: false, text: "KEEP FROZEN", snowflake: true, heightMm: 6.5 },
  chilledUseByOn: true,
  netQuantity: { on: false, sizePt: 16 },
  warningPlacement: "allergens",
  defaultForCategories: [],
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

function isWidth(v: unknown): v is WidthVariant {
  return WIDTH_ORDER.includes(v as WidthVariant);
}

/** The narrowest width a field may use — never wider than its preferred
 *  width. Templates saved before it existed have `allowNarrower` instead:
 *  on = all the way to Condensed (what it did), off = the preferred width. */
function normaliseNarrowest(o: Record<string, unknown>, width: WidthVariant, fallback: WidthVariant): WidthVariant {
  const narrowest = isWidth(o.narrowest)
    ? o.narrowest
    : typeof o.allowNarrower === "boolean"
      ? (o.allowNarrower ? "condensed" : width)
      : fallback;
  return WIDTH_ORDER.indexOf(narrowest) < WIDTH_ORDER.indexOf(width) ? width : narrowest;
}

/** The widths a field may use, widest first: its preferred width down to its
 *  narrowest. */
export function allowedWidths(style: Pick<FieldStyle, "width" | "narrowest">): WidthVariant[] {
  const start = WIDTH_ORDER.indexOf(style.width);
  return WIDTH_ORDER.slice(start, Math.max(start, WIDTH_ORDER.indexOf(style.narrowest)) + 1);
}

/** The divider's printed thickness in whole printer dots — never under one
 *  dot, so a hairline setting still prints. */
export function dividerDots(page: Pick<PageSettings, "dividerMm" | "dpi">): number {
  return Math.max(1, Math.round(mmToDots(page.dividerMm, page.dpi)));
}

function normaliseField(v: unknown, d: FieldStyle): FieldStyle {
  const o = obj(v);
  const minPt = num(o.minPt, d.minPt, 3, 72);
  const width = isWidth(o.width) ? o.width : d.width;
  return {
    width,
    narrowest: normaliseNarrowest(o, width, d.narrowest),
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

function normaliseBanner(v: unknown, d: StorageBanner): StorageBanner {
  const o = obj(v);
  return {
    on: bool(o.on, d.on),
    text: str(o.text, d.text).slice(0, 40),
    snowflake: bool(o.snowflake, d.snowflake),
    heightMm: num(o.heightMm, d.heightMm, 3, 20),
  };
}

/** A word list: trimmed, blanks and repeats (any case) dropped, at most 50
 *  words of 60 characters. Not a list = the default; an empty list stays
 *  empty (Automatic then never switches the warning on). */
function normaliseWords(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return [...fallback];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of v) {
    if (typeof w !== "string") continue;
    const word = w.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push(word);
  }
  return out.slice(0, 50);
}

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
      dividerOn: bool(p.dividerOn, D.page.dividerOn),
      dividerMm: num(p.dividerMm, D.page.dividerMm, 0.05, 2),
      // Templates saved before it existed get the default (auto).
      stepCircleAuto: bool(p.stepCircleAuto, D.page.stepCircleAuto),
      stepCircleMm: num(p.stepCircleMm, D.page.stepCircleMm, 2, 20),
      barcodeHeightMm: num(p.barcodeHeightMm, D.page.barcodeHeightMm, EAN13_MIN_BAR_HEIGHT_MM, 60),
      barcodeSizePct: num(p.barcodeSizePct, D.page.barcodeSizePct, 80, 200),
      smallPack: bool(p.smallPack, D.page.smallPack),
    },
    fields,
    text,
    cooking,
    // Templates saved before it existed get the default tiers, switched off.
    cookingTiers: normaliseCookingTiers(r.cookingTiers),
    chilledDefault: "chilledDefault" in r ? normalisePeriod(r.chilledDefault) : D.chilledDefault,
    frozenDefault: "frozenDefault" in r ? normalisePeriod(r.frozenDefault) : D.frozenDefault,
    batchBasis: r.batchBasis === "print-day" ? "print-day" : r.batchBasis === "production-day" ? "production-day" : D.batchBasis,
    mayContainBoldList: bool(r.mayContainBoldList, D.mayContainBoldList),
    boneRiskWords: normaliseWords(r.boneRiskWords, D.boneRiskWords),
    // Templates saved before these existed get the standard behaviour.
    storageBanner: normaliseBanner(r.storageBanner, D.storageBanner),
    chilledUseByOn: bool(r.chilledUseByOn, D.chilledUseByOn),
    netQuantity: {
      on: bool(obj(r.netQuantity).on, D.netQuantity.on),
      sizePt: num(obj(r.netQuantity).sizePt, D.netQuantity.sizePt, 6.75, 40),
    },
    warningPlacement: r.warningPlacement === "storage" ? "storage" : r.warningPlacement === "allergens" ? "allergens" : D.warningPlacement,
    defaultForCategories: normaliseWords(r.defaultForCategories, D.defaultForCategories),
  };
}

// ── Template presets ───────────────────────────────────────────────────────
// Starting designs a manager can add as a new label template (Label design &
// type → "Add a template"). Once added, a template is an ordinary stored row:
// edited on the design page, chosen per recipe in its label settings.

export interface TemplatePreset {
  key: string;
  name: string;
  description: string;
  build: () => LabelTemplate;
}

/** Fried chicken — Graeme's Label LIVE fried chicken label (2026-10-12),
 *  made clearer: three oven steps, a KEEP FROZEN band (customers expect our
 *  products chilled; these must be stored frozen — said without mentioning
 *  how they arrive), frozen use-by only, net quantity above the barcode, the
 *  title as the recipe name, the bones warning (automatic, chicken) under
 *  the storage text, and ingredients allowed down to Barlow Condensed for
 *  the longest decks. */
export function friedChickenTemplate(): LabelTemplate {
  const t = normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));
  // The weight leads, so 500g and 1.2kg of the same flavour are easy to tell
  // apart when picking (Graeme, 2026-10-27).
  t.text.title = "{weightFirstName}";
  // Graeme's current fried chicken label (Label LIVE), tidied; the numbers
  // are the template's cooking values, so a recipe can override them.
  t.text.steps = [
    "**COOK FROM FROZEN.** Pre-heat the oven to {ovenTemps} and remove all packaging.",
    "Spread the chicken strips across a baking tray.",
    "Cook for {ovenMin}–{ovenMax} minutes until piping hot and crunchy.",
  ];
  t.cooking = {
    ovenTempC: 190, fanTempC: 170, ovenMinMinutes: 14, ovenMaxMinutes: 16,
    airFryerTempC: null, airFryerMinMinutes: null, airFryerMaxMinutes: null,
  };
  // Weight tiers are for calzones; fried chicken has its own times.
  t.cookingTiers = { ...t.cookingTiers, on: false };
  // Three wrapping steps need a taller band than the calzone's two.
  t.page.stepsBandMm = 11;
  // Stored frozen — said unmistakably, without mentioning how it arrives.
  t.storageBanner = { ...t.storageBanner, on: true, text: "KEEP FROZEN", snowflake: true };
  t.text.storageHeading = "";
  t.text.storage = "Store at -18°C or below. Cook from frozen.";
  t.chilledUseByOn = false;
  t.text.frozenLabel = "USE BY:";
  t.frozenDefault = { amount: 5, unit: "months" };
  t.netQuantity = { ...t.netQuantity, on: true };
  // The bones warning sits with the storage text, as on Graeme's label,
  // leaving the right column to the long ingredient decks.
  t.warningPlacement = "storage";
  t.text.allergenNote = "For allergens, see ingredients in **bold**.";
  t.fields.ingredients = { ...t.fields.ingredients, narrowest: "condensed" };
  return t;
}

/** Macaroni cheese — Graeme's Label LIVE mac cheese label (2026-10-27):
 *  the title as the recipe name (no pack size), two oven-only steps (no
 *  wooden tray, no turning, no air fryer), BOTH a chilled and a frozen
 *  use-by, the usual ingredients / allergens, no bones warning. */
export function macaroniCheeseTemplate(): LabelTemplate {
  const t = normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));
  t.text.title = "{name}";
  t.text.steps = [
    "Pre-heat the oven to {ovenTemps} and remove the outer film.",
    "Cook in the centre of the oven for {ovenMin}–{ovenMax} minutes until piping hot.",
  ];
  // Oven only, 170 fan (190) for every mac cheese (Graeme, 2026-10-27);
  // a recipe can still set its own.
  t.cooking = {
    ovenTempC: 190, fanTempC: 170, ovenMinMinutes: 20, ovenMaxMinutes: 25,
    airFryerTempC: null, airFryerMinMinutes: null, airFryerMaxMinutes: null,
  };
  // Weight tiers are for calzones. Their "longest cook we print" guard
  // (22 min, a calzone number) would block 20–25 min; mac cheese keeps a
  // guard of its own at 30 min, and has no air fryer.
  t.cookingTiers = { ...t.cookingTiers, on: false, maxOvenMinutes: 30, maxAirFryerMinutes: null };
  t.text.storageHeading = "STORAGE INSTRUCTIONS:";
  t.text.storage = "If chilled, keep me below 5°C. If frozen, keep below -18°C. If you decide to freeze me, please do so immediately, fully defrost in a fridge before cooking and eat within 24 hours of defrosting.";
  // Both use-bys: chilled from the recipe's shelf life (8 days), frozen
  // 3 months (Graeme's printed label: 27 Oct → 27 Jan).
  t.chilledUseByOn = true;
  t.text.chilledLabel = "IF CHILLED USE BY:";
  t.text.frozenLabel = "IF FROZEN USE BY:";
  t.frozenDefault = { amount: 3, unit: "months" };
  // No bones in macaroni cheese: Automatic never switches the warning on.
  t.boneRiskWords = [];
  // A recipe in this category with no template picked gets this one.
  t.defaultForCategories = ["Macaroni Cheese"];
  return t;
}

/** Cinnamon buns — Graeme's Label LIVE cinnamon bun label (2026-10-27):
 *  "{name} - {packSize} PACK" as on the calzone label, a small "Recipe by
 *  Chris" line under it, three microwave steps (plain wording: there are no
 *  microwave cooking values, and wording with no fill-ins is never flagged),
 *  chilled-only storage, a chilled use-by only, no bones warning. */
export function cinnamonBunsTemplate(): LabelTemplate {
  const t = normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));
  t.text.subtitle = "Recipe by Chris";
  t.text.steps = [
    "Remove the film cover and place the tray in the microwave.",
    "Heat in a microwave on full power for 2 minutes (6 buns). Adjust the cooking time for fewer buns.",
    "Leave to cool for 1 minute and serve.",
  ];
  // No oven or air fryer: nothing to fill in, nothing printed from them.
  t.cooking = {
    ovenTempC: null, fanTempC: null, ovenMinMinutes: null, ovenMaxMinutes: null,
    airFryerTempC: null, airFryerMinMinutes: null, airFryerMaxMinutes: null,
  };
  t.cookingTiers = { ...t.cookingTiers, on: false };
  // Three wrapping steps need a taller band than the calzone's two.
  t.page.stepsBandMm = 11;
  t.text.storageHeading = "STORAGE INSTRUCTIONS:";
  t.text.storage = "Keep me chilled below 5°C. Do not freeze.";
  // Chilled use-by only. The recipe's shelf life sets it, else 5 days (the
  // current printed label). Not to be frozen, so no frozen line.
  t.chilledUseByOn = true;
  t.text.chilledLabel = "USE BY:";
  t.chilledDefault = { amount: 5, unit: "days" };
  t.frozenDefault = null;
  t.boneRiskWords = [];
  t.defaultForCategories = ["Desserts"];
  return t;
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    key: "standard",
    name: "Standard calzone label",
    description: "The calzone label: two cooking steps (wooden tray, oven / air fryer), storage, ingredients and barcode.",
    build: () => normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE))),
  },
  {
    key: "fried-chicken",
    name: "Fried chicken",
    description: "Frozen products: KEEP FROZEN band, frozen use-by only, three oven steps, net quantity above the barcode, room for long ingredient lists.",
    build: friedChickenTemplate,
  },
  {
    key: "macaroni-cheese",
    name: "Macaroni cheese",
    description: "Macaroni cheese: the product name as the title, two oven steps, chilled and frozen use-by dates, storage, ingredients and barcode.",
    build: macaroniCheeseTemplate,
  },
  {
    key: "cinnamon-buns",
    name: "Cinnamon buns",
    description: "Desserts heated in the microwave: a subtitle line under the title, three microwave steps, chilled use-by only (do not freeze), ingredients and barcode.",
    build: cinnamonBunsTemplate,
  },
];
