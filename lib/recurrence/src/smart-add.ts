/**
 * The smart "add" box shared by team lists, personal to-dos and station
 * checklists (Graeme, 2026-10-24: "all checklists use exactly the same
 * logic"). The rules here read the parts that have a fixed form — "p1",
 * "@Jane Miles", "every thursday at 9am", "next monday", "by friday" — so
 * the box can show what it understood while you type, and so adding still
 * works when the AI is unavailable. The server's AI step then picks WHERE
 * the task goes; these rules always win on the parts they understood.
 */
import { addDays, weekdayOf, type RecurrenceRule } from "./index";
import { parseQuickTask, parseRecurrencePhrase, parseStartDate, type QuickPriority } from "./phrase";

export interface SmartAddPerson { id: number; name: string }

export interface SmartAddParse {
  title: string;
  priority: QuickPriority | null;
  rule: RecurrenceRule | null;
  time: string | null;
  /** A one-off day, London date. */
  date: string | null;
  /** "by friday" is a deadline; "on friday" / "friday" is the day to do it. */
  dateKind: "on" | "by" | null;
  /** People named with @, matched to the list given. */
  mentions: SmartAddPerson[];
  /** "@word" that matched nobody, so the box can say so. */
  unknownMentions: string[];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Pull every "@Name" out of the text. The longest full name wins, so
 * "@Jane Miles" beats a "Jane" who is someone else; a first name alone works
 * when only one person has it.
 */
export function extractMentions(text: string, people: SmartAddPerson[]): { rest: string; mentions: SmartAddPerson[]; unknown: string[] } {
  const mentions: SmartAddPerson[] = [];
  const unknown: string[] = [];
  const sorted = [...people].filter(p => p.name.trim()).sort((a, b) => b.name.length - a.name.length);
  let rest = text;
  for (let guard = 0; guard < 10; guard++) {
    const at = rest.search(/(^|\s)@\S/);
    if (at < 0) break;
    const start = rest.indexOf("@", at);
    const after = rest.slice(start + 1);
    const lowerAfter = after.toLowerCase();
    let hit: SmartAddPerson | null = null;
    let len = 0;
    for (const p of sorted) {
      const n = norm(p.name);
      if (lowerAfter.startsWith(n) && !/[a-z]/i.test(after.charAt(n.length))) { hit = p; len = n.length; break; }
    }
    if (!hit) {
      const word = (after.match(/^[\p{L}'-]+/u) ?? [""])[0];
      const firsts = sorted.filter(p => norm(p.name).split(" ")[0] === word.toLowerCase());
      if (word && firsts.length === 1) { hit = firsts[0]; len = word.length; }
      else { unknown.push(word || after.split(/\s/)[0]); len = (word || after.split(/\s/)[0]).length; }
    }
    if (hit && !mentions.some(m => m.id === hit!.id)) mentions.push(hit);
    rest = (rest.slice(0, start) + " " + rest.slice(start + 1 + len)).replace(/\s+/g, " ").trim();
  }
  return { rest, mentions, unknown };
}

const WEEKDAY = "(?:mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)";
const MONTH = "(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)";
const DATE_WORDS = [
  "today", "tonight", "tomorrow", "next week", "in \\d{1,2} days?", `(?:next|this) ${WEEKDAY}`,
  `\\d{1,2}(?:st|nd|rd|th)?(?: of)? ${MONTH}(?: \\d{4})?`, `${MONTH} \\d{1,2}(?:st|nd|rd|th)?`,
  "\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?",
].join("|");
// A preposition makes any date phrase safe to take ("on friday"); without one
// only the unambiguous forms are taken, and a bare weekday only at the end —
// "Monday deep clean" is a title, "deep clean monday" is a day.
const WITH_PREP = new RegExp(`(?:^|\\s)(on|by|due|for|before)\\s+(${DATE_WORDS}|${WEEKDAY})(?=$|[\\s,.!])`, "i");
const BARE = new RegExp(`(?:^|\\s)()(${DATE_WORDS})(?=$|[\\s,.!])`, "i");
const BARE_WEEKDAY_END = new RegExp(`(?:^|\\s)()(${WEEKDAY})\\s*$`, "i");

function dateFromWords(words: string, today: string): string | null {
  const w = norm(words);
  if (w === "tonight") return today;
  if (w === "next week") {
    for (let i = 1; i <= 7; i++) { const d = addDays(today, i); if (weekdayOf(d) === 1) return d; }
  }
  const inDays = w.match(/^in (\d{1,2}) days?$/);
  if (inDays) return addDays(today, Number(inDays[1]));
  const md = w.match(new RegExp(`^(${MONTH}) (\\d{1,2})(?:st|nd|rd|th)?$`));
  if (md) return parseStartDate(`${md[2]} ${md[1]}`, today);
  return parseStartDate(w, today);
}

const REPEAT_WORD = /\b(every|daily|weekdays|weekly|fortnightly|biweekly|monthly|quarterly|yearly|annually)\b/gi;

/**
 * "clean packing computer every thursday cleaning check": the repeat isn't
 * at the end, so try the longest run of words after "every" that reads as
 * a repeat, and keep the words either side as the title.
 */
function repeatWithWordsAfter(text: string, today: string): { rule: RecurrenceRule; time: string | null; title: string } | null {
  let m: RegExpExecArray | null;
  REPEAT_WORD.lastIndex = 0;
  while ((m = REPEAT_WORD.exec(text))) {
    const before = text.slice(0, m.index);
    const words = text.slice(m.index).split(/\s+/);
    for (let n = Math.min(words.length - 1, 8); n >= 1; n--) {
      const r = parseRecurrencePhrase(words.slice(0, n).join(" ").toLowerCase(), today);
      if (!r) continue;
      const title = `${before} ${words.slice(n).join(" ")}`.replace(/\s+/g, " ").replace(/^[\s,–-]+|[\s,–-]+$/g, "").trim();
      return { rule: r.rule, time: r.time, title };
    }
  }
  return null;
}

export function extractDate(text: string, today: string): { rest: string; date: string | null; kind: "on" | "by" | null } {
  for (const re of [WITH_PREP, BARE, BARE_WEEKDAY_END]) {
    const m = text.match(re);
    if (!m) continue;
    const date = dateFromWords(m[2], today);
    if (!date) continue;
    const prep = (m[1] || "").toLowerCase();
    const kind = prep === "by" || prep === "due" || prep === "before" ? "by" : "on";
    const rest = (text.slice(0, m.index) + " " + text.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, " ").replace(/[\s,–-]+$/, "").trim();
    return { rest, date, kind };
  }
  return { rest: text, date: null, kind: null };
}

/** Everything the rules can read from one line typed (or said) into the box. */
export function parseSmartAdd(text: string, today: string, people: SmartAddPerson[] = []): SmartAddParse {
  const { rest: noMentions, mentions, unknown } = extractMentions(text, people);
  // Priority and repeat first: "every thursday" must not be read as a date.
  const quick = { ...parseQuickTask(noMentions, today) };
  if (!quick.rule) {
    const r = repeatWithWordsAfter(quick.title, today);
    if (r) { quick.rule = r.rule; quick.time = r.time; quick.title = r.title; }
  }
  let title = quick.title;
  let date: string | null = null;
  let dateKind: "on" | "by" | null = null;
  if (!quick.rule) {
    const d = extractDate(title, today);
    title = d.rest; date = d.date; dateKind = d.kind;
  }
  return {
    title: title.replace(/^[\s,–-]+|[\s,–-]+$/g, "").trim(),
    priority: quick.priority, rule: quick.rule, time: quick.time,
    date, dateKind, mentions, unknownMentions: unknown,
  };
}
