import { describe, it, expect } from "vitest";
import {
  classifyBookingIssue, scenarioWording, issueState, issueActions, isIssueDone, parseActions,
  runOutcome, planIssueWrites, todaysIssues, escalationMessage, RESCHEDULE_BLOCKED_CANT_DELIVER,
  type ActionInput, type IssueAction, type IssueState,
} from "./apc-booking-issues";

const lines = (nextDay: boolean, saturdayDelivery: boolean, extra: object = {}) => ({ matchedOn: "KA3", depot: "274", nextDay, saturdayDelivery, ...extra });

describe("classifyBookingIssue", () => {
  it("two crosses + APC refused = can't deliver to this postcode", () => {
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: true, postcode: lines(false, false) })).toBe("cant_deliver");
    // On any day — a weekday booking to the same place is the same verdict.
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: false, postcode: lines(false, false) })).toBe("cant_deliver");
  });

  it("Saturday refused, weekdays ✓ Saturday ✗ = Saturday permanently unavailable", () => {
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: true, postcode: lines(true, false) })).toBe("saturday_permanent");
  });

  it("an APC-confirmed permanent answer counts — it has already turned Saturday into a cross", () => {
    const p = lines(true, false, { restrictions: { saturday: { kind: "permanent", recordedOn: "2 Oct" }, weekday: null } });
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: true, postcode: p })).toBe("saturday_permanent");
  });

  it("Saturday refused although both lines are ✓ = refused today only", () => {
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: true, postcode: lines(true, true) })).toBe("saturday_temporary");
    const temp = lines(true, true, { restrictions: { saturday: { kind: "temporary" }, weekday: null } });
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: true, postcode: temp })).toBe("saturday_temporary");
  });

  it("anything that isn't a coverage refusal stays 'other', whatever the ticks say", () => {
    // An address problem to a remote postcode must not read as "refund it".
    expect(classifyBookingIssue({ refusedNoService: false, saturdayAttempt: true, postcode: lines(false, false) })).toBe("other");
    expect(classifyBookingIssue({ refusedNoService: false, saturdayAttempt: true, postcode: lines(true, false) })).toBe("other");
  });

  it("a postcode missing from APC's table is 'other' — never guessed", () => {
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: true, postcode: null })).toBe("other");
  });

  it("combinations the three scenarios don't cover are 'other'", () => {
    // Weekday booking refused where the table says weekdays are fine.
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: false, postcode: lines(true, true) })).toBe("other");
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: false, postcode: lines(true, false) })).toBe("other");
    // No next-day weekday but a Saturday service: unusual, a human looks.
    expect(classifyBookingIssue({ refusedNoService: true, saturdayAttempt: true, postcode: lines(false, true) })).toBe("other");
  });
});

describe("scenarioWording", () => {
  it("names the outward code and depot", () => {
    expect(scenarioWording("cant_deliver", lines(false, false)).explain).toContain("KA3 (depot 274)");
  });
  it("says when APC confirmed the no-Saturday answer", () => {
    const p = lines(true, false, { restrictions: { saturday: { kind: "permanent", recordedOn: "2 Oct" } } });
    expect(scenarioWording("saturday_permanent", p).explain).toContain("APC confirmed on 2 Oct");
    expect(scenarioWording("saturday_permanent", lines(true, false)).explain).toContain("postcode table lists no Saturday");
  });
  it("tells the operator to fix and retry a fixable failure", () => {
    expect(scenarioWording("other", null, { dataFixable: true }).whatToDo).toContain("then press Retry");
    expect(scenarioWording("other", null, { refusedNoService: true }).title).toBe("Postcode not in APC's table");
  });
});

const act = (kind: IssueAction["kind"], at = "2026-10-09T09:00:00Z", detail: string | null = null, byName = "Grant"): IssueAction =>
  ({ kind, at, byUserId: 1, byName, detail });

describe("issueState / parseActions", () => {
  it("folds the log, latest toggle wins", () => {
    const s = issueState([act("refund_done"), act("email_sent", "2026-10-09T09:05:00Z", "a@b.com"), act("refund_undone"), act("escalated")]);
    expect(s.refundDone).toBe(false);
    expect(s.emailedTo).toBe("a@b.com");
    expect(s.escalatedBy).toBe("Grant");
  });
  it("drops junk entries rather than failing", () => {
    expect(parseActions([{ kind: "nope", at: "x" }, null, act("rescheduled", undefined, "2026-10-13")])).toHaveLength(1);
    expect(parseActions("not an array")).toEqual([]);
  });
});

const base = (over: Partial<ActionInput> = {}): ActionInput => ({
  scenario: "other",
  state: issueState([]),
  resolved: false,
  dealtWith: false,
  canCourier: true,
  hasEmail: true,
  suggestedRetryCode: null,
  refusedNoService: true,
  saturdayAttempt: true,
  ...over,
});

describe("issueActions", () => {
  it("can't deliver: Reschedule is OFF with the reason; email, escalate and refund are offered", () => {
    const a = issueActions(base({ scenario: "cant_deliver", suggestedRetryCode: "ND16" }));
    expect(a.reschedule.show).toBe(true);
    expect(a.reschedule.enabled).toBe(false);
    expect(a.reschedule.reason).toBe(RESCHEDULE_BLOCKED_CANT_DELIVER);
    expect(a.emailCantDeliver.enabled).toBe(true);
    expect(a.escalate.enabled).toBe(true);
    expect(a.refund.enabled).toBe(true);
    // Retrying on another service won't reach a postcode with no service.
    expect(a.retryAs.show).toBe(false);
  });

  it("can't deliver: Reschedule stays off even for someone with every permission", () => {
    const a = issueActions(base({ scenario: "cant_deliver", canCourier: true }));
    expect(a.reschedule.enabled).toBe(false);
  });

  it("can't deliver: the email is offered once, and not without an address", () => {
    const sent = issueActions(base({ scenario: "cant_deliver", state: issueState([act("email_sent", undefined, "a@b.com")]) }));
    expect(sent.emailCantDeliver.enabled).toBe(false);
    expect(sent.emailCantDeliver.reason).toContain("a@b.com");
    const noAddress = issueActions(base({ scenario: "cant_deliver", hasEmail: false }));
    expect(noAddress.emailCantDeliver.enabled).toBe(false);
  });

  it("no Saturdays: reschedule is weekdays only with the permanent email; retry is off", () => {
    const a = issueActions(base({ scenario: "saturday_permanent", suggestedRetryCode: "ND16" }));
    expect(a.reschedule.enabled).toBe(true);
    expect(a.reschedule.weekdaysOnly).toBe(true);
    expect(a.reschedule.emailVariant).toBe("permanent_saturday");
    expect(a.retry.enabled).toBe(false);
    expect(a.retryAs.show).toBe(false);
    expect(a.emailCantDeliver.show).toBe(false);
    expect(a.refund.show).toBe(false);
  });

  it("Saturday refused today: reschedule (Saturdays allowed) with the temporary email, retry stays", () => {
    const a = issueActions(base({ scenario: "saturday_temporary", suggestedRetryCode: "ND16" }));
    expect(a.reschedule.weekdaysOnly).toBe(false);
    expect(a.reschedule.emailVariant).toBe("temporary_saturday");
    expect(a.reschedule.defaultSendEmail).toBe(true);
    expect(a.retry.enabled).toBe(true);
    expect(a.retryAs).toMatchObject({ show: true, enabled: true, code: "ND16" });
  });

  it("other: as before, but the Saturday-restriction email isn't pre-ticked for an address problem", () => {
    const a = issueActions(base({ scenario: "other", refusedNoService: false }));
    expect(a.reschedule.enabled).toBe(true);
    expect(a.reschedule.defaultSendEmail).toBe(false);
    expect(a.retry.enabled).toBe(true);
  });

  it("once rescheduled, nothing can book or move it again", () => {
    const a = issueActions(base({ scenario: "saturday_temporary", state: issueState([act("rescheduled", undefined, "2026-10-13")]) }));
    expect(a.retry.enabled).toBe(false);
    expect(a.reschedule.enabled).toBe(false);
    expect(a.reschedule.reason).toContain("2026-10-13");
  });

  it("booked after all: no buttons at all", () => {
    const a = issueActions(base({ scenario: "saturday_temporary", resolved: true }));
    expect([a.retry, a.retryAs, a.reschedule, a.emailCantDeliver, a.escalate, a.refund, a.dealtWith].every(x => !x.show)).toBe(true);
  });

  it("without the courier permission, only Escalate works", () => {
    const a = issueActions(base({ scenario: "cant_deliver", canCourier: false }));
    expect(a.escalate.enabled).toBe(true);
    expect(a.emailCantDeliver.enabled).toBe(false);
    expect(a.refund.enabled).toBe(false);
    expect(a.dealtWith.enabled).toBe(false);
    // The "any day" reason wins over the permission one — it's the real why.
    expect(a.reschedule.reason).toBe(RESCHEDULE_BLOCKED_CANT_DELIVER);
  });

  it("told and refunded: nothing can book, move or email it again", () => {
    const a = issueActions(base({ scenario: "cant_deliver", state: issueState([act("email_sent"), act("refund_done")]) }));
    expect(a.retry.enabled).toBe(false);
    expect(a.retry.reason).toContain("told and refunded");
    expect(a.reschedule.enabled).toBe(false);
  });

  it("marked dealt with: actions are off until reopened, and Reopen stays", () => {
    const a = issueActions(base({ scenario: "saturday_temporary", dealtWith: true, suggestedRetryCode: "ND16" }));
    expect(a.retry.enabled).toBe(false);
    expect(a.retryAs.enabled).toBe(false);
    expect(a.reschedule.enabled).toBe(false);
    expect(a.dealtWith.enabled).toBe(true);
  });

  it("escalating twice is blocked", () => {
    const a = issueActions(base({ state: issueState([act("escalated")]) }));
    expect(a.escalate.enabled).toBe(false);
    expect(a.escalate.reason).toContain("Grant");
  });
});

describe("isIssueDone", () => {
  const s = (acts: IssueAction[]): IssueState => issueState(acts);
  it("can't deliver needs the email AND the refund", () => {
    expect(isIssueDone("cant_deliver", s([act("email_sent")]), { resolved: false, dealtWith: false })).toBe(false);
    expect(isIssueDone("cant_deliver", s([act("email_sent"), act("refund_done")]), { resolved: false, dealtWith: false })).toBe(true);
  });
  it("a reschedule, a later booking or a manual tick finishes any card", () => {
    expect(isIssueDone("saturday_permanent", s([act("rescheduled", undefined, "2026-10-13")]), { resolved: false, dealtWith: false })).toBe(true);
    expect(isIssueDone("other", s([]), { resolved: true, dealtWith: false })).toBe(true);
    expect(isIssueDone("other", s([]), { resolved: false, dealtWith: true })).toBe(true);
    expect(isIssueDone("other", s([act("escalated")]), { resolved: false, dealtWith: false })).toBe(false);
  });
});

describe("runOutcome / planIssueWrites — merging re-runs", () => {
  it("failure records, booking resolves, other skips are ignored", () => {
    expect(runOutcome({ orderId: 1, status: "failed" })).toBe("fail");
    expect(runOutcome({ orderId: 1, status: "booked", waybill: "W1" })).toBe("resolve");
    expect(runOutcome({ orderId: 1, status: "skipped", reason: "Already has a consignment", waybill: "W1" })).toBe("resolve");
    expect(runOutcome({ orderId: 1, status: "skipped", reason: "Not tagged for dispatch — tag it first" })).toBe("ignore");
  });

  it("a second failure updates the same row — never a second card", () => {
    const w = planIssueWrites([{ id: 7, orderId: 100, resolved: false }], [{ orderId: 100, status: "failed" }, { orderId: 200, status: "failed" }]);
    expect(w).toEqual([{ op: "update_failure", id: 7, orderId: 100 }, { op: "insert", orderId: 200 }]);
  });

  it("an order that books later marks its card resolved; one with no card is left alone", () => {
    const w = planIssueWrites([{ id: 7, orderId: 100, resolved: false }], [
      { orderId: 100, status: "booked", waybill: "WB123" },
      { orderId: 300, status: "booked", waybill: "WB999" },
    ]);
    expect(w).toEqual([{ op: "resolve", id: 7, orderId: 100, note: "Booked — WB123" }]);
  });

  it("an already-resolved card isn't resolved twice, and reopens if it fails again", () => {
    expect(planIssueWrites([{ id: 7, orderId: 100, resolved: true }], [{ orderId: 100, status: "booked" }])).toEqual([]);
    expect(planIssueWrites([{ id: 7, orderId: 100, resolved: true }], [{ orderId: 100, status: "failed" }]))
      .toEqual([{ op: "update_failure", id: 7, orderId: 100 }]);
  });
});

describe("todaysIssues — clears daily, never reorders", () => {
  const rows = [
    { id: 3, reportDate: "2026-10-09", firstFailedAt: "2026-10-09T08:10:00Z", status: "done" },
    { id: 1, reportDate: "2026-10-08", firstFailedAt: "2026-10-08T08:00:00Z", status: "open" },
    { id: 2, reportDate: "2026-10-09", firstFailedAt: "2026-10-09T08:10:00Z", status: "open" },
    { id: 4, reportDate: "2026-10-09", firstFailedAt: "2026-10-09T07:55:00Z", status: "open" },
  ];
  it("shows only today's, oldest failure first, ties by id — status plays no part", () => {
    expect(todaysIssues(rows, "2026-10-09").map(r => r.id)).toEqual([4, 2, 3]);
  });
  it("yesterday's report is not shown", () => {
    expect(todaysIssues(rows, "2026-10-10")).toEqual([]);
  });
});

describe("escalationMessage", () => {
  it("names the order, customer, postcode, the scenario and APC's words", () => {
    const m = escalationMessage({
      orderName: "#1234", customerName: "Jane Smith", postcode: "KA3 1AB",
      wording: { title: "Can't deliver to this postcode", explain: "No service." }, reason: "NO Services available", note: "Customer called",
    });
    expect(m).toContain("#1234 (Jane Smith, KA3 1AB)");
    expect(m).toContain("Can't deliver to this postcode: No service.");
    expect(m).toContain("APC said: NO Services available");
    expect(m).toContain("Note: Customer called");
  });
});
