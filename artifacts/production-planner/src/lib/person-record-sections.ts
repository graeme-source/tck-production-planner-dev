/**
 * The side panels on a person's record (Graeme, 2026-10-12): Hours worked,
 * Holiday & employment, Contracts, Documents, Emergency contact and What we
 * agreed open from big buttons beside the timeline instead of stacking above
 * it. Each button shows one plain line about what's inside — worked out
 * here from data the record already loads, so this file is pure and tested.
 */
import { fmtDay } from "./people-api";
import type { EmploymentResponse } from "./people-api";
import type { PersonHoursResponse } from "./hours-worked-view";
import type { ContractHistoryResponse } from "./contract-history";
import type { PersonDocumentsResponse } from "./person-documents";

export const RECORD_SECTIONS = ["hours", "holiday", "contracts", "documents", "emergency", "agreed", "record"] as const;
export type RecordSection = (typeof RECORD_SECTIONS)[number];

/** `?section=holiday` opens that panel when the record loads; `?entry=12`
 *  (a to-do's link back to a record entry) opens Reviews & records. */
export function sectionFromSearch(search: string): RecordSection | null {
  const params = new URLSearchParams(search);
  if (params.get("entry") && !params.get("section")) return "record";
  const raw = params.get("section");
  return raw && (RECORD_SECTIONS as readonly string[]).includes(raw) ? (raw as RecordSection) : null;
}

export type SummaryTone = "plain" | "warn" | "alert";
export interface SectionSummary { line: string; tone: SummaryTone }

const plain = (line: string): SectionSummary => ({ line, tone: "plain" });

/** 12.5, "Days" → "12.5 days"; hours read as "40h". */
export function fmtAmount(n: number | null, unit: string): string {
  if (n == null) return "—";
  const u = unit.toLowerCase() === "hours" ? "h" : ` ${unit.toLowerCase()}`;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}${u}`;
}

function oneDecimal(h: number): string {
  return (Math.round(h * 10) / 10).toFixed(1);
}

/** Hours worked — the panel's default range (last 3 months). */
export function hoursSummary(data: PersonHoursResponse | undefined, loading: boolean): SectionSummary {
  if (!data) return plain(loading ? "Adding up shifts…" : "Couldn't load hours");
  if (data.status === "not_linked") return plain("Not linked to Planday yet");
  if (data.status === "not_configured") return plain("Planday isn't connected");
  const r = data.report;
  if (data.status === "unreachable" || !r) return plain("Couldn't reach Planday — tap to try again");
  if (r.shifts === 0) return plain("No approved shifts in the last 3 months");
  const contracted = data.contract.hours;
  if (r.avgPaidPerWeek == null) {
    return plain(`${r.shifts} shift${r.shifts === 1 ? "" : "s"} in the last 3 months`);
  }
  const avg = `${oneDecimal(r.avgPaidPerWeek)} h a week`;
  if (contracted == null) return plain(`${avg} · no contracted hours on file`);
  return {
    line: `${avg} vs ${oneDecimal(contracted)} h contracted`,
    tone: r.standing === "under" ? "warn" : "plain",
  };
}

/** Holiday & employment (Planday). */
export function holidaySummary(data: EmploymentResponse | undefined, loading: boolean): SectionSummary {
  if (!data) return plain(loading ? "Asking Planday…" : "Couldn't reach Planday");
  if (data.status === "not_linked") return plain("Not linked to Planday yet");
  if (data.status === "not_configured") return plain("Planday isn't connected");
  if (data.status === "unreachable") return plain("Couldn't reach Planday — tap to try again");
  const h = data.holiday;
  const e = data.employment;
  const started = e.hiredFrom ? `Started ${fmtDay(e.hiredFrom, true)}` : null;
  const type = e.employeeType;
  const tail = [started, type].filter(Boolean).join(" · ");
  if (!h) return plain(["No holiday account", tail].filter(Boolean).join(" · "));
  const left = `${fmtAmount(h.balanceNow, h.unit)} holiday left`;
  const overdrawn = h.balanceAfterBooked != null && h.balanceAfterBooked < 0;
  return {
    line: [left, tail].filter(Boolean).join(" · "),
    tone: overdrawn ? "alert" : "plain",
  };
}

/** Contracts — the newest one's state, and how many are on file. */
export function contractsSummary(data: ContractHistoryResponse | undefined, loading: boolean, failed: boolean): SectionSummary {
  if (!data) return plain(loading ? "Loading contracts…" : failed ? "Couldn't load contracts" : "None on file yet");
  const total = data.issued.length + data.uploaded.length;
  if (total === 0) return plain("None on file yet");
  const newestIssued = [...data.issued].sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
  const more = total > 1 ? ` · ${total} on file` : "";
  if (newestIssued) {
    return newestIssued.acknowledgedAt
      ? plain(`Signed in the app${more}`)
      : { line: `Awaiting signature${more}`, tone: "warn" };
  }
  return plain(`${total} uploaded contract${total === 1 ? "" : "s"}`);
}

/** Documents filed on the record plus onboarding uploads. */
export function documentsSummary(data: PersonDocumentsResponse | undefined, loading: boolean, failed: boolean): SectionSummary {
  if (!data) return plain(loading ? "Loading documents…" : failed ? "Couldn't load documents" : "None on file yet");
  const n = data.documents.length + data.onboarding.length;
  const form = data.onboardingForm ? " · onboarding form" : "";
  if (n === 0) return plain(data.onboardingForm ? "Onboarding form only" : "None on file yet");
  return plain(`${n} on file${form}`);
}

/** What we agreed — open objectives from meetings. */
export function agreedSummary(count: number): SectionSummary {
  return count === 0 ? plain("Nothing open") : { line: `${count} thing${count === 1 ? "" : "s"} agreed`, tone: "warn" };
}

/** Reviews & records — the badge's wording when something is open, else a
 *  live warning, else how many entries. `badgeLabel` from reviewBadge. */
export function recordEntriesSummary(
  data: { count: number; badgeLabel: string | null; formal: boolean; liveWarningUntil: string | null } | undefined,
  loading: boolean,
  failed: boolean,
): SectionSummary {
  if (!data) return plain(loading ? "Loading the record…" : failed ? "Couldn't load the record" : "Nothing on the record yet");
  if (data.badgeLabel) return { line: data.badgeLabel, tone: data.formal ? "alert" : "warn" };
  if (data.liveWarningUntil) return { line: `Live warning until ${fmtDay(data.liveWarningUntil, true)}`, tone: "warn" };
  if (data.count === 0) return plain("Nothing on the record yet");
  return plain(`${data.count} entr${data.count === 1 ? "y" : "ies"}`);
}
