/**
 * Label snapshots and change detection — the safety feature (pure, tested).
 *
 * A snapshot is EVERY input that decides what a recipe's label says and
 * looks like (except the print-time dates and batch number). The published
 * ("live") version stores one, frozen. The app builds the CURRENT one from
 * the recipe as it is now; if the two differ, the label needs updating and
 * the difference is listed field by field. Change something back and the
 * snapshots match again, so the flag clears by itself — there is no "dirty"
 * bit to get stuck.
 *
 * Recipe edits never touch the live label: printing (Stage 2) reads the
 * published snapshot, never the current one.
 */
import type { ShelfPeriod } from "./dates";
import { describePeriod } from "./dates";
import type { CookingValues, LabelTemplate } from "./template";
import { COOKING_KEYS, FIELD_KEYS, FIELD_LABEL, normaliseTemplate, type FieldKey } from "./template";

/** Per-recipe label settings (product_label_settings). Null cooking / period
 *  values mean "use the template's default". */
export interface RecipeLabelSettings {
  barcode: string | null;
  labelName: string | null;
  ovenOn: boolean;
  airFryerOn: boolean;
  cooking: CookingValues;
  warningOn: boolean;
  chilled: ShelfPeriod | null;
  frozenOn: boolean;
  frozen: ShelfPeriod | null;
}

export const EMPTY_COOKING: CookingValues = {
  ovenTempC: null, fanTempC: null, ovenMinMinutes: null, ovenMaxMinutes: null,
  airFryerTempC: null, airFryerMinMinutes: null, airFryerMaxMinutes: null,
};

export const DEFAULT_RECIPE_LABEL_SETTINGS: RecipeLabelSettings = {
  barcode: null, labelName: null, ovenOn: true, airFryerOn: true,
  cooking: { ...EMPTY_COOKING }, warningOn: true, chilled: null, frozenOn: true, frozen: null,
};

export interface LabelSnapshot {
  recipeName: string;
  /** The name printed in the title. */
  labelName: string;
  packSize: string;
  /** Ingredient deck with **allergens** (from the recipe's deck endpoint). */
  deckText: string;
  mayContain: string | null;
  warningOn: boolean;
  /** Resolved: recipe override, else template default; blank when switched off. */
  cooking: CookingValues;
  chilled: ShelfPeriod | null;
  frozen: ShelfPeriod | null;
  barcode: string | null;
  templateId: number;
  template: LabelTemplate;
}

/** "2.0000" → "2", "1.5000" → "1.5". */
export function formatPackSize(v: string | number | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "1";
  return String(Math.round(n * 1000) / 1000);
}

export function resolveCooking(template: LabelTemplate, s: RecipeLabelSettings): CookingValues {
  const out = { ...EMPTY_COOKING };
  for (const k of COOKING_KEYS) {
    const isAir = k.startsWith("airFryer");
    if (isAir ? !s.airFryerOn : !s.ovenOn) { out[k] = null; continue; }
    out[k] = s.cooking[k] ?? template.cooking[k];
  }
  return out;
}

export function buildSnapshot(input: {
  recipe: { name: string; packSize: string | number; shelfLifeDays: number | null };
  deck: { deckText: string; mayContainStatement: string | null };
  settings: RecipeLabelSettings;
  templateId: number;
  template: LabelTemplate;
}): LabelSnapshot {
  const { recipe, deck, settings: s, template } = input;
  // Chilled use-by: the label's own setting → the recipe's shelf life (some
  // calzones are deliberately 10 days) → the standard (13 days).
  const chilled = s.chilled
    ?? (recipe.shelfLifeDays && recipe.shelfLifeDays > 0 ? { amount: recipe.shelfLifeDays, unit: "days" as const } : null)
    ?? template.chilledDefault;
  return {
    recipeName: recipe.name,
    labelName: s.labelName?.trim() || recipe.name,
    packSize: formatPackSize(recipe.packSize),
    deckText: deck.deckText,
    mayContain: deck.mayContainStatement?.trim() || null,
    warningOn: s.warningOn,
    cooking: resolveCooking(template, s),
    chilled,
    frozen: s.frozenOn ? (s.frozen ?? template.frozenDefault) : null,
    barcode: s.barcode?.replace(/\s+/g, "") || null,
    templateId: input.templateId,
    template,
  };
}

/** JSON with object keys sorted at every level, so equal content always
 *  gives the same string (and hash), whatever order it was built in. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** The part of a snapshot that decides the printed label. The template's
 *  cooking defaults and chilled/frozen defaults only matter through the resolved
 *  cooking / frozen values already in the snapshot, so changing a default
 *  that this recipe overrides doesn't flag its label. recipeName is kept for
 *  the record but isn't compared — labelName is what prints. */
export function comparableSnapshot(s: LabelSnapshot): unknown {
  const { cooking: _c, frozenDefault: _f, chilledDefault: _cd, ...template } = s.template;
  const { recipeName: _r, ...rest } = s;
  return { ...rest, template };
}

/** Canonical key of a snapshot — equal keys = identical printed label
 *  inputs. The server stores a SHA-256 of this. */
export function snapshotKey(s: LabelSnapshot): string {
  return canonicalJson(comparableSnapshot(s));
}

export function snapshotsMatch(a: LabelSnapshot, b: LabelSnapshot): boolean {
  return snapshotKey(a) === snapshotKey(b);
}

export interface SnapshotChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

/** Which parts of the label a change shows up in — the proof highlights
 *  them. "barcode" is the barcode block; "all" = the whole label. */
export function areasForChange(key: string): Array<FieldKey | "barcode" | "all"> {
  if (key === "labelName" || key === "packSize") return ["title"];
  if (key === "deckText") return ["ingredients"];
  if (key === "mayContain" || key === "warningOn" || key === "template.mayContainBoldList") return ["allergenInfo"];
  if (key.startsWith("cooking.")) return ["steps"];
  if (key === "chilled" || key === "frozen" || key === "template.batchBasis") return ["dates"];
  if (key === "barcode") return ["barcode"];
  if (key.startsWith("template.fields.")) return [key.slice("template.fields.".length) as FieldKey];
  if (key.startsWith("template.text.steps")) return ["steps"];
  const text: Record<string, FieldKey> = {
    title: "title", storageHeading: "headings", storage: "storage",
    chilledLabel: "dates", frozenLabel: "dates", batchLabel: "dates", ingredientsHeading: "headings",
    allergenNote: "allergenInfo", warning: "allergenInfo", address: "address",
  };
  if (key.startsWith("template.text.")) {
    const f = text[key.slice("template.text.".length)];
    return f ? [f] : ["all"];
  }
  return ["all"];
}

const COOKING_LABEL: Record<keyof CookingValues, string> = {
  ovenTempC: "Oven temperature (°C)",
  fanTempC: "Fan oven temperature (°C)",
  ovenMinMinutes: "Oven minutes (from)",
  ovenMaxMinutes: "Oven minutes (to)",
  airFryerTempC: "Air fryer temperature (°C)",
  airFryerMinMinutes: "Air fryer minutes (from)",
  airFryerMaxMinutes: "Air fryer minutes (to)",
};

const show = (v: unknown): string => (v == null || v === "" ? "(blank)" : String(v));
const period = (p: ShelfPeriod | null) => (p ? describePeriod(p) : "(none)");

/** What changed between the live label and the label as it would be now. */
export function diffSnapshots(live: LabelSnapshot, current: LabelSnapshot): SnapshotChange[] {
  const out: SnapshotChange[] = [];
  const add = (key: string, label: string, before: string, after: string) => {
    if (before !== after) out.push({ key, label, before, after });
  };
  add("labelName", "Name on the label", live.labelName, current.labelName);
  add("packSize", "Pack size", live.packSize, current.packSize);
  add("deckText", "Ingredients", live.deckText, current.deckText);
  add("mayContain", "May contain statement", show(live.mayContain), show(current.mayContain));
  add("warningOn", "Bones warning", live.warningOn ? "On" : "Off", current.warningOn ? "On" : "Off");
  for (const k of COOKING_KEYS) add(`cooking.${k}`, COOKING_LABEL[k], show(live.cooking[k]), show(current.cooking[k]));
  add("chilled", "Chilled use-by", period(live.chilled), period(current.chilled));
  add("frozen", "Frozen use-by", period(live.frozen), period(current.frozen));
  add("barcode", "Barcode number", show(live.barcode), show(current.barcode));
  add("templateId", "Label template", String(live.templateId), String(current.templateId));
  out.push(...diffTemplates(live.template, current.template));
  // Belt and braces: a mismatch must always say SOMETHING, never "update
  // needed" with an empty list.
  if (out.length === 0 && !snapshotsMatch(live, current)) {
    out.push({ key: "other", label: "Other label settings", before: "as published", after: "changed" });
  }
  return out;
}

/** Template differences by section — the wording field by field, the
 *  typography and page settings as one line each. */
export function diffTemplates(rawA: LabelTemplate, rawB: LabelTemplate): SnapshotChange[] {
  // Snapshots published before a template change (e.g. step1/2/3 before the
  // steps list) are read through the same normaliser, so they compare like
  // for like.
  const a = normaliseTemplate(rawA);
  const b = normaliseTemplate(rawB);
  const out: SnapshotChange[] = [];
  const stepCount = Math.max(a.text.steps.length, b.text.steps.length);
  for (let i = 0; i < stepCount; i++) {
    const before = a.text.steps[i] ?? "";
    const after = b.text.steps[i] ?? "";
    if (before !== after) {
      out.push({
        key: `template.text.steps.${i}`,
        label: `Template wording — step ${i + 1}${after.trim() === "" ? " (removed)" : before.trim() === "" ? " (added)" : ""}`,
        before: before || "(none)", after: after || "(none)",
      });
    }
  }
  for (const k of Object.keys(a.text) as (keyof LabelTemplate["text"])[]) {
    if (k === "steps") continue;
    const before = a.text[k] as string;
    const after = b.text[k] as string;
    if (before !== after) out.push({ key: `template.text.${k}`, label: `Template wording — ${TEXT_LABEL[k] ?? k}`, before, after });
  }
  if (canonicalJson(a.page) !== canonicalJson(b.page)) {
    out.push({ key: "template.page", label: "Template — label size & layout", before: pageSummary(a), after: pageSummary(b) });
  }
  for (const f of FIELD_KEYS) {
    if (canonicalJson(a.fields[f]) !== canonicalJson(b.fields[f])) {
      out.push({ key: `template.fields.${f}`, label: `Template typography — ${FIELD_LABEL[f]}`, before: styleSummary(a, f), after: styleSummary(b, f) });
    }
  }
  if (a.batchBasis !== b.batchBasis) out.push({ key: "template.batchBasis", label: "Batch number taken from", before: a.batchBasis, after: b.batchBasis });
  if (a.mayContainBoldList !== b.mayContainBoldList) out.push({ key: "template.mayContainBoldList", label: "May-contain list in bold", before: a.mayContainBoldList ? "Yes" : "No", after: b.mayContainBoldList ? "Yes" : "No" });
  // template.cooking / chilledDefault / frozenDefault only matter through the resolved values
  // above, which already list them when they change what prints.
  return out;
}

const TEXT_LABEL: Record<string, string> = {
  title: "title",
  storageHeading: "storage heading", storage: "storage instructions",
  chilledLabel: "chilled use-by label", frozenLabel: "frozen use-by label", batchLabel: "batch label",
  ingredientsHeading: "ingredients heading", allergenNote: "allergen note", warning: "warning", address: "address",
};

function pageSummary(t: LabelTemplate): string {
  const p = t.page;
  return `${p.widthMm}×${p.heightMm} mm, ${p.dpi} dpi, margin ${p.marginMm} mm, left column ${p.columnSplitPct}%${p.smallPack ? ", small pack" : ""}`;
}
function styleSummary(t: LabelTemplate, f: (typeof FIELD_KEYS)[number]): string {
  const s = t.fields[f];
  return `${s.width}, ${s.weight}, ${s.minPt}–${s.maxPt} pt, spacing ${s.letterSpacingEm} em, line ${s.lineHeight}${s.bold ? ", bold" : ""}${s.caps ? ", caps" : ""}${s.allowNarrower ? "" : ", no narrower"}`;
}
