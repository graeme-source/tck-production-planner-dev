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
import { parseRecurrencePhrase, type RecurrenceRule } from "@workspace/recurrence";

/** The phrase parser now lives in @workspace/recurrence (shared with the team-list Add box). */
export const parseTodoistRecurrence = parseRecurrencePhrase;

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
