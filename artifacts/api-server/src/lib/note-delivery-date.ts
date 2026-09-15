/**
 * Scan a wholesale order's free-text note for a requested delivery date.
 *
 * Customers write dates every way imaginable — "deliver Friday please",
 * "for the 12th", "12/9", "12th September", "next Tues" — and the person
 * processing the queue was reading them off the Shopify admin by hand
 * (Graeme, 2026-09-08). This turns the first date-shaped phrase in the note
 * into a concrete calendar day so the queue can PROPOSE it. It only ever
 * suggests: the note itself is shown alongside in the UI, and a human
 * confirms every date before anything is tagged.
 *
 * Anchoring matters: relative words ("Friday", "tomorrow") mean what they
 * meant WHEN THE NOTE WAS WRITTEN, so they resolve from the order's creation
 * date — not from whenever the queue happens to be processed. Absolute dates
 * without a year ("12/9", "12th September") take the next occurrence from
 * the anchor. A resolved date is only returned while it's still plausible:
 * strictly after `today` (you can't deliver in the past) and within
 * `maxDaysAhead` of it (a "12 High Street" that parses as the 12th of some
 * month shouldn't propose a date, and neither should ancient history).
 */

export interface NoteDateSuggestion {
  /** yyyy-mm-dd */
  date: string;
  /** The exact text in the note the date came from, shown in the UI so the
   *  human can see WHY this date was proposed. */
  matched: string;
}

// ── calendar helpers (UTC-noon string math, same idiom as wholesale-bags) ──
function parseDay(s: string): Date { return new Date(`${s}T12:00:00Z`); }
function fmtDay(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(s: string, n: number): string { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return fmtDay(d); }
function weekdayOf(s: string): number { return parseDay(s).getUTCDay(); } // 0 Sun … 6 Sat

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");

function monthNumber(name: string): number { return MONTHS[name.slice(0, 3)]; }

/** Real calendar day? (Rejects 31/02 etc. — Date would silently roll over.) */
function makeDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = parseDay(iso);
  return d.getUTCMonth() + 1 === month && d.getUTCDate() === day ? iso : null;
}

/** Yearless day+month: this year from the anchor, or next year if that's
 *  already behind the anchor. */
function nextOccurrenceOfDayMonth(anchor: string, month: number, day: number): string | null {
  const year = parseDay(anchor).getUTCFullYear();
  const thisYear = makeDate(year, month, day);
  if (thisYear && thisYear >= anchor) return thisYear;
  return makeDate(year + 1, month, day);
}

/** Next date strictly after the anchor falling on the given weekday. A note
 *  saying "Friday" written on a Friday means the NEXT one — same-day
 *  wholesale delivery isn't a thing. */
function nextWeekday(anchor: string, targetDow: number): string {
  const diff = (targetDow - weekdayOf(anchor) + 7) % 7 || 7;
  return addDays(anchor, diff);
}

/** Next date on or after the anchor with the given day-of-month. Tries this
 *  month and the two after it — enough to skip a month where the day doesn't
 *  exist ("the 31st" asked in February). */
function nextOccurrenceOfDayOfMonth(anchor: string, day: number): string | null {
  const a = parseDay(anchor);
  for (let i = 0; i < 3; i++) {
    const y = a.getUTCFullYear() + Math.floor((a.getUTCMonth() + i) / 12);
    const m = ((a.getUTCMonth() + i) % 12) + 1;
    const iso = makeDate(y, m, day);
    if (iso && iso >= anchor) return iso;
  }
  return null;
}

interface Candidate { index: number; date: string | null; matched: string }

/**
 * @param note    The order's free-text note.
 * @param anchor  yyyy-mm-dd the note was written (order creation day) —
 *                relative and yearless dates resolve from here.
 * @param today   yyyy-mm-dd of processing — a suggestion must be strictly
 *                after this and within `maxDaysAhead` of it.
 */
export function suggestDeliveryDateFromNote(
  note: string | null | undefined,
  anchor: string,
  today: string,
  maxDaysAhead = 60,
): NoteDateSuggestion | null {
  if (!note || !note.trim()) return null;
  const text = note.toLowerCase();
  const latest = addDays(today, maxDaysAhead);
  const candidates: Candidate[] = [];

  const push = (m: RegExpExecArray, date: string | null) =>
    candidates.push({ index: m.index, date, matched: m[0].trim() });

  // ISO yyyy-mm-dd — Shopify apps sometimes write these into notes.
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(m as RegExpExecArray, makeDate(Number(m[1]), Number(m[2]), Number(m[3])));
  }

  // UK numeric dates: 12/9, 12/09/26, 12.9.2026. Day first, always — this is
  // a UK kitchen. Invalid months (12/99 from a price like 12.99) fail
  // makeDate and are dropped.
  for (const m of text.matchAll(/(?<![\d/.])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?![\d/.])/g)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (m[3] != null) {
      const raw = Number(m[3]);
      const year = raw < 100 ? 2000 + raw : raw;
      push(m as RegExpExecArray, makeDate(year, month, day));
    } else {
      push(m as RegExpExecArray, month >= 1 && month <= 12 ? nextOccurrenceOfDayMonth(anchor, month, day) : null);
    }
  }

  // "12th September" / "12 sept" / "12th of September"
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_RE})\\b`, "g"))) {
    push(m as RegExpExecArray, nextOccurrenceOfDayMonth(anchor, monthNumber(m[2]), Number(m[1])));
  }

  // "September 12th" / "sept 12"
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g"))) {
    push(m as RegExpExecArray, nextOccurrenceOfDayMonth(anchor, monthNumber(m[1]), Number(m[2])));
  }

  // "tomorrow" — relative to when the note was written.
  for (const m of text.matchAll(/\btomorrow\b/g)) {
    push(m as RegExpExecArray, addDays(anchor, 1));
  }

  // Weekday names, with or without "next"/"this". Both mean the same here:
  // the next occurrence after the note was written — the note is shown to a
  // human either way, and "next Friday" arguments are theirs to settle.
  for (const m of text.matchAll(new RegExp(`\\b(?:next\\s+|this\\s+)?(${WEEKDAY_RE})\\b`, "g"))) {
    push(m as RegExpExecArray, nextWeekday(anchor, WEEKDAYS[m[1]]));
  }

  // Bare ordinal: "the 12th". The "the" and the suffix are both required —
  // "12 packs" and street numbers must not become dates.
  for (const m of text.matchAll(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/g)) {
    push(m as RegExpExecArray, nextOccurrenceOfDayOfMonth(anchor, Number(m[1])));
  }

  // Where two patterns caught overlapping text ("the 12th" inside
  // "the 12th September"), the longer match is the more specific reading —
  // drop the shorter so the matched text shown in the UI names the whole
  // phrase.
  const kept = candidates.filter(c => !candidates.some(other =>
    other !== c &&
    other.matched.length > c.matched.length &&
    other.index < c.index + c.matched.length &&
    c.index < other.index + other.matched.length,
  ));

  // First plausible mention in the note wins — people lead with the date
  // they care about.
  kept.sort((a, b) => a.index - b.index);
  for (const c of kept) {
    if (c.date && c.date > today && c.date <= latest) {
      return { date: c.date, matched: c.matched };
    }
  }
  return null;
}
