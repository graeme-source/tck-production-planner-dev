/**
 * Snapshot + dates → the words in each field of the label (pure, tested),
 * plus the content problems that stop a label being published (no barcode,
 * no cooking values, an empty deck…). Fitting the words into boxes is
 * layout.ts.
 */
import type { LabelDates } from "./dates";
import { formatLabelDate } from "./dates";
import { checkEan13 } from "./ean13";
import { collapseEqualRanges, cookingPlaceholderValues } from "./cooking";
import { cookingOverCap } from "./cooking-tiers";
import type { LabelSnapshot } from "./snapshot";
import type { FieldKey } from "./template";
import { fillTemplate, mayContainParagraph, mergeRuns, parseBold, type Paragraph } from "./text";

export interface LabelContent {
  title: Paragraph[];
  /** Three steps, each its own box with a numbered circle. */
  steps: Paragraph[][];
  /** "STORAGE INSTRUCTIONS:" / "THE INGREDIENTS:" — the shared, fixed-size
   *  "headings" style; laid out on their own above each column's text. */
  storageHeading: Paragraph[];
  storage: Paragraph[];
  /** The black storage band's words (e.g. "KEEP FROZEN"), or null. */
  storageBanner: string | null;
  dates: Paragraph[];
  /** The big net-quantity line above the barcode ("500g"), or none. */
  netQuantity: Paragraph[];
  ingredientsHeading: Paragraph[];
  ingredients: Paragraph[];
  allergenInfo: Paragraph[];
  address: Paragraph[];
  barcode: string | null;
  /** Things that must be fixed before this label can go live. */
  problems: string[];
}

/** Filled step wording → one paragraph per non-empty line, **bold** parsed.
 *  Wording written AS lines (step 2: one per appliance) keeps each line
 *  whole — its spaces become non-breaking — so "9–11 min" can never be
 *  split from "TURN OVER": the layout goes narrower or smaller instead, and
 *  a line that still can't fit is DOESN'T FIT. Single-line wording wraps
 *  normally. */
export function stepLines(text: string): Paragraph[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const whole = text.trim().includes("\n");
  return lines.map(l => {
    const p = parseBold(l);
    return whole ? p.map(r => ({ ...r, text: r.text.replace(/ /g, " ") })) : p;
  });
}

const heading = (text: string): Paragraph => (text.trim() ? [{ text: text.trim(), bold: true }] : []);
const nonEmpty = (ps: Paragraph[]) => ps.filter(p => p.length > 0);

export function buildLabelContent(s: LabelSnapshot, dates: LabelDates): LabelContent {
  const t = s.template.text;
  const problems: string[] = [];
  const c = s.cooking;
  const values: Record<string, string | number | null> = {
    name: s.labelName,
    packSize: s.packSize,
    // Temperatures, totals and the halves either side of TURN OVER.
    ...cookingPlaceholderValues(c),
  };

  const fill = (src: string, where: string) => {
    const r = fillTemplate(src, values);
    if (r.unknown.length) problems.push(`${where} uses ${r.unknown.map(u => `{${u}}`).join(", ")}, which the label doesn't know — check the spelling in the template.`);
    return r;
  };

  const title = fill(t.title, "The title");
  // Blank steps aren't drawn and the numbering closes up (1..n on the label).
  const steps = t.steps.filter(src => src.trim() !== "").map((src, i) => {
    const r = fill(src, `Step ${i + 1}`);
    if (r.blank.length > 0 && r.filled.length === 0) {
      problems.push(`Step ${i + 1} has no cooking values — set the oven or air-fryer numbers.`);
    }
    // A line break in the wording starts a new line on the label (step 2:
    // one line per appliance); lines left empty by a blank appliance drop.
    // "10–10 min" (a fixed first half written as a range) prints "10 min".
    return stepLines(collapseEqualRanges(r.text));
  }).filter(lines => lines.length > 0);
  if (c.ovenMinMinutes != null && c.ovenMaxMinutes != null && c.ovenMinMinutes > c.ovenMaxMinutes) {
    problems.push(`Oven minutes run backwards (${c.ovenMinMinutes}–${c.ovenMaxMinutes}).`);
  }
  if (c.airFryerMinMinutes != null && c.airFryerMaxMinutes != null && c.airFryerMinMinutes > c.airFryerMaxMinutes) {
    problems.push(`Air-fryer minutes run backwards (${c.airFryerMinMinutes}–${c.airFryerMaxMinutes}).`);
  }
  // The longest cook we ever print (template cookingTiers; a snapshot
  // published before it existed has none, so nothing is checked).
  problems.push(...cookingOverCap(c, s.template.cookingTiers as LabelSnapshot["template"]["cookingTiers"] | undefined));

  const dateLine = (label: string, value: string): Paragraph => mergeRuns([...parseBold(label.trim()), { text: ` ${value}`, bold: false }]);
  const dateLines: Paragraph[] = [];
  if (s.template.chilledUseByOn !== false) {
    if (dates.chilledUseBy) dateLines.push(dateLine(t.chilledLabel, formatLabelDate(dates.chilledUseBy)));
    else problems.push("No chilled use-by — set the recipe's shelf life or a chilled period on this label.");
  }
  if (dates.frozenUseBy) dateLines.push(dateLine(t.frozenLabel, formatLabelDate(dates.frozenUseBy)));
  else if (s.template.chilledUseByOn === false) problems.push("No use-by — this template prints only the frozen use-by; switch the frozen line on or set a frozen period.");
  dateLines.push(dateLine(t.batchLabel, dates.batchCode));

  if (!s.deckText.trim()) problems.push("The ingredient deck is empty.");
  const allergenInfo: Paragraph[] = [parseBold(t.allergenNote)];
  if (s.mayContain) allergenInfo.push(mayContainParagraph(s.mayContain, s.template.mayContainBoldList));
  const storage: Paragraph[] = [parseBold(t.storage.trim())];
  if (s.warningOn && t.warning.trim()) {
    (s.template.warningPlacement === "storage" ? storage : allergenInfo).push(parseBold(t.warning.trim()));
  }
  const netQuantity = s.template.netQuantity?.on ? (s.netQuantity?.trim() ?? "") : null;
  if (netQuantity === "") problems.push("No net quantity — set it in this recipe's label settings (e.g. 500g).");

  if (!s.barcode) problems.push("No barcode number yet.");
  else {
    const b = checkEan13(s.barcode);
    if (!b.ok) problems.push(`Barcode number isn't valid: ${b.reason}.`);
  }

  return {
    title: nonEmpty([parseBold(title.text.trim())]),
    steps,
    storageHeading: nonEmpty([heading(t.storageHeading)]),
    storage: nonEmpty(storage),
    storageBanner: s.template.storageBanner?.on && s.template.storageBanner.text.trim() ? s.template.storageBanner.text.trim().toUpperCase() : null,
    dates: dateLines,
    netQuantity: netQuantity ? [[{ text: netQuantity, bold: true }]] : [],
    ingredientsHeading: nonEmpty([heading(t.ingredientsHeading)]),
    ingredients: nonEmpty([parseBold(s.deckText.trim())]),
    allergenInfo: nonEmpty(allergenInfo),
    address: nonEmpty([parseBold(t.address.trim())]),
    barcode: s.barcode && checkEan13(s.barcode).ok ? s.barcode : null,
    problems,
  };
}

/** Field → its paragraphs (steps flattened), for the layout. */
export function fieldParagraphs(c: LabelContent, key: FieldKey): Paragraph[] {
  if (key === "steps") return c.steps.flat();
  if (key === "headings") return [...c.storageHeading, ...c.ingredientsHeading];
  return c[key];
}
