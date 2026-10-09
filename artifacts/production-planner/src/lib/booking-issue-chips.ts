/**
 * The status chips on a booking-issue card ("Email sent ✓", "Moved to
 * Tue 13 Oct ✓", "Escalated", "Booked ✓", "Done") — derived from the card's
 * stored state so every screen reads the same thing. Pure and tested.
 */

export type ChipTone = "done" | "info" | "warn";

export interface IssueChip { key: string; label: string; tone: ChipTone }

export interface ChipInput {
  done: boolean;
  scenario: string;
  resolvedAt: string | null;
  resolvedNote: string | null;
  dealtWithAt: string | null;
  dealtWithBy: string | null;
  state: {
    emailedAt: string | null;
    rescheduledTo: string | null;
    escalatedAt: string | null;
    escalatedBy: string | null;
    refundDone: boolean;
  };
}

/** "Tue 13 Oct" from YYYY-MM-DD; anything else passes through. */
export function shortDay(tagDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tagDate);
  if (!m) return tagDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

export function issueChips(i: ChipInput): IssueChip[] {
  const chips: IssueChip[] = [];
  if (i.resolvedAt) chips.push({ key: "booked", label: `Booked ✓${i.resolvedNote ? ` — ${i.resolvedNote.replace(/^Booked — /, "")}` : ""}`, tone: "done" });
  if (i.state.rescheduledTo) chips.push({ key: "moved", label: `Rescheduled to ${shortDay(i.state.rescheduledTo)} ✓`, tone: "done" });
  if (i.state.emailedAt) chips.push({ key: "email", label: "Email sent ✓", tone: "done" });
  if (i.state.escalatedAt) chips.push({ key: "escalated", label: `Escalated${i.state.escalatedBy ? ` by ${i.state.escalatedBy}` : ""}`, tone: "info" });
  if (i.scenario === "cant_deliver" && !i.resolvedAt) {
    chips.push(i.state.refundDone
      ? { key: "refund", label: "Refund done ✓", tone: "done" }
      : { key: "refund", label: "Refund needed", tone: "warn" });
  }
  if (i.dealtWithAt) chips.push({ key: "dealt", label: `Dealt with${i.dealtWithBy ? ` by ${i.dealtWithBy}` : ""} ✓`, tone: "done" });
  return chips;
}
