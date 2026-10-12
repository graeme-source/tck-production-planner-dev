// More than one classification on an entry (migration 0184) — every rule
// that asks "what is this about?" reads the whole ticked set.
import { describe, it, expect } from "vitest";
import {
  SEED_STAGES, SEED_CLASSIFICATIONS, type Stage, type Classification, type EntryLike, type TimelineEntry,
  entryClassIds, cleanClassIds, combinedEvidence, entryClassification, entryClassLabels,
  effectiveStage, usesField, entryHeadline, entryLevel, filterEntries, classificationCounts, recordTimelineEvents, templatesForEntry,
  type LetterTemplate,
} from "./index";
import { entryReviewFact, policyTriggerStatus, triggersAnswered } from "./policy-trigger";

const stages: Stage[] = SEED_STAGES.map((s, i) => ({ ...s, id: i + 1 }));
const VERBAL = stages[2];
const classes: Classification[] = [
  ...SEED_CLASSIFICATIONS.map((c, i) => ({ ...c, id: i + 1 })),
  { id: 50, label: "1:1 / catch-up", sortOrder: 25, fieldSets: [], evidence: null, active: true },
  { id: 51, label: "Maternity review", sortOrder: 26, fieldSets: [], evidence: null, active: true },
];
const id = (l: string) => classes.find(c => c.label.startsWith(l))!.id;
const entry = (over: Partial<EntryLike> = {}): EntryLike => ({
  id: 1, classificationId: id("1:1"), entryDate: "2026-10-01", title: "", status: "open",
  stageId: null, warningExpiresOn: null, warningWithdrawnAt: null, ...over,
});

describe("the ticked set", () => {
  it("primary first, each once; no set = just the primary", () => {
    expect(entryClassIds({ classificationId: 4 })).toEqual([4]);
    expect(entryClassIds({ classificationId: 4, classificationIds: [] })).toEqual([4]);
    expect(entryClassIds({ classificationId: 4, classificationIds: [5, 4, 3, 5] })).toEqual([4, 5, 3]);
  });
  it("cleanClassIds keeps the ticking order and drops junk", () => {
    expect(cleanClassIds([5, 3, 5, 0, -1, 2.5])).toEqual([5, 3]);
  });
  it("labels for the chips", () => {
    expect(entryClassLabels({ classificationId: id("Attendance"), classificationIds: [id("Timekeeping")] }, classes)).toEqual(["Attendance", "Timekeeping"]);
  });
});

describe("merged classification", () => {
  it("field sets of ANY ticked one, evidence attendance over timekeeping", () => {
    const m = entryClassification({ classificationId: id("Performance"), classificationIds: [id("Probation"), id("Timekeeping")] }, classes)!;
    expect(m.id).toBe(id("Performance"));
    expect(m.label).toBe("Performance appraisal + Probation review + Timekeeping");
    expect(m.fieldSets).toEqual(["stage", "rating", "pay", "probation"]);
    expect(m.evidence).toBe("timekeeping");
    expect(combinedEvidence(["timekeeping", null, "attendance"])).toBe("attendance");
    expect(combinedEvidence([null])).toBeNull();
  });
  it("one ticked = that classification as it is", () => {
    expect(entryClassification({ classificationId: id("Disciplinary") }, classes)).toBe(classes.find(c => c.id === id("Disciplinary")));
  });
  it("probation fields show if any ticked classification uses them", () => {
    expect(usesField(entryClassification({ classificationId: id("1:1") }, classes), "probation")).toBe(false);
    expect(usesField(entryClassification({ classificationId: id("1:1"), classificationIds: [id("Probation")] }, classes), "probation")).toBe(true);
  });
});

describe("formal rules follow any formal classification", () => {
  it("a 1:1 also ticked Disciplinary keeps its stage — formal, headline names both", () => {
    const e = entry({ classificationIds: [id("Disciplinary")], stageId: VERBAL.id, warningExpiresOn: "2027-04-01" });
    expect(effectiveStage(e, classes, stages)?.id).toBe(VERBAL.id);
    expect(entryLevel(e, classes, stages)).toBe("formal");
    expect(entryHeadline(e, classes, stages)).toBe(`Formal · ${VERBAL.label} · 1:1 / catch-up + Disciplinary`);
    // Without Disciplinary ticked, the kept stage is hidden, not live.
    expect(effectiveStage(entry({ stageId: VERBAL.id }), classes, stages)).toBeNull();
  });
  it("letters: a stage letter is offered when any ticked classification uses stages", () => {
    const t: LetterTemplate = { id: 1, key: "verbal", title: "V", body: "", fieldSet: "stage", stageId: VERBAL.id, stageType: null,
      probationOutcome: null, requiresMeeting: false, requiresPay: false, sortOrder: 1, active: true };
    const f = { stageId: VERBAL.id, probationOutcome: null, meetingDate: null, payTo: null };
    expect(templatesForEntry({ ...f, classificationId: id("1:1") }, classes, stages, [t])).toEqual([]);
    expect(templatesForEntry({ ...f, classificationId: id("1:1"), classificationIds: [id("Disciplinary")] }, classes, stages, [t])).toEqual([t]);
  });
});

describe("filters and timeline", () => {
  const a = entry({ id: 1, classificationId: id("Attendance"), classificationIds: [id("Timekeeping")], entryDate: "2026-10-02" });
  const b = entry({ id: 2, classificationId: id("Timekeeping"), entryDate: "2026-10-01" });
  it("an entry shows under each of its classifications, and counts under each", () => {
    expect(filterEntries([a, b], id("Timekeeping")).map(e => e.id)).toEqual([1, 2]);
    expect(filterEntries([a, b], id("Attendance")).map(e => e.id)).toEqual([1]);
    expect(classificationCounts([a, b], classes)).toEqual([
      { id: id("Attendance"), label: "Attendance", count: 1 },
      { id: id("Timekeeping"), label: "Timekeeping", count: 2 },
    ]);
  });
  it("the timeline names every classification", () => {
    const t: TimelineEntry = { ...a, closedOn: null, meetingType: null, meetingDate: null, meetingTime: null };
    expect(recordTimelineEvents([t], classes, stages, "2026-10-12")[0].title).toBe("Attendance + Timekeeping");
  });
});

describe("the attendance trigger reads every ticked classification", () => {
  const today = "2026-10-12";
  const SICK = ["2026-01-05", "2026-03-02", "2026-05-04", "2026-08-03"];
  const base = { id: 9, meetingStatus: "held", meetingDate: "2026-10-12", entryDate: "2026-10-12", answersTrigger: null };
  it("automatic: answers if ANY ticked classification is attendance / timekeeping evidence", () => {
    expect(triggersAnswered(null, [null, "attendance"])).toEqual(["sickness", "lates"]);
    expect(triggersAnswered(null, [null, "timekeeping"])).toEqual(["lates"]);
    expect(triggersAnswered(null, [null, null])).toEqual([]);
    const f = entryReviewFact({ ...base, evidence: [null, "attendance"] }, today)!;
    expect(policyTriggerStatus("sickness", { threshold: 4, instanceDates: SICK, reviews: [f] })?.state).toBe("handled");
  });
  it("a maternity review + 1:1 with no link doesn't answer it; 'none' beats attendance evidence", () => {
    expect(entryReviewFact({ ...base, evidence: [null, null] }, today)).toBeNull();
    expect(entryReviewFact({ ...base, evidence: ["attendance"], answersTrigger: "none" }, today)).toBeNull();
  });
});
