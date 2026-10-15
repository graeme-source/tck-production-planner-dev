/**
 * Recurrence phrases in plain English → a RecurrenceRule (moved here from
 * the Todoist importer, 2026-10-15, so the team-list "Add a task" box can use
 * it too). Understands "every day", "every weekday", "every mon, thu at 9am",
 * "every 2 weeks on fri", "fortnightly", "weekly", "every month on the 15th",
 * "monthly", and every N months: "every 6 months", "every 3 months on the
 * 1st", "every other month", "quarterly", "yearly"/"annually"/"every year".
 */
import { addDays, weekdayOf, type RecurrenceRule, type Weekday } from "./index";

const DAY_WORDS: Record<string, Weekday> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};

function parseDayList(s: string): Weekday[] | null {
  const tokens = s.split(/\s*(?:,|&|\band\b|\s)\s*/).map(t => t.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const days: Weekday[] = [];
  for (const t of tokens) {
    const d = DAY_WORDS[t.replace(/s$/, "")] ?? DAY_WORDS[t];
    if (d === undefined) return null;
    if (!days.includes(d)) days.push(d);
  }
  return days;
}

/** Pull a time ("at 9am", "at 14:30", "9:30pm") out of the phrase. */
function extractTime(s: string): { rest: string; time: string | null } {
  const patterns = [
    /\b(?:at|@)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/,
    /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/,
    /\b(\d{1,2})[:.](\d{2})\b/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) continue;
    return { rest: (s.slice(0, m.index) + s.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, " ").trim(), time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
  }
  return { rest: s, time: null };
}

const ORDINAL_DAY = /^(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/;

/**
 * Understand a Todoist recurrence phrase. `today` (London) anchors
 * fortnightly rules: the first occurrence from today is an "on" week.
 * Returns null when the phrase isn't one we know.
 */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** A start date in words (Graeme, 2026-10-15: "every 3 months starting from
 *  next Monday"): today, tomorrow, (next/this) monday, 19 oct, 19th october,
 *  19/10, 2026-10-19. Always today or later. null if not understood. */
export function parseStartDate(text: string, today: string): string | null {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim().replace(/^(?:on|from|the)\s+/, "").replace(/^(?:the)\s+/, "");
  if (t === "today") return today;
  if (t === "tomorrow") return addDays(today, 1);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t >= today ? t : null;
  const wd = t.match(/^(?:(next|this)\s+)?([a-z]+)$/);
  if (wd) {
    const days = parseDayList(wd[2]);
    if (days && days.length === 1) {
      const start = wd[1] === "next" ? 1 : 0;
      for (let i = start; i < start + 7; i++) {
        const d = addDays(today, i);
        if (weekdayOf(d) === days[0]) return d;
      }
    }
  }
  const dm = t.match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]+)(?:\s+(\d{4}))?$/) ?? t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (dm) {
    const day = Number(dm[1]);
    const month = /^\d+$/.test(dm[2]) ? Number(dm[2]) : MONTHS[dm[2]];
    if (!month || day < 1 || day > 31) return null;
    let year = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(today.slice(0, 4));
    const mk = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!dm[3] && mk(year) < today) year += 1;
    const out = mk(year);
    return isIsoDateLike(out) && out >= today ? out : null;
  }
  return null;
}

function isIsoDateLike(s: string): boolean {
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The rule moved so its first occurrence is `start`, then on as usual. */
export function ruleStartingOn(rule: RecurrenceRule, start: string): RecurrenceRule {
  switch (rule.kind) {
    case "monthly": {
      const day = Number(start.slice(8, 10));
      return (rule.interval ?? 1) > 1
        ? { ...rule, dayOfMonth: day, anchor: `${start.slice(0, 7)}-01`, from: start }
        : { ...rule, dayOfMonth: day, from: start };
    }
    case "weekly":
      return (rule.interval ?? 1) > 1 ? { ...rule, anchor: start, from: start } : { ...rule, from: start };
    case "once":
      return rule;
    default:
      return { ...rule, from: start };
  }
}

export function parseRecurrencePhrase(raw: string, today: string): { rule: RecurrenceRule; time: string | null } | null {
  // "… starting next monday" / "… from 1 nov" sets where it begins (2026-10-15).
  const startMatch = raw.toLowerCase().match(/\b(?:starting(?: from| on)?|from|beginning)\s+(.+)$/);
  if (startMatch) {
    const start = parseStartDate(startMatch[1], today);
    const before = raw.slice(0, startMatch.index).trim();
    const inner = start ? parseRecurrencePhraseBase(before, today) : null;
    if (start && inner) return { rule: ruleStartingOn(inner.rule, start), time: inner.time };
  }
  return parseRecurrencePhraseBase(raw, today);
}

function parseRecurrencePhraseBase(raw: string, today: string): { rule: RecurrenceRule; time: string | null } | null {
  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim()
    // "starting 1 nov", "from …", "until …" don't change the rhythm
    .replace(/\s*\b(?:starting|from|until|ending|for)\b.*$/, "")
    .replace(/^ev(?:ery)?!?\s+/, "every ")
    .trim();
  const { rest, time } = extractTime(lower);
  const s = rest;

  if (s === "daily" || s === "every day" || s === "every days") return { rule: { kind: "daily" }, time };
  if (/^every (?:weekday|workday|work day|week day)s?$/.test(s) || s === "weekdays") return { rule: { kind: "weekdays" }, time };

  // Every N months (2026-10-15): "every 6 months", "every 3 months on the 1st",
  // "every other month", "quarterly", "every quarter", "yearly", "annually",
  // "every year". The day defaults to today's date; it starts this month if
  // that day hasn't passed, otherwise next month.
  const todayDay = Number(today.slice(8, 10));
  let mi = s.match(/^every (other|second|\d+) months?(?: on)?(?:\s+(.*))?$/);
  let interval: number | null = mi ? (mi[1] === "other" || mi[1] === "second" ? 2 : Number(mi[1])) : null;
  let dayText: string | null = mi ? (mi[2] ?? null) : null;
  if (interval == null) {
    const q = s.match(/^(?:quarterly|every quarter)(?: on)?(?:\s+(.*))?$/);
    if (q) { interval = 3; dayText = q[1] ?? null; }
  }
  if (interval == null) {
    const y = s.match(/^(?:yearly|annually|every year)(?: on)?(?:\s+(.*))?$/);
    if (y) { interval = 12; dayText = y[1] ?? null; }
  }
  if (interval != null) {
    let day = todayDay;
    if (dayText) {
      const d = dayText.trim().match(ORDINAL_DAY);
      if (!d) return null;
      day = Number(d[1]);
    }
    if (interval < 1 || interval > 12 || day < 1 || day > 31) return null;
    if (interval === 1) return { rule: { kind: "monthly", dayOfMonth: day }, time };
    const [y0, m0] = today.split("-").map(Number);
    const startNext = todayDay > day;
    const ym = startNext ? (m0 === 12 ? [y0 + 1, 1] : [y0, m0 + 1]) : [y0, m0];
    const anchor = `${ym[0]}-${String(ym[1]).padStart(2, "0")}-01`;
    return { rule: { kind: "monthly", dayOfMonth: day, interval, anchor }, time };
  }
  // Bare rhythms: "weekly" / "every week" → today's weekday; "fortnightly" /
  // "every other week" → today's weekday every 2 weeks; "monthly" / "every
  // month" → today's date.
  if (s === "weekly" || s === "every week") return { rule: { kind: "weekly", days: [weekdayOf(today)] }, time };
  if (s === "fortnightly" || s === "every other week" || s === "every 2 weeks" || s === "biweekly") {
    return { rule: { kind: "weekly", days: [weekdayOf(today)], interval: 2, anchor: today }, time };
  }
  const fn = s.match(/^fortnightly(?: on)? (.+)$/);
  if (fn) {
    const days = parseDayList(fn[1]);
    if (days) return { rule: { kind: "weekly", days, interval: 2, anchor: firstOn(days, today) }, time };
  }
  if (s === "monthly" || s === "every month") return { rule: { kind: "monthly", dayOfMonth: todayDay }, time };

  // Monthly: "every month on the 15th", "monthly on 1st", "every 15th", "every month 15"
  let m = s.match(/^(?:every month|monthly)(?: on)?\s+(.*)$/);
  const monthlyDay = m ? m[1] : (s.match(/^every\s+(\d{1,2}(?:st|nd|rd|th)?)$/)?.[1] ?? null);
  if (monthlyDay != null) {
    const d = monthlyDay.trim().match(ORDINAL_DAY);
    if (d) {
      const n = Number(d[1]);
      if (n >= 1 && n <= 31) return { rule: { kind: "monthly", dayOfMonth: n }, time };
    }
    return null;
  }

  // Every N weeks / every other …: "every other fri", "every 2 weeks on fri"
  m = s.match(/^every (other|second|\d+) (?:weeks? (?:on )?)?(.+)$/);
  if (m) {
    const interval = m[1] === "other" || m[1] === "second" ? 2 : Number(m[1]);
    const days = parseDayList(m[2]);
    if (days && interval >= 1 && interval <= 52) {
      return { rule: { kind: "weekly", days, interval, anchor: firstOn(days, today) }, time };
    }
    return null;
  }

  // "every week on mon", "weekly on tue", "every mon, thu", "every monday and thursday"
  m = s.match(/^(?:every week|weekly)(?: on)? (.+)$/) ?? s.match(/^every (.+)$/);
  if (m) {
    const days = parseDayList(m[1]);
    if (days) return { rule: { kind: "weekly", days }, time };
  }
  return null;
}

function firstOn(days: Weekday[], today: string): string {
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    if (days.includes(weekdayOf(d))) return d;
  }
  return today;
}


export type QuickPriority = 1 | 2 | 3 | 4;

/**
 * The team-list "Add a task" box (Graeme, 2026-10-15: "I could type 'P1' and
 * it would recognise it as priority 1… 'every 6 months' and it would
 * automatically schedule it"). Pulls a priority ("p1"–"p4") and a repeat
 * phrase (anything parseRecurrencePhrase understands, from its first keyword
 * to the end, e.g. "Clean the extract fans every 6 months p2") out of the
 * title. What isn't understood stays in the title.
 */
export function parseQuickTask(text: string, today: string): {
  title: string; priority: QuickPriority | null; rule: RecurrenceRule | null; time: string | null;
} {
  let title = text;
  let priority: QuickPriority | null = null;
  const p = title.match(/(^|\s)!?p([1-4])(?=\s|$)/i);
  if (p) {
    priority = Number(p[2]) as QuickPriority;
    title = (title.slice(0, p.index) + " " + title.slice((p.index ?? 0) + p[0].length)).replace(/\s+/g, " ").trim();
  }
  let rule: RecurrenceRule | null = null;
  let time: string | null = null;
  const lower = title.toLowerCase();
  const keyword = /\b(every|daily|weekdays|weekly|fortnightly|biweekly|monthly|quarterly|yearly|annually)\b/g;
  let m: RegExpExecArray | null;
  const starts: number[] = [];
  while ((m = keyword.exec(lower))) starts.push(m.index);
  for (const i of starts) {
    const parsed = parseRecurrencePhrase(lower.slice(i), today);
    if (parsed) {
      rule = parsed.rule;
      time = parsed.time;
      title = title.slice(0, i).replace(/[\s,–-]+$/, "").trim();
      break;
    }
  }
  return { title, priority, rule, time };
}
