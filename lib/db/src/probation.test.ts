import { describe, it, expect } from "vitest";
import {
  addMonths, probationDueDate, needsProbationPrompt,
  DEFAULT_PROBATION_MONTHS, PROBATION_NOTICE_WEEKS,
  type ProbationCandidate,
} from "./probation";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

// The feature goes live on the day it was asked for; everyone employed before
// that had their probation arranged by hand.
const LIVE_FROM = d("2026-09-03");
const OPTS = { defaultMonths: DEFAULT_PROBATION_MONTHS, promptForHiresFrom: LIVE_FROM };

const candidate = (over: Partial<ProbationCandidate> = {}): ProbationCandidate => ({
  hiredOn: d("2026-09-10"),
  probationMonths: null,
  alreadyBooked: false,
  ...over,
});

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(iso(addMonths(d("2026-09-10"), 6))).toBe("2027-03-10");
    expect(iso(addMonths(d("2026-06-22"), 3))).toBe("2026-09-22");
  });

  it("clamps to the end of a shorter month", () => {
    // 31 August + 6 months is February, which has no 31st.
    expect(iso(addMonths(d("2026-08-31"), 6))).toBe("2027-02-28");
    expect(iso(addMonths(d("2027-08-31"), 6))).toBe("2028-02-29"); // leap year
    expect(iso(addMonths(d("2026-05-31"), 1))).toBe("2026-06-30");
  });

  it("crosses a year end", () => {
    expect(iso(addMonths(d("2026-11-15"), 6))).toBe("2027-05-15");
  });
});

describe("probationDueDate", () => {
  it("is six months on for a new starter", () => {
    expect(iso(probationDueDate(d("2026-09-10"), 6))).toBe("2027-03-10");
  });

  // Major Sarai: three months, due 22 September — the case Graeme named.
  it("matches the three-month case that already exists", () => {
    expect(iso(probationDueDate(d("2026-06-22"), 3))).toBe("2026-09-22");
  });
});

describe("needsProbationPrompt", () => {
  const hired = d("2026-09-10");              // starts a week after go-live
  const due = probationDueDate(hired, 6);     // 2027-03-10
  const threeWeeksBefore = d("2027-02-17");

  it("stays quiet when the review is still months away", () => {
    expect(needsProbationPrompt(candidate({ hiredOn: hired }), d("2026-12-01"), OPTS)).toBe(false);
  });

  it("fires three weeks before it is due", () => {
    expect(needsProbationPrompt(candidate({ hiredOn: hired }), threeWeeksBefore, OPTS)).toBe(true);
  });

  it("does not fire a day too early", () => {
    expect(needsProbationPrompt(candidate({ hiredOn: hired }), d("2027-02-16"), OPTS)).toBe(false);
  });

  // A missed probation review is worse than a late reminder, so an overdue
  // one keeps asking rather than going quiet.
  it("keeps asking once it is overdue", () => {
    expect(needsProbationPrompt(candidate({ hiredOn: hired }), d("2027-04-01"), OPTS)).toBe(true);
  });

  it("stops as soon as a meeting is booked", () => {
    expect(needsProbationPrompt(
      candidate({ hiredOn: hired, alreadyBooked: true }), threeWeeksBefore, OPTS,
    )).toBe(false);
  });

  it("honours a probation length set on the person", () => {
    // Three months from 10 Sep is 10 Dec; three weeks before is 19 Nov.
    const threeMonth = candidate({ hiredOn: hired, probationMonths: 3 });
    expect(needsProbationPrompt(threeMonth, d("2026-11-19"), OPTS)).toBe(true);
    expect(needsProbationPrompt(threeMonth, d("2026-11-01"), OPTS)).toBe(false);
  });

  // The reason this rule exists: Major's 22 September review was arranged by
  // hand before the feature existed. Nudging Lorna about it would be noise.
  it("leaves alone everyone who started before the feature went live", () => {
    const major = candidate({ hiredOn: d("2026-06-22"), probationMonths: 3 });
    // Due 22 Sep, so without this rule 1 Sep would be inside the notice window.
    expect(needsProbationPrompt(major, d("2026-09-05"), OPTS)).toBe(false);
    expect(needsProbationPrompt(major, d("2026-09-22"), OPTS)).toBe(false);
  });

  it("says nothing when Planday has no start date for someone", () => {
    expect(needsProbationPrompt(candidate({ hiredOn: null }), threeWeeksBefore, OPTS)).toBe(false);
    expect(needsProbationPrompt(candidate({ hiredOn: new Date("nonsense") }), threeWeeksBefore, OPTS)).toBe(false);
  });

  it("says nothing for a nonsense probation length", () => {
    expect(needsProbationPrompt(candidate({ hiredOn: hired, probationMonths: 0 }), threeWeeksBefore, OPTS)).toBe(false);
    expect(needsProbationPrompt(candidate({ hiredOn: hired, probationMonths: -3 }), threeWeeksBefore, OPTS)).toBe(false);
  });

  it("uses three weeks' notice by default", () => {
    expect(PROBATION_NOTICE_WEEKS).toBe(3);
    expect(DEFAULT_PROBATION_MONTHS).toBe(6);
  });
});
