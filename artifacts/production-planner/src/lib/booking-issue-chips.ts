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

// ── Row view (Graeme, 27 Nov 2026): one full-width row per order ──────────

export interface WarningInput {
  done: boolean;
  scenario: string;
  resolvedAt: string | null;
  attempts: number;
  postcode: string | null;
  postcodeAdvice: { call?: unknown } | null;
  state: { refundDone: boolean; escalatedAt: string | null };
}

/** The unusual things worth seeing without opening the row. Open rows only:
 *  a finished order has nothing left to warn about. */
export function issueWarnings(i: WarningInput): IssueChip[] {
  if (i.done) return [];
  const w: IssueChip[] = [];
  if (i.scenario === "cant_deliver" && !i.resolvedAt && !i.state.refundDone) w.push({ key: "refund", label: "Refund needed", tone: "warn" });
  if (i.postcodeAdvice?.call) w.push({ key: "call", label: "Call APC", tone: "warn" });
  if (!i.postcode) w.push({ key: "postcode", label: "No postcode", tone: "warn" });
  if (i.attempts >= 3) w.push({ key: "attempts", label: `Failed ${i.attempts} times`, tone: "warn" });
  if (i.state.escalatedAt) w.push({ key: "escalated", label: "With a manager", tone: "info" });
  return w;
}

/**
 * Open orders first, then done — but a row never moves while the report is
 * open. Each id gets its place the first time it's seen (open: its position
 * among the open ones; done: after every open one), and keeps it; finishing
 * an order leaves it where it is until the report is opened again.
 * `ranks` is mutated (the caller keeps it for the life of the report).
 */
export function stableIssueOrder<T extends { id: number; done: boolean }>(issues: readonly T[], ranks: Map<number, number>): T[] {
  issues.forEach((i, idx) => {
    if (!ranks.has(i.id)) ranks.set(i.id, (i.done ? 1_000_000 : 0) + idx);
  });
  return [...issues].sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0));
}
