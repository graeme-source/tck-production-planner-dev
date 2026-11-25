/**
 * People list (/people) as a sortable table — the pure rules. Only what the
 * old cards already showed: name, job title, what needs attention, next
 * meeting, and whether they're working / off now / a leaver. Objective F.
 * Plus Last review (25 Nov 2026, Objective H): its sort value comes from
 * reviewDueSortValue in @workspace/people-reviews, passed in like the
 * review badges because it comes from a separate request.
 */
import { needsPolicyReview, type PolicyTriggerReview } from "@workspace/people-reviews";
import { sortRows, type SortState, type SortValue } from "./sortable-table";

/** The bits of a /api/people list row (lib/people-api PersonCard) the table uses. */
export interface PersonTableRow {
  name: string;
  jobTitle: string | null;
  isActive: boolean;
  awayNow: boolean;
  formsNeeded: number;
  triggerReview: PolicyTriggerReview;
  nextMeeting: { date: string } | null;
}

export type PeopleSortKey = "name" | "jobTitle" | "attention" | "nextMeeting" | "lastReview" | "status";

export const DEFAULT_PEOPLE_SORT: SortState<PeopleSortKey> = { key: "name", dir: "asc" };

/** Attention starts most-first; Last review most overdue first; everything
 *  else A→Z / soonest first. */
export const PEOPLE_FIRST_DIR: Record<PeopleSortKey, "asc" | "desc"> = {
  name: "asc", jobTitle: "asc", attention: "desc", nextMeeting: "asc", lastReview: "asc", status: "asc",
};

/**
 * How many things on this person need a manager: each return-to-work form
 * owed, each policy trigger still needing a review (due, or due again —
 * one already reviewed or booked doesn't nag), and an open review (passed in, as the review
 * badges come from a separate request). 0 = nothing.
 */
export function attentionCount(p: PersonTableRow, inReview: boolean): number {
  return p.formsNeeded + (needsPolicyReview(p.triggerReview.sickness) ? 1 : 0) + (needsPolicyReview(p.triggerReview.lates) ? 1 : 0) + (inReview ? 1 : 0);
}

export type PersonStatus = "working" | "off-now" | "leaver";
export const PERSON_STATUS_LABEL: Record<PersonStatus, string> = { working: "Working", "off-now": "Off now", leaver: "Leaver" };
const STATUS_ORDER: Record<PersonStatus, number> = { working: 0, "off-now": 1, leaver: 2 };

export function personStatus(p: PersonTableRow): PersonStatus {
  if (!p.isActive) return "leaver";
  return p.awayNow ? "off-now" : "working";
}

export function personSortValue(p: PersonTableRow, key: PeopleSortKey, inReview: boolean, lastReview: SortValue = null): SortValue {
  switch (key) {
    case "name": return p.name;
    case "jobTitle": return p.jobTitle;
    // Nothing to do = blank, so those people sit at the bottom either way.
    case "attention": return attentionCount(p, inReview) || null;
    case "nextMeeting": return p.nextMeeting?.date ?? null;
    // reviewDueSortValue: "0000-00-00" (no record) first, then oldest; blank
    // for No review required and rows the viewer has no review data for.
    case "lastReview": return lastReview;
    case "status": return STATUS_ORDER[personStatus(p)];
  }
}

/** Sorted rows; ties fall back to name A→Z. `inReview(row)` = has an open
 *  review badge; `lastReview(row)` = the Last review column's sort value. */
export function sortPeopleRows<T extends PersonTableRow>(
  rows: readonly T[],
  sort: SortState<PeopleSortKey>,
  inReview: (row: T) => boolean = () => false,
  lastReview: (row: T) => SortValue = () => null,
): T[] {
  return sortRows<T, PeopleSortKey>(rows, sort, (r, k) => personSortValue(r, k, inReview(r), k === "lastReview" ? lastReview(r) : null), r => r.name);
}
