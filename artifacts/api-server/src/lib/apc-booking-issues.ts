/**
 * Today's APC booking issues — the rules (Graeme, 2026-10-09). Pure: no
 * database, no APC, no clock of its own, so every rule is unit-tested.
 * The database half is apc-booking-issues-db.ts; the screen is
 * production-planner components/apc-booking-issues/.
 *
 * WHAT THE TWO TICKS ARE. The postcode card on a failed booking shows two
 * lines, both from APC's POSTINFO postcode table (services/apc-postinfo.ts)
 * with anything APC customer service told us since applied on top
 * (services/apc-postcode-overrides.ts — a PERMANENT answer turns a tick into
 * a cross; a temporary one only adds an amber note):
 *
 *   line 1  next-day weekday delivery   ✓ / ✗
 *   line 2  Saturday delivery           ✓ / ✗
 *
 * Neither line is "what APC said today" — that is the booking failure
 * itself (APC's "NO Services available" message). The scenario comes from
 * putting the two together:
 *
 *   cant_deliver        APC refused, and the table shows NO next-day weekday
 *                       AND NO Saturday service (two crosses). We can't get
 *                       a chilled parcel there on any day.
 *   saturday_permanent  A Saturday booking refused, weekdays ✓, Saturday ✗
 *                       (the table says no Saturdays, or APC confirmed it
 *                       permanently). One tick.
 *   saturday_temporary  A Saturday booking refused although both lines are
 *                       ✓ — normally fine, refused today. Two ticks.
 *   other               Anything else: not a coverage refusal (address
 *                       errors, APC outages), a postcode not in the table,
 *                       or a combination the three above don't cover.
 *                       Handled as before.
 */

export type IssueScenario = "cant_deliver" | "saturday_permanent" | "saturday_temporary" | "other";

/** The two lines of the postcode card — table answer with permanent APC
 *  answers already applied (PostcodeServiceView.nextDay/saturdayDelivery). */
export interface PostcodeLines {
  matchedOn?: string;
  depot?: string;
  nextDay: boolean;
  saturdayDelivery: boolean;
  restrictions?: {
    saturday?: { kind: string; recordedOn?: string } | null;
    weekday?: { kind: string; recordedOn?: string } | null;
  } | null;
}

export interface ClassifyInput {
  /** APC's own verdict on this booking was a coverage refusal
   *  ("NO Services available") — lib/apc-failure-tags isNoServiceFailure. */
  refusedNoService: boolean;
  /** The booking was for a Saturday delivery (a Friday-dispatch code). */
  saturdayAttempt: boolean;
  /** null when the postcode isn't in APC's table at all. */
  postcode: PostcodeLines | null;
}

export function classifyBookingIssue(i: ClassifyInput): IssueScenario {
  if (!i.refusedNoService) return "other";
  const p = i.postcode;
  if (!p) return "other";
  if (!p.nextDay && !p.saturdayDelivery) return "cant_deliver";
  if (i.saturdayAttempt && p.nextDay) {
    return p.saturdayDelivery ? "saturday_temporary" : "saturday_permanent";
  }
  return "other";
}

/** The scenario in plain words, for the card. */
export function scenarioWording(s: IssueScenario, p: PostcodeLines | null, opts: { dataFixable?: boolean; refusedNoService?: boolean } = {}): { title: string; explain: string; whatToDo: string } {
  const where = p?.matchedOn ? `${p.matchedOn}${p.depot ? ` (depot ${p.depot})` : ""}` : "this postcode";
  switch (s) {
    case "cant_deliver":
      return {
        title: "Can't deliver to this postcode",
        explain: `APC's postcode table shows no next-day weekday service and no Saturday service for ${where}, and APC refused the booking. We can't get this order there fresh on any day.`,
        whatToDo: "Don't reschedule. Escalate to a manager to investigate, email the customer, and refund the order in Shopify.",
      };
    case "saturday_permanent": {
      const confirmed = p?.restrictions?.saturday?.kind === "permanent"
        ? `APC confirmed${p.restrictions.saturday.recordedOn ? ` on ${p.restrictions.saturday.recordedOn}` : ""} there is no Saturday delivery to ${where}`
        : `APC's postcode table lists no Saturday delivery for ${where}`;
      return {
        title: "No Saturday delivery here — ever",
        explain: `${confirmed}. Weekdays are fine.`,
        whatToDo: "Reschedule to a weekday. The customer gets the \"we can't deliver on Saturdays\" email.",
      };
    }
    case "saturday_temporary":
      return {
        title: "Saturday refused today",
        explain: `APC normally deliver to ${where} on Saturdays, but refused this one today.`,
        whatToDo: "Reschedule — the customer gets the temporary-restriction email. Or call APC, and Retry if they lift it.",
      };
    default:
      if (opts.refusedNoService && !p) {
        return {
          title: "Postcode not in APC's table",
          explain: "APC refused the booking, and this postcode isn't in APC's postcode table.",
          whatToDo: "Check the postcode is right in Shopify. If it is, ask APC before promising a date.",
        };
      }
      return {
        title: opts.refusedNoService ? "APC refused this booking" : "Booking problem",
        explain: "APC's message is shown below exactly as it came.",
        whatToDo: opts.dataFixable
          ? "Correct this on the order in Shopify, then press Retry."
          : "Read APC's message. Retry, reschedule, or escalate to a manager.",
      };
  }
}

// ── What people did on a card ───────────────────────────────────────────────

export type IssueActionKind =
  | "email_sent" | "rescheduled" | "escalated" | "refund_done" | "refund_undone"
  | "dealt_with" | "dealt_with_undone";

export interface IssueAction {
  kind: IssueActionKind;
  /** ISO timestamp. */
  at: string;
  byUserId: number | null;
  byName: string | null;
  /** e.g. the email address, the new date, the email template. */
  detail?: string | null;
}

export interface IssueState {
  emailedAt: string | null;
  emailedTo: string | null;
  rescheduledTo: string | null;
  escalatedAt: string | null;
  escalatedBy: string | null;
  refundDone: boolean;
  refundDoneBy: string | null;
}

/** Fold the action log into the card's state. The log is append-only, so
 *  an undo is a later entry, and the latest entry for a toggle wins. */
export function issueState(actions: readonly IssueAction[]): IssueState {
  const s: IssueState = { emailedAt: null, emailedTo: null, rescheduledTo: null, escalatedAt: null, escalatedBy: null, refundDone: false, refundDoneBy: null };
  for (const a of actions) {
    switch (a.kind) {
      case "email_sent": s.emailedAt = a.at; s.emailedTo = a.detail ?? null; break;
      case "rescheduled": s.rescheduledTo = a.detail ?? "another day"; break;
      case "escalated": s.escalatedAt = a.at; s.escalatedBy = a.byName; break;
      case "refund_done": s.refundDone = true; s.refundDoneBy = a.byName; break;
      case "refund_undone": s.refundDone = false; s.refundDoneBy = null; break;
      default: break;
    }
  }
  return s;
}

/** Parse a stored actions column defensively — a bad entry is dropped,
 *  never allowed to take the report down. */
export function parseActions(raw: unknown): IssueAction[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set<IssueActionKind>(["email_sent", "rescheduled", "escalated", "refund_done", "refund_undone", "dealt_with", "dealt_with_undone"]);
  return raw.filter((a): a is IssueAction =>
    !!a && typeof a === "object" && kinds.has((a as IssueAction).kind) && typeof (a as IssueAction).at === "string");
}

/** A card is finished when the order booked after all, someone marked it
 *  dealt with, it was moved off the day, or — for a postcode we can't
 *  reach — the customer has been told AND the refund is done. */
export function isIssueDone(scenario: IssueScenario, state: IssueState, flags: { resolved: boolean; dealtWith: boolean }): boolean {
  if (flags.resolved || flags.dealtWith) return true;
  if (state.rescheduledTo) return true;
  if (scenario === "cant_deliver") return !!state.emailedAt && state.refundDone;
  return false;
}

// ── Which buttons a card offers ─────────────────────────────────────────────

export interface Availability {
  show: boolean;
  enabled: boolean;
  /** Why it's off — shown beside the greyed button. */
  reason?: string;
}

export type RescheduleEmailVariant = "temporary_saturday" | "permanent_saturday";

export interface IssueActions {
  retry: Availability;
  retryAs: Availability & { code?: string };
  reschedule: Availability & { weekdaysOnly: boolean; emailVariant: RescheduleEmailVariant; defaultSendEmail: boolean };
  emailCantDeliver: Availability;
  escalate: Availability;
  refund: Availability;
  dealtWith: Availability;
}

export interface ActionInput {
  scenario: IssueScenario;
  state: IssueState;
  resolved: boolean;
  dealtWith: boolean;
  /** Courier actions permission ("Book APC labels" — manager or grant). */
  canCourier: boolean;
  hasEmail: boolean;
  suggestedRetryCode: string | null;
  refusedNoService: boolean;
  saturdayAttempt: boolean;
}

const HIDDEN: Availability = { show: false, enabled: false };
const NEEDS_PERMISSION = "Needs the \"Book APC labels\" permission — ask a manager.";

function gate(a: Availability, canCourier: boolean): Availability {
  if (!a.show || !a.enabled || canCourier) return a;
  return { ...a, enabled: false, reason: NEEDS_PERMISSION };
}

function time(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(iso));
}

export const RESCHEDULE_BLOCKED_CANT_DELIVER = "APC can't deliver here on any day — rescheduling would give the customer a wrong date. Escalate to a manager instead.";

export function issueActions(i: ActionInput): IssueActions {
  const { scenario, state } = i;
  const off = (reason: string): Availability => ({ show: true, enabled: false, reason });
  const on: Availability = { show: true, enabled: true };

  const rescheduleBase = {
    weekdaysOnly: scenario === "saturday_permanent",
    emailVariant: (scenario === "saturday_permanent" ? "permanent_saturday" : "temporary_saturday") as RescheduleEmailVariant,
    // The standard reschedule email talks about a Saturday restriction —
    // ticked by default only when that's what happened.
    defaultSendEmail: scenario === "saturday_permanent" || scenario === "saturday_temporary"
      || (i.refusedNoService && i.saturdayAttempt),
  };

  // Booked after all — nothing left to do on this card.
  if (i.resolved) {
    return {
      retry: HIDDEN, retryAs: HIDDEN, reschedule: { ...HIDDEN, ...rescheduleBase },
      emailCantDeliver: HIDDEN, escalate: HIDDEN, refund: HIDDEN, dealtWith: HIDDEN,
    };
  }

  const moved = state.rescheduledTo ? `Moved to ${state.rescheduledTo} — nothing to book today.` : null;

  let retry: Availability = on;
  let retryAs: Availability & { code?: string } = i.suggestedRetryCode ? { ...on, code: i.suggestedRetryCode } : HIDDEN;
  let reschedule: Availability = on;
  let emailCantDeliver: Availability = HIDDEN;
  let refund: Availability = HIDDEN;

  if (scenario === "cant_deliver") {
    retryAs = HIDDEN;
    reschedule = off(RESCHEDULE_BLOCKED_CANT_DELIVER);
    emailCantDeliver = state.emailedAt
      ? off(`Sent at ${time(state.emailedAt)}${state.emailedTo ? ` to ${state.emailedTo}` : ""}.`)
      : i.hasEmail ? on : off("No email address on this order — phone the customer instead.");
    refund = on;
  } else if (scenario === "saturday_permanent") {
    retry = off("APC never deliver here on a Saturday — booking again will fail. Reschedule to a weekday.");
    retryAs = HIDDEN;
  }

  if (moved) {
    retry = retry.show ? off(moved) : retry;
    retryAs = retryAs.show ? { ...off(moved) } : retryAs;
    if (reschedule.enabled) reschedule = off(`Already moved to ${state.rescheduledTo}.`);
  }

  const escalate: Availability = state.escalatedAt
    ? off(`Escalated at ${time(state.escalatedAt)}${state.escalatedBy ? ` by ${state.escalatedBy}` : ""}.`)
    : on;

  return {
    retry: gate(retry, i.canCourier),
    retryAs: { ...gate(retryAs, i.canCourier), ...(retryAs.show && i.suggestedRetryCode ? { code: i.suggestedRetryCode } : {}) },
    reschedule: { ...gate(reschedule, i.canCourier), ...rescheduleBase },
    emailCantDeliver: gate(emailCantDeliver, i.canCourier),
    // Anyone on packing can raise a flag — it only sends a team message.
    escalate,
    refund: gate(refund, i.canCourier),
    dealtWith: gate(on, i.canCourier),
  };
}

// ── Folding a booking run into the stored report ────────────────────────────

/** One outcome from POST /batch-book, as much as this needs. */
export interface RunResult {
  orderId: number;
  status: "booked" | "skipped" | "failed";
  reason?: string;
  waybill?: string;
}

export type RunOutcome = "fail" | "resolve" | "ignore";

/** A failure is recorded; a booking — or finding the order already holds a
 *  consignment — resolves any open card for it; anything else (not tagged,
 *  local delivery) leaves the report alone. */
export function runOutcome(r: RunResult): RunOutcome {
  if (r.status === "failed") return "fail";
  if (r.status === "booked") return "resolve";
  if (r.status === "skipped" && r.waybill) return "resolve";
  return "ignore";
}

export interface StoredIssueKey {
  id: number;
  orderId: number;
  resolved: boolean;
}

export type IssueWrite =
  | { op: "insert"; orderId: number }
  | { op: "update_failure"; id: number; orderId: number }
  | { op: "resolve"; id: number; orderId: number; note: string };

/** What a run means for today's stored rows. A repeat failure updates the
 *  same row (never a second card for one order); a success resolves it. */
export function planIssueWrites(existing: readonly StoredIssueKey[], results: readonly RunResult[]): IssueWrite[] {
  const byOrder = new Map(existing.map(e => [e.orderId, e]));
  const writes: IssueWrite[] = [];
  for (const r of results) {
    const outcome = runOutcome(r);
    const row = byOrder.get(r.orderId);
    if (outcome === "fail") {
      writes.push(row ? { op: "update_failure", id: row.id, orderId: r.orderId } : { op: "insert", orderId: r.orderId });
    } else if (outcome === "resolve" && row && !row.resolved) {
      writes.push({
        op: "resolve", id: row.id, orderId: r.orderId,
        note: r.status === "booked" ? `Booked${r.waybill ? ` — ${r.waybill}` : ""}` : `Already holds a consignment${r.waybill ? ` — ${r.waybill}` : ""}`,
      });
    }
  }
  return writes;
}

/** The team message a manager receives when a card is escalated. */
export function escalationMessage(i: {
  orderName: string; customerName: string | null; postcode: string | null;
  wording: { title: string; explain: string }; reason: string | null; note?: string | null;
}): string {
  const who = [i.customerName, i.postcode].filter(Boolean).join(", ");
  const lines = [
    `APC booking issue to investigate — ${i.orderName}${who ? ` (${who})` : ""}.`,
    `${i.wording.title}: ${i.wording.explain}`,
  ];
  if (i.reason) lines.push(`APC said: ${i.reason}`);
  if (i.note?.trim()) lines.push(`Note: ${i.note.trim()}`);
  lines.push("Open it from Order Packing → Booking issues today.");
  return lines.join("\n");
}

/** Today's cards only, in a fixed order: when they first failed, then id.
 *  Never by status — a card must not move under the operator's finger. */
export function todaysIssues<T extends { reportDate: string; firstFailedAt: string; id: number }>(rows: readonly T[], today: string): T[] {
  return rows
    .filter(r => r.reportDate === today)
    .sort((a, b) => a.firstFailedAt.localeCompare(b.firstFailedAt) || a.id - b.id);
}
