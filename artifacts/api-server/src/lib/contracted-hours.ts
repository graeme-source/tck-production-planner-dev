/**
 * Which contracted weekly hours to compare someone's worked hours against —
 * pure, no I/O (Objective I; F: say where every number comes from).
 *
 * Source order (Graeme, 2026-09-25):
 *   1. their latest contract issued in the app (employment_contracts.weekly_hours)
 *   2. their Planday contract rule ("41.25 Hours", "16.5 Hours per week")
 *   3. hours read off an old contract uploaded to their record — the
 *      founder's confirmed value if they've checked it, else what was read
 *   4. none — the page says "No contracted hours on file"
 *
 * A source whose text isn't a usable number (a range, "zero hours") is
 * skipped with a note, so the next source gets its turn. Hours only.
 */
import { parseWeeklyHours } from "./contract-extraction";

export type ContractHoursSource = "issued_contract" | "planday_rule" | "uploaded_contract";

export interface ContractHoursCandidates {
  /** Latest issued in-app contract, if any. */
  issued: { weeklyHours: string | null; issuedAt: string | null } | null;
  /** Planday: the rule's name when assigned; status says whether we could ask. */
  planday: { rule: string | null; status: "ok" | "unreachable" | "not_linked" | "not_configured" };
  /** Latest uploaded old contract with hours, if any. */
  uploaded: { confirmedHours: string | null; extractedHours: string | null; issueDate: string | null } | null;
}

export interface ContractedHours {
  hours: number | null;
  source: ContractHoursSource | null;
  /** The words the number came from — "41.25", "16.5 Hours per week". */
  sourceText: string | null;
  /** The date of the contract it came from, when known. */
  sourceDate: string | null;
  /** Why a source was passed over, or that Planday couldn't be asked. */
  notes: string[];
}

function usable(raw: string | null | undefined): number | null {
  const p = parseWeeklyHours(raw);
  return p.hours != null && p.hours > 0 && p.hours <= 80 ? Math.round(p.hours * 100) / 100 : null;
}

export function chooseContractedHours(c: ContractHoursCandidates): ContractedHours {
  const notes: string[] = [];

  if (c.issued?.weeklyHours?.trim()) {
    const h = usable(c.issued.weeklyHours);
    if (h != null) {
      return { hours: h, source: "issued_contract", sourceText: c.issued.weeklyHours.trim(), sourceDate: c.issued.issuedAt, notes };
    }
    notes.push(`Their issued contract says "${c.issued.weeklyHours.trim()}", which isn't a number of hours.`);
  }

  if (c.planday.status === "ok" && c.planday.rule) {
    const h = usable(c.planday.rule);
    if (h != null) return { hours: h, source: "planday_rule", sourceText: c.planday.rule, sourceDate: null, notes };
    notes.push(`Their Planday contract rule "${c.planday.rule}" doesn't give a number of hours.`);
  } else if (c.planday.status === "unreachable") {
    notes.push("Couldn't reach Planday to check for a contract rule.");
  }

  if (c.uploaded) {
    const text = c.uploaded.confirmedHours?.trim() || c.uploaded.extractedHours?.trim() || null;
    const h = usable(text);
    if (h != null) return { hours: h, source: "uploaded_contract", sourceText: text, sourceDate: c.uploaded.issueDate, notes };
    if (text) notes.push(`Their uploaded contract says "${text}", which isn't a number of hours.`);
  }

  return { hours: null, source: null, sourceText: null, sourceDate: null, notes };
}
