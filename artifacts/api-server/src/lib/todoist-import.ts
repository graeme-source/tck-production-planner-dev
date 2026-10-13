/**
 * Todoist "Export as template" CSV → team list items (Graeme, 2026-10-13).
 *
 * The template CSV has a header row (TYPE, CONTENT, DESCRIPTION, PRIORITY,
 * INDENT, AUTHOR, RESPONSIBLE, DATE, DATE_LANG, TIMEZONE, …). Rows of TYPE
 * "task" become items; a "note" row adds to the task above's notes;
 * "section" and "meta" rows are skipped. Todoist's CSV PRIORITY uses the API
 * numbering (4 = P1, 1 = P4), so it is flipped. DATE holds the natural-
 * language recurrence ("every tue", "every weekday", "every mon, thu at
 * 9am"); the common phrases are understood, anything else imports as every
 * day with a warning to fix it.
 */
import { addDays, weekdayOf, type RecurrenceRule, type Weekday } from "@workspace/recurrence";

export interface ImportedItem {
  title: string;
  notes: string | null;
  priority: 1 | 2 | 3 | 4;
  recurrence: RecurrenceRule;
  timeOfDay: string | null;
  /** Set when the DATE wasn't understood (imported as daily). */
  warning: string | null;
}

/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f !== "")) rows.push(row);
  return rows;
}

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
export function parseTodoistRecurrence(raw: string, today: string): { rule: RecurrenceRule; time: string | null } | null {
  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim()
    // "starting 1 nov", "from …", "until …" don't change the rhythm
    .replace(/\s*\b(?:starting|from|until|ending|for)\b.*$/, "")
    .replace(/^ev(?:ery)?!?\s+/, "every ")
    .trim();
  const { rest, time } = extractTime(lower);
  const s = rest;

  if (s === "daily" || s === "every day" || s === "every days") return { rule: { kind: "daily" }, time };
  if (/^every (?:weekday|workday|work day|week day)s?$/.test(s) || s === "weekdays") return { rule: { kind: "weekdays" }, time };

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

/** Find a column by its header name (case-insensitive). */
function col(header: string[], name: string): number {
  return header.findIndex(h => h.trim().toUpperCase() === name);
}

export function parseTodoistTemplate(csv: string, today: string): { items: ImportedItem[]; skipped: number; error: string | null } {
  const rows = parseCsv(csv);
  if (!rows.length) return { items: [], skipped: 0, error: "The file is empty." };
  const header = rows[0];
  const iType = col(header, "TYPE"), iContent = col(header, "CONTENT"), iDesc = col(header, "DESCRIPTION");
  const iPrio = col(header, "PRIORITY"), iDate = col(header, "DATE");
  if (iType < 0 || iContent < 0) {
    return { items: [], skipped: 0, error: "This doesn't look like a Todoist template export (no TYPE and CONTENT columns)." };
  }
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const type = (row[iType] ?? "").trim().toLowerCase();
    const content = (row[iContent] ?? "").trim();
    if (type === "note") {
      const last = items[items.length - 1];
      if (last && content) last.notes = last.notes ? `${last.notes}\n${content}` : content;
      continue;
    }
    if (type !== "task" || !content) { skipped++; continue; }
    const description = iDesc >= 0 ? (row[iDesc] ?? "").trim() : "";
    const csvPrio = Number((iPrio >= 0 ? row[iPrio] : "") || 1);
    const priority = (Number.isInteger(csvPrio) && csvPrio >= 1 && csvPrio <= 4 ? 5 - csvPrio : 4) as 1 | 2 | 3 | 4;
    const dateText = iDate >= 0 ? (row[iDate] ?? "").trim() : "";
    const parsed = dateText ? parseTodoistRecurrence(dateText, today) : null;
    items.push({
      title: content.slice(0, 300),
      notes: description || null,
      priority,
      recurrence: parsed?.rule ?? { kind: "daily" },
      timeOfDay: parsed?.time ?? null,
      warning: parsed ? null : dateText
        ? `Didn't understand "${dateText}" — imported as every day. Please set the days.`
        : "No date in Todoist — imported as every day. Please set the days.",
    });
  }
  return { items, skipped, error: null };
}
