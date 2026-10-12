import { describe, it, expect } from "vitest";
import {
  periodEnd, extensionMessage, extendedEnd, attentionQueue, queueForViewer, attentionLine, hrAttentionTodo,
  planAttentionTodo, HR_ATTENTION_TODO_TITLE, DEFAULT_ATTENTION_SETTINGS, type QueueFacts,
} from "./index";

describe("review periods", () => {
  it("a 1/2/3/6-month period ends the day before the same date", () => {
    expect(periodEnd("2026-10-12", 1)).toBe("2026-11-11");
    expect(periodEnd("2026-10-12", 3)).toBe("2027-01-11");
    expect(periodEnd("2026-08-31", 6)).toBe("2027-02-27");
  });
  it("extending runs on from the current end, or from today if it's passed", () => {
    expect(extendedEnd("2026-11-11", "2026-10-20", { months: 1 })).toEqual({ ok: true, end: "2026-12-11" });
    expect(extendedEnd("2026-10-01", "2026-10-20", { months: 1 })).toEqual({ ok: true, end: "2026-11-19" });
    expect(extendedEnd("2026-11-11", "2026-10-20", { endDate: "2027-01-12" })).toEqual({ ok: true, end: "2027-01-12" });
    expect(extendedEnd("2026-11-11", "2026-10-20", { endDate: "2026-11-01" }).ok).toBe(false);
    expect(extendedEnd(null, "2026-10-20", { months: 0 }).ok).toBe(false);
    expect(extensionMessage(1, "2027-01-12")).toBe("Extended by 1 month to 12 Jan 2027");
    expect(extensionMessage(null, "2027-01-12")).toBe("Extended to 12 Jan 2027");
  });
});

const facts = (over: Partial<QueueFacts> = {}): QueueFacts => ({
  todayIso: "2026-10-12", settings: DEFAULT_ATTENTION_SETTINGS,
  probations: [], openEntries: [], warnings: [], meetings: [], ...over,
});

describe("the queue", () => {
  it("probation ending within 14 days (or ended) with no outcome", () => {
    const q = attentionQueue(facts({ probations: [
      { userId: 1, endDate: "2026-10-26", outcome: null },
      { userId: 2, endDate: "2026-10-27", outcome: null },
      { userId: 3, endDate: "2026-09-01", outcome: null },
      { userId: 4, endDate: "2026-10-13", outcome: "passed" },
    ] }));
    expect(q.map(i => [i.userId, i.overdue])).toEqual([[3, true], [1, false]]);
  });
  it("review period ending within 7 days and still open", () => {
    const q = attentionQueue(facts({ openEntries: [
      { id: 10, userId: 1, reviewEnd: "2026-10-19" }, { id: 11, userId: 1, reviewEnd: "2026-10-20" }, { id: 12, userId: 2, reviewEnd: null },
    ] }));
    expect(q.map(i => i.entryId)).toEqual([10]);
    expect(attentionLine(q[0])).toBe("Review period ends 19 Oct 2026");
  });
  it("warnings expiring soon are FYI, and drop off a week after", () => {
    const q = attentionQueue(facts({ warnings: [
      { entryId: 1, userId: 1, expiresOn: "2026-10-20" }, { entryId: 2, userId: 1, expiresOn: "2026-10-01" }, { entryId: 3, userId: 1, expiresOn: "2026-10-08" },
    ] }));
    expect(q.map(i => [i.entryId, i.fyi])).toEqual([[3, true], [1, true]]);
  });
  it("meetings today/tomorrow, or past with no write-up", () => {
    const q = attentionQueue(facts({ meetings: [
      { entryId: 1, userId: 1, meetingDate: "2026-10-13", writtenUp: false },
      { entryId: 2, userId: 1, meetingDate: "2026-10-14", writtenUp: false },
      { entryId: 3, userId: 1, meetingDate: "2026-10-05", writtenUp: false },
      { entryId: 4, userId: 1, meetingDate: "2026-10-05", writtenUp: true },
    ] }));
    expect(q.map(i => i.entryId)).toEqual([3, 1]);
    expect(attentionLine(q[0])).toBe("Meeting on 5 Oct 2026 not written up yet");
  });
  it("lead times are settings", () => {
    const q = attentionQueue(facts({ settings: { ...DEFAULT_ATTENTION_SETTINGS, probationDays: 30 }, probations: [{ userId: 1, endDate: "2026-11-10", outcome: null }] }));
    expect(q).toHaveLength(1);
  });
  it("a viewer never sees an item about their own record", () => {
    const q = attentionQueue(facts({ probations: [{ userId: 6, endDate: "2026-10-12", outcome: null }, { userId: 7, endDate: "2026-10-12", outcome: null }] }));
    const lorna = 6;
    expect(queueForViewer(q, uid => uid !== lorna).map(i => i.userId)).toEqual([7]);
  });
});

describe("the one generic to-do", () => {
  it("says nothing about anyone", () => {
    const t = hrAttentionTodo(3);
    expect(t.title).toBe(HR_ATTENTION_TODO_TITLE);
    expect(t.notes).toBeNull();
    expect(t.url).toBe("/people/attention");
    expect(`${t.title} ${t.url}`).not.toMatch(/\d|probation|warning|review|meeting|Test|Person/i);
  });
  const item = attentionQueue(facts({ probations: [{ userId: 1, endDate: "2026-10-12", outcome: null }] }));
  const fyiOnly = attentionQueue(facts({ warnings: [{ entryId: 1, userId: 1, expiresOn: "2026-10-20" }] }));
  it("one while there's something to do; never a second; ticks off when the queue empties", () => {
    expect(planAttentionTodo(item, [])).toEqual({ create: true, close: [] });
    expect(planAttentionTodo(item, [5])).toEqual({ create: false, close: [] });
    expect(planAttentionTodo(item, [5, 9])).toEqual({ create: false, close: [9] });
    expect(planAttentionTodo([], [5])).toEqual({ create: false, close: [5] });
    expect(planAttentionTodo(fyiOnly, [])).toEqual({ create: false, close: [] });
  });
});
