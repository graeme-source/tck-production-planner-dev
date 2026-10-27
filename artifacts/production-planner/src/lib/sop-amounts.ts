/**
 * Today's amounts, placed inside an SOP's steps (issue #340, Graeme).
 *
 * "If we're doing diced beef and we open the SOP for it, can we automatically
 * ingest the quantities into the SOP" — so nobody closes the SOP to look at
 * the recipe, or props it up on a second screen.
 *
 * The prep row that opens the SOP already knows the day's scaled amounts
 * (it shows them). It hands them over as plain {name, amountText} pairs —
 * this file never computes a quantity, it only finds where each ingredient
 * is named in a step's text so the viewer can put the amount right there.
 *
 * Matching rules: case-insensitive, whole words only (never inside another
 * word), longest name first so "Diced Beef" wins over "Beef", simple plurals
 * either way ("onion" ↔ "onions", "tomato" ↔ "tomatoes"). No ingredient
 * names live in this file — everything comes from the row.
 */

export interface SopAmount {
  /** The ingredient or sub-recipe name as the row shows it. */
  name: string;
  /** The amount already formatted by the row ("12.000 kg", "450 g"). */
  amountText: string;
}

export interface SopAmountsContext {
  /** Heading for the summary card, e.g. "For today: 12.000 kg Diced Beef". */
  title: string;
  amounts: SopAmount[];
}

export type StepSegment =
  | { kind: "text"; text: string }
  /** `text` is the step's own wording (original case); `amount` goes after it. */
  | { kind: "amount"; text: string; amount: SopAmount };

export interface StepWithAmounts {
  segments: StepSegment[];
  /** Amounts this step names, in the order they first appear. */
  mentioned: SopAmount[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
function isWordChar(ch: string | undefined): boolean {
  return ch != null && ch !== "" && WORD_CHAR.test(ch);
}

/** Singular/plural spellings worth trying for one name. */
function variantsOf(name: string): string[] {
  const out = new Set<string>([name, `${name}s`, `${name}es`]);
  if (/es$/i.test(name) && name.length > 3) out.add(name.slice(0, -2));
  if (/[^s]s$/i.test(name) && name.length > 2) out.add(name.slice(0, -1));
  return [...out];
}

function patternFor(name: string): RegExp {
  const alts = variantsOf(name)
    .sort((a, b) => b.length - a.length)
    // Any run of spaces in the name matches any run of whitespace in the step.
    .map(v => v.split(/\s+/).map(escapeRegExp).join("\\s+"));
  return new RegExp(`(?:${alts.join("|")})`, "giu");
}

export function splitStepWithAmounts(stepText: string, amounts: SopAmount[]): StepWithAmounts {
  const text = stepText ?? "";
  // One entry per name (first wins), blanks dropped, longest name first.
  const seen = new Set<string>();
  const candidates: SopAmount[] = [];
  for (const a of amounts ?? []) {
    const key = (a?.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...a, name: a.name.trim().replace(/\s+/g, " ") });
  }
  candidates.sort((a, b) => b.name.length - a.name.length);

  const claimed: Array<{ start: number; end: number; amount: SopAmount }> = [];
  const overlaps = (start: number, end: number) => claimed.some(c => start < c.end && end > c.start);

  for (const amount of candidates) {
    const re = patternFor(amount.name);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const start = m.index;
      const end = start + m[0].length;
      if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
      if (overlaps(start, end)) continue;
      claimed.push({ start, end, amount });
    }
  }
  claimed.sort((a, b) => a.start - b.start);

  const segments: StepSegment[] = [];
  const mentioned: SopAmount[] = [];
  let cursor = 0;
  for (const c of claimed) {
    if (c.start > cursor) segments.push({ kind: "text", text: text.slice(cursor, c.start) });
    segments.push({ kind: "amount", text: text.slice(c.start, c.end), amount: c.amount });
    if (!mentioned.includes(c.amount)) mentioned.push(c.amount);
    cursor = c.end;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return { segments, mentioned };
}
