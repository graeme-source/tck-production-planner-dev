import { describe, expect, it } from "vitest";
import type { PolicyTriggerStatus } from "@workspace/people-reviews";
import { DEFAULT_PEOPLE_SORT, attentionCount, personStatus, sortPeopleRows, type PersonTableRow } from "./people-list-table";

const person = (name: string, extra: Partial<PersonTableRow> = {}): PersonTableRow => ({
  name, jobTitle: null, isActive: true, awayNow: false, formsNeeded: 0,
  triggerReview: { sickness: null, lates: null }, nextMeeting: null, ...extra,
});
const trig = (kind: PolicyTriggerStatus["kind"], state: PolicyTriggerStatus["state"]): PolicyTriggerStatus =>
  ({ kind, state, count: 8, threshold: 6, reachedOn: "2026-08-03", lastReview: null, booked: null, sinceReview: 0 });

describe("People table", () => {
  it("defaults to name A→Z", () => {
    expect(sortPeopleRows([person("cara"), person("Ann"), person("Ben")], DEFAULT_PEOPLE_SORT).map(p => p.name))
      .toEqual(["Ann", "Ben", "cara"]);
  });
  it("counts what needs attention, including an open review", () => {
    const p = person("A", { formsNeeded: 2, triggerReview: { sickness: trig("sickness", "due"), lates: null } });
    expect(attentionCount(p, false)).toBe(3);
    expect(attentionCount(p, true)).toBe(4);
    expect(attentionCount(person("B"), false)).toBe(0);
  });
  it("a trigger already reviewed or booked doesn't count; due again does", () => {
    expect(attentionCount(person("Nozomi", { triggerReview: { sickness: null, lates: trig("lates", "handled") } }), false)).toBe(0);
    expect(attentionCount(person("B", { triggerReview: { sickness: null, lates: trig("lates", "booked") } }), false)).toBe(0);
    expect(attentionCount(person("C", { triggerReview: { sickness: null, lates: trig("lates", "due_again") } }), false)).toBe(1);
  });
  it("sorts by attention most-first, nobody-to-chase at the bottom", () => {
    const rows = [person("Calm"), person("Busy", { formsNeeded: 2 }), person("Review"), person("One", { triggerReview: { sickness: null, lates: trig("lates", "due") } })];
    const out = sortPeopleRows(rows, { key: "attention", dir: "desc" }, p => p.name === "Review");
    expect(out.map(p => p.name)).toEqual(["Busy", "One", "Review", "Calm"]);
  });
  it("sorts next meeting soonest first, with no meeting last", () => {
    const rows = [person("None"), person("Late", { nextMeeting: { date: "2026-11-02" } }), person("Soon", { nextMeeting: { date: "2026-10-14" } })];
    expect(sortPeopleRows(rows, { key: "nextMeeting", dir: "asc" }).map(p => p.name)).toEqual(["Soon", "Late", "None"]);
  });
  it("status: working, off now, leaver", () => {
    expect(personStatus(person("a"))).toBe("working");
    expect(personStatus(person("a", { awayNow: true }))).toBe("off-now");
    expect(personStatus(person("a", { isActive: false, awayNow: true }))).toBe("leaver");
    const rows = [person("L", { isActive: false }), person("O", { awayNow: true }), person("W")];
    expect(sortPeopleRows(rows, { key: "status", dir: "asc" }).map(p => p.name)).toEqual(["W", "O", "L"]);
  });
  it("job title blanks sort last", () => {
    const rows = [person("NoTitle"), person("Chef", { jobTitle: "Chef" }), person("Baker", { jobTitle: "baker" })];
    expect(sortPeopleRows(rows, { key: "jobTitle", dir: "desc" }).map(p => p.name)).toEqual(["Chef", "Baker", "NoTitle"]);
  });
});
