import { describe, it, expect } from "vitest";
import {
  SEED_STAGES, SEED_CLASSIFICATIONS, type Stage, type Classification, type EntryLike, type TimelineEntry,
  addMonthsIso, addDaysIso, defaultWarningExpiry, warningState, warningStatusLabel, longestLiveWarning, checkWarningDates,
  entryWarning, expiryForStage, effectiveStage, usesField, cleanFieldSets,
  nextStage, entryLevel, entrySeverity, mostSeriousEntry, reviewBadge, entryHeadline, reclassify,
  canEditLists,
  evidenceLine, meetingChecklist, isFormalHearing, cleanChecklist, recordTodo, planTodo,
  recordTimelineEvents, filterEntries, classificationCounts, fmtDayIso, londonTodayIso,
} from "./index";

const stages: Stage[] = SEED_STAGES.map((s, i) => ({ ...s, id: i + 1 }));
const [DISCUSSION, PLAN, VERBAL, FIRST, FINAL, DISMISSAL] = stages;
const classes: Classification[] = SEED_CLASSIFICATIONS.map((c, i) => ({ ...c, id: i + 1 }));
const byLabel = (l: string) => classes.find(c => c.label.startsWith(l))!;
const APPRAISAL = byLabel("Performance appraisal");
const PROBATION = byLabel("Probation");
const DISCIPLINARY = byLabel("Disciplinary");
const ATTENDANCE = byLabel("Attendance");
const TIMEKEEPING = byLabel("Timekeeping");
const HEALTH = byLabel("Health");
const PRAISE = byLabel("Praise");

const entry = (over: Partial<EntryLike> = {}): EntryLike => ({
  id: 1, classificationId: TIMEKEEPING.id, entryDate: "2026-10-01", title: "", status: "open",
  stageId: null, warningExpiresOn: null, warningWithdrawnAt: null, ...over,
});

describe("seeded lists", () => {
  it("classifications in Graeme's order", () => {
    expect(SEED_CLASSIFICATIONS.map(c => c.label)).toEqual([
      "Performance appraisal", "Probation review", "Disciplinary", "Attendance", "Timekeeping",
      "Health / fitness for work", "Grievance (raised by the employee)", "Praise / recognition",
      "Training & qualifications", "Contract change (role, hours, pay)", "Other",
    ]);
  });
  it("the extra fields are data per classification", () => {
    expect(APPRAISAL.fieldSets).toEqual(["rating", "pay"]);
    expect(PROBATION.fieldSets).toEqual(["rating", "pay", "probation"]); // shares appraisal's fields + outcome
    for (const c of [DISCIPLINARY, ATTENDANCE, TIMEKEEPING]) expect(c.fieldSets).toEqual(["stage"]);
    expect(HEALTH.fieldSets).toEqual(["fitness"]);
    expect(PRAISE.fieldSets).toEqual([]);
    expect(ATTENDANCE.evidence).toBe("attendance");
    expect(TIMEKEEPING.evidence).toBe("timekeeping");
  });
  it("a new classification can reuse any field set; unknown ones are dropped", () => {
    expect(cleanFieldSets(["pay", "stage", "bogus", "pay"])).toEqual(["stage", "pay"]);
    const custom: Classification = { id: 99, label: "Capability", sortOrder: 5, fieldSets: ["stage", "rating"], evidence: null, active: true };
    expect(usesField(custom, "stage")).toBe(true);
    expect(usesField(custom, "fitness")).toBe(false);
    expect(usesField(undefined, "stage")).toBe(false);
  });
  it("stage ladder with the agreed expiries", () => {
    expect(SEED_STAGES.map(s => s.label)).toEqual([
      "Informal discussion", "Improvement plan", "Verbal warning", "First written warning", "Final written warning", "Dismissal",
    ]);
    expect([VERBAL, FIRST, FINAL].map(s => s.defaultExpiryMonths)).toEqual([6, 12, 12]);
    expect(VERBAL.optional).toBe(true);
    expect(DISMISSAL.type).toBe("outcome");
  });
});

describe("warning expiry maths", () => {
  it("calendar months, clamped to month end", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
  });
  it("live until the day before the anniversary", () => {
    expect(defaultWarningExpiry("2026-10-12", 6)).toBe("2027-04-11");
    expect(defaultWarningExpiry("2026-10-12", 12)).toBe("2027-10-11");
  });
  it("live through the expiry day, expired after, withdrawn beats both", () => {
    const w = { issuedOn: "2026-10-12", expiresOn: "2027-04-11" };
    expect(warningState(w, "2027-04-11")).toBe("live");
    expect(warningState(w, "2027-04-12")).toBe("expired");
    expect(warningState({ ...w, withdrawnAt: "x" }, "2026-11-02")).toBe("withdrawn");
    expect(warningStatusLabel(w, "2026-12-01")).toBe("Live until 11 Apr 2027");
    expect(warningStatusLabel(w, "2027-05-01")).toBe("Expired 12 Apr 2027");
  });
  it("longest live warning; refuses expiry before issue", () => {
    const ws = [
      { id: 1, issuedOn: "2026-01-01", expiresOn: "2026-06-30" },
      { id: 2, issuedOn: "2026-09-01", expiresOn: "2027-08-31" },
      { id: 3, issuedOn: "2026-09-01", expiresOn: "2027-12-31", withdrawnAt: "2026-10-01" },
    ];
    expect(longestLiveWarning(ws, "2026-10-12")?.id).toBe(2);
    expect(checkWarningDates("2026-10-12", "2026-10-11")).toMatch(/can't be before/);
  });
  it("picking a warning stage fills the default expiry, keeps an edited one", () => {
    expect(expiryForStage(VERBAL, "2026-10-12", null)).toBe("2027-04-11");
    expect(expiryForStage(FIRST, "2026-10-12", "2027-06-30")).toBe("2027-06-30");
    expect(expiryForStage(PLAN, "2026-10-12", "2027-06-30")).toBe("2027-06-30"); // kept, unused
  });
  it("an entry is a warning only while its classification uses stages", () => {
    const e = entry({ classificationId: ATTENDANCE.id, stageId: VERBAL.id, warningExpiresOn: "2027-04-11", entryDate: "2026-10-12" });
    expect(entryWarning(e, classes, stages)?.stage.id).toBe(VERBAL.id);
    expect(entryWarning({ ...e, classificationId: PRAISE.id }, classes, stages)).toBeNull();
    expect(entryWarning({ ...e, stageId: PLAN.id }, classes, stages)).toBeNull();
  });
});

describe("in review: level, seriousness, badge", () => {
  it("open with no stage = informal; formal stage = formal; closed = none", () => {
    expect(entryLevel(entry(), classes, stages)).toBe("informal");
    expect(entryLevel(entry({ stageId: VERBAL.id }), classes, stages)).toBe("formal");
    expect(entryLevel(entry({ stageId: VERBAL.id, status: "closed" }), classes, stages)).toBe("none");
    // Open appraisal: in review, never formal (no stages there).
    expect(entryLevel(entry({ classificationId: APPRAISAL.id, stageId: FINAL.id }), classes, stages)).toBe("informal");
  });
  it("formal outranks informal, then stage rank", () => {
    expect(entrySeverity(entry({ stageId: VERBAL.id }), classes, stages)).toBeGreaterThan(entrySeverity(entry({ stageId: PLAN.id }), classes, stages));
    expect(entrySeverity(entry({ stageId: FINAL.id }), classes, stages)).toBeGreaterThan(entrySeverity(entry({ stageId: FIRST.id }), classes, stages));
    expect(entrySeverity(entry({ stageId: DISCUSSION.id }), classes, stages)).toBeGreaterThan(entrySeverity(entry(), classes, stages));
  });
  it("names the most serious open entry", () => {
    const es = [
      entry({ id: 1, classificationId: TIMEKEEPING.id, stageId: DISCUSSION.id }),
      entry({ id: 2, classificationId: ATTENDANCE.id, stageId: VERBAL.id }),
      entry({ id: 3, classificationId: DISCIPLINARY.id, stageId: FINAL.id, status: "closed" }),
      entry({ id: 4, classificationId: PRAISE.id, status: "closed" }),
    ];
    expect(mostSeriousEntry(es, classes, stages)?.id).toBe(2);
    expect(reviewBadge(es, classes, stages)).toEqual({ level: "formal", label: "Formal · Verbal warning · Attendance", entryId: 2, otherOpen: 1 });
  });
  it("informal wording, ties to the older, none when nothing open", () => {
    expect(reviewBadge([entry({ id: 5, entryDate: "2026-10-05" }), entry({ id: 4, classificationId: ATTENDANCE.id, entryDate: "2026-09-01" })], classes, stages)?.label)
      .toBe("In review · Attendance");
    expect(reviewBadge([entry({ status: "closed" })], classes, stages)).toBeNull();
    expect(entryHeadline(entry({ status: "closed" }), classes, stages)).toBe("Timekeeping");
  });
});

describe("reclassification", () => {
  it("keeps what still applies, hides the rest, logs it", () => {
    const r = reclassify(APPRAISAL, PROBATION);
    expect(r).toEqual({ message: "Reclassified from Performance appraisal to Probation review", hidden: [], shown: ["probation"], kept: ["rating", "pay"] });
    const r2 = reclassify(ATTENDANCE, HEALTH);
    expect(r2.hidden).toEqual(["stage"]);
    expect(r2.shown).toEqual(["fitness"]);
  });
  it("a hidden stage stops counting for the badge, and comes back if changed back", () => {
    const e = entry({ classificationId: ATTENDANCE.id, stageId: FIRST.id, warningExpiresOn: "2027-09-30" });
    expect(reviewBadge([e], classes, stages)?.label).toBe("Formal · First written warning · Attendance");
    const moved = { ...e, classificationId: HEALTH.id };
    expect(effectiveStage(moved, classes, stages)).toBeNull();
    expect(reviewBadge([moved], classes, stages)?.label).toBe("In review · Health / fitness for work");
    expect(moved.stageId).toBe(FIRST.id); // value kept
    const back = { ...moved, classificationId: DISCIPLINARY.id };
    expect(reviewBadge([back], classes, stages)?.label).toBe("Formal · First written warning · Disciplinary");
  });
});

describe("list editing", () => {
  it("founder, or admin with People access", () => {
    expect(canEditLists({ hasPeopleAccess: true, role: "admin" })).toBe(true);
    expect(canEditLists({ hasPeopleAccess: true, role: "manager" })).toBe(false);
    expect(canEditLists({ hasPeopleAccess: false, role: "manager", isFounder: true })).toBe(true);
    expect(canEditLists({ hasPeopleAccess: false, role: "admin" })).toBe(false);
  });
});

describe("evidence", () => {
  const a = { sickInstances: 4, sickDays: 6, lates: 2, otherAbsenceDays: 1, triggers: { sickness: true, lates: false }, policy: { sickInstances: 4, lates: 6, months: 12 } };
  it("attendance and timekeeping, from the classification's evidence kind", () => {
    expect(evidenceLine("attendance", a)).toEqual({
      text: "4 sickness instances (6 days), plus 1 day of other absence in the last 12 months. Review trigger: 4 instances.", triggered: true,
    });
    expect(evidenceLine("timekeeping", a)).toEqual({ text: "2 lates in the last 12 months. Review trigger: 6 lates.", triggered: false });
    expect(evidenceLine(null, a)).toBeNull();
    expect(evidenceLine("attendance", null)).toBeNull();
  });
});

describe("formal meetings", () => {
  it("hearings get the notice + right-to-be-accompanied checklist", () => {
    expect(isFormalHearing("disciplinary")).toBe(true);
    expect(isFormalHearing("review")).toBe(false);
    expect(meetingChecklist("disciplinary").map(i => i.key)).toEqual(expect.arrayContaining(["written_notice", "right_to_accompany"]));
    expect(meetingChecklist("informal_chat")).toEqual([]);
    expect(cleanChecklist("appeal", ["impartial", "evidence_sent", "impartial"])).toEqual(["impartial"]);
  });
});

describe("to-dos", () => {
  it("meeting to-do lands on the booker's list, links back, gives nothing away", () => {
    const t = recordTodo({ kind: "meeting", ownerId: 3, ownerName: "Graeme Carter", subjectUserId: 41, subjectName: "Test Person", entryId: 9, date: "2026-10-20", time: "10:30" });
    expect(t).toEqual({
      assigneeId: 3, createdBy: 3, createdByName: "Graeme Carter", title: "HR meeting at 10:30 — tap here",
      notes: "Details are in HR (private — needs your People PIN).",
      url: "/people/41?entry=9", priority: "high", scheduledFor: "2026-10-20", dueDate: "2026-10-20",
    });
    expect(`${t.title} ${t.notes}`).not.toMatch(/disciplinary|warning|timekeeping|attendance|Test|Person/i);
  });
  it("next-review to-do", () => {
    expect(recordTodo({ kind: "review", ownerId: 3, ownerName: "G", subjectUserId: 41, subjectName: "Test Person", entryId: 9, date: "2027-01-05" }).title)
      .toBe("HR follow-up due — tap here");
  });
  it("create, move, cancel or leave the linked to-do", () => {
    expect(planTodo({ todoId: null, date: null }, { date: "2026-10-20" }, true)).toBe("create");
    expect(planTodo({ todoId: 5, date: "2026-10-20", time: "10:00" }, { date: "2026-10-20", time: "10:00" }, false)).toBe("none");
    expect(planTodo({ todoId: 5, date: "2026-10-20", time: "10:00" }, { date: "2026-10-20", time: "11:00" }, false)).toBe("update");
    expect(planTodo({ todoId: 5, date: "2026-10-20" }, { date: null }, false)).toBe("cancel");
    expect(planTodo({ todoId: null, date: null }, { date: null }, true)).toBe("none");
  });
  it("never makes a to-do unless asked (Graeme, 30 Oct 2026)", () => {
    expect(planTodo({ todoId: null, date: null }, { date: "2026-10-30" }, false)).toBe("none");
    expect(planTodo({ todoId: null, date: "2026-10-30" }, { date: "2026-11-02" }, false)).toBe("none");
  });
});

describe("timeline and filters", () => {
  const e: TimelineEntry = {
    ...entry({ id: 9, classificationId: ATTENDANCE.id, status: "closed", stageId: VERBAL.id, entryDate: "2026-01-10", warningExpiresOn: "2026-07-09", title: "Triggered sickness" }),
    closedOn: "2026-09-01", meetingType: "review", meetingDate: "2026-01-10", meetingTime: "09:00",
    reclassifications: [{ at: "2026-02-01T10:00:00Z", message: "Reclassified from Timekeeping to Attendance" }],
  };
  it("entry, meeting, warning expiry, closed, reclassified — newest first", () => {
    const ev = recordTimelineEvents([e], classes, stages, "2026-10-12");
    expect(ev.map(x => x.kind)).toEqual(["closed", "warning_expired", "reclassified", "meeting", "entry"]);
    expect(ev.find(x => x.kind === "entry")).toMatchObject({ title: "Attendance: Triggered sickness", detail: "Verbal warning · Expired 10 Jul 2026" });
  });
  it("filters by classification, newest first, chips only where there are entries", () => {
    const es = [entry({ id: 1, entryDate: "2026-01-01" }), entry({ id: 2, entryDate: "2026-05-01" }), entry({ id: 3, classificationId: PRAISE.id })];
    expect(filterEntries(es, null).map(x => x.id)).toEqual([3, 2, 1]);
    expect(filterEntries(es, PRAISE.id).map(x => x.id)).toEqual([3]);
    expect(classificationCounts(es, classes)).toEqual([
      { id: TIMEKEEPING.id, label: "Timekeeping", count: 2 }, { id: PRAISE.id, label: "Praise / recognition", count: 1 },
    ]);
  });
});

describe("dates", () => {
  it("formats and shifts", () => {
    expect(fmtDayIso("2027-04-11")).toBe("11 Apr 2027");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(londonTodayIso(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });
});

describe("escalation", () => {
  it("next stage skips turned-off stages and never goes to dismissal by itself", () => {
    expect(nextStage(null, stages)?.id).toBe(DISCUSSION.id);
    expect(nextStage(VERBAL.id, stages)?.id).toBe(FIRST.id);
    expect(nextStage(PLAN.id, stages.map(s => s.id === VERBAL.id ? { ...s, active: false } : s))?.id).toBe(FIRST.id);
    expect(nextStage(FINAL.id, stages)).toBeNull();
  });
});
