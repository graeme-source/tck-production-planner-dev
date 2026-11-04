/**
 * AI Jane's check before an app report is filed (Graeme, 2026-11-04). The
 * pure half: what a report's progress means in the team's words, finding
 * reports like the one being written, and refusing an answer that isn't
 * backed by what she actually looked up. No database, unit-tested.
 */
import { validateTestPath, type TriageStatus } from "./issue-pipeline-rules";

/** A report's progress, as the team should hear it. */
export function plainReportStatus(t: { status: TriageStatus; issueResolvedAt?: Date | string | null } | null, resolved: boolean): string {
  if (!t) return resolved ? "Closed" : "In the queue, not looked at yet";
  switch (t.status) {
    case "proposed": return "In the queue, being looked at";
    case "approved": return "In the queue, a fix has been approved but not built yet";
    case "in_progress": return "Being fixed now";
    case "fixed": return t.issueResolvedAt ? "Fixed and live" : "Fixed, going live in the next update";
    case "answered": return "Answered";
    case "dismissed": return "Closed as already done";
    case "rejected":
    case "wont_fix": return "Looked at, no change planned";
    default: return "In the queue";
  }
}

/** Still worth following: someone can be told when it moves. */
export function isStillOpen(t: { status: TriageStatus; issueResolvedAt?: Date | string | null } | null, resolved: boolean): boolean {
  if (resolved) return false;
  if (!t) return true;
  return t.status === "proposed" || t.status === "approved" || t.status === "in_progress" || (t.status === "fixed" && !t.issueResolvedAt);
}

const STOP_WORDS = new Set(("a an and are as at be but by can cant could do does doesnt dont for from get got had has have how i if in into is it its just me my no not of on or our please should so that the their them then there they this to up us was we what when where which why will with would you your").split(" "));

export function reportWords(text: string): string[] {
  const words = text.toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter(w => w.length > 2 && !STOP_WORDS.has(w)))];
}

/** Reports sharing the most words with the query, best first. */
export function rankBySharedWords<T>(query: string, rows: T[], textOf: (row: T) => string, limit = 8): T[] {
  const wanted = reportWords(query);
  if (wanted.length === 0) return [];
  return rows
    .map(row => {
      const have = new Set(reportWords(textOf(row)));
      return { row, shared: wanted.filter(w => have.has(w)).length };
    })
    .filter(x => x.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit)
    .map(x => x.row);
}

export const CHECK_OUTCOMES = ["already_possible", "already_reported", "ask", "new"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

export interface CheckAnswer {
  outcome: CheckOutcome;
  message: string;
  path: string | null;
  issueId: number | null;
}

/**
 * Jane's answer, checked. "It's already reported" must name a report her
 * search returned, and "you can already do this" must point at a page her
 * search returned. Anything else is treated as a new report, so a wrong
 * guess can't stop someone reporting a real problem.
 */
export function checkedAnswer(raw: unknown, seen: { issueIds: ReadonlySet<number>; paths: ReadonlySet<string> }): CheckAnswer {
  const r = (raw ?? {}) as Record<string, unknown>;
  const message = typeof r.message === "string" ? r.message.trim().slice(0, 1200) : "";
  const outcome = CHECK_OUTCOMES.find(o => o === r.outcome);
  const fresh: CheckAnswer = { outcome: "new", message: "I can't find this anywhere, so I'll send it to the team.", path: null, issueId: null };
  if (!outcome || !message) return fresh;
  if (outcome === "ask" || outcome === "new") return { outcome, message, path: null, issueId: null };
  if (outcome === "already_reported") {
    const id = typeof r.issueId === "number" ? r.issueId : null;
    return id != null && seen.issueIds.has(id) ? { outcome, message, path: null, issueId: id } : fresh;
  }
  const path = typeof r.path === "string" ? validateTestPath(r.path) : null;
  return path && seen.paths.has(path) ? { outcome, message, path, issueId: null } : fresh;
}
