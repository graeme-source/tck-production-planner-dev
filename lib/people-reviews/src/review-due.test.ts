import { describe, it, expect } from "vitest";
import {
  reviewDue, reviewCutoff, wholeMonthsBetween, agoText, reviewDueSortValue, noReviewRequiredAuditDetail,
  REVIEW_DUE_MONTHS, PERFORMANCE_APPRAISAL_LABEL, publishedKind, lastReviewOf, canMarkReviewDate,
} from "./index";

const TODAY = "2026-11-25";

describe("reviewDue — the four states", () => {
  it("a review inside 6 months is up to date (green, not flagged)", () => {
    const d = reviewDue({ lastReviewDate: "2026-09-01", noReviewRequired: false }, TODAY);
    expect(d.state).toBe("up_to_date");
    expect(d.label).toBe("Up to date");
    expect(d.tone).toBe("green");
    expect(d.flagged).toBe(false);
    expect(d.dateText).toBe("1 Sep 2026");
    expect(d.dueOn).toBe("2027-03-01");
  });

  it("more than 6 months ago is Overdue (red, flagged)", () => {
    const d = reviewDue({ lastReviewDate: "2026-03-12", noReviewRequired: false }, TODAY);
    expect(d.state).toBe("overdue");
    expect(d.label).toBe("Overdue");
    expect(d.tone).toBe("red");
    expect(d.flagged).toBe(true);
    expect(d.dateText).toBe("12 Mar 2026");
    expect(d.agoText).toBe("8 months ago");
    expect(d.dueOn).toBe("2026-09-12");
  });

  it("no review on record says No record and Possibly overdue (amber, flagged)", () => {
    const d = reviewDue({ lastReviewDate: null, noReviewRequired: false }, TODAY);
    expect(d.state).toBe("no_record");
    expect(d.dateText).toBe("No record");
    expect(d.label).toBe("Possibly overdue");
    expect(d.tone).toBe("amber");
    expect(d.flagged).toBe(true);
    expect(d.agoText).toBeNull();
    expect(d.dueOn).toBeNull();
  });

  it("No review required is muted and never flagged — with or without reviews, however old", () => {
    for (const lastReviewDate of [null, "2020-01-01", "2026-11-01"]) {
      const d = reviewDue({ lastReviewDate, noReviewRequired: true }, TODAY);
      expect(d.state).toBe("not_required");
      expect(d.label).toBe("No review required");
      expect(d.dateText).toBe("No review required");
      expect(d.tone).toBe("muted");
      expect(d.flagged).toBe(false);
    }
  });

  it("accepts a timestamp-shaped date", () => {
    expect(reviewDue({ lastReviewDate: "2026-11-20T00:00:00.000Z", noReviewRequired: false }, TODAY).state).toBe("up_to_date");
  });
});

describe("the 6-month boundary — calendar months back from today", () => {
  it("is 6 months", () => expect(REVIEW_DUE_MONTHS).toBe(6));

  it("exactly 6 months ago is still up to date; the day before is overdue", () => {
    expect(reviewCutoff(TODAY)).toBe("2026-05-25");
    expect(reviewDue({ lastReviewDate: "2026-05-25", noReviewRequired: false }, TODAY).state).toBe("up_to_date");
    expect(reviewDue({ lastReviewDate: "2026-05-24", noReviewRequired: false }, TODAY).state).toBe("overdue");
  });

  it("clamps to the month's last day (31 Aug → end of Feb), leap years too", () => {
    expect(reviewCutoff("2026-08-31")).toBe("2026-02-28");
    expect(reviewCutoff("2028-08-31")).toBe("2028-02-29");
    expect(reviewDue({ lastReviewDate: "2026-02-28", noReviewRequired: false }, "2026-08-31").state).toBe("up_to_date");
    expect(reviewDue({ lastReviewDate: "2026-02-27", noReviewRequired: false }, "2026-08-31").state).toBe("overdue");
  });

  it("crosses the year (5 Mar 2027 → 5 Sep 2026)", () => {
    expect(reviewCutoff("2027-03-05")).toBe("2026-09-05");
    expect(reviewDue({ lastReviewDate: "2026-09-04", noReviewRequired: false }, "2027-03-05").state).toBe("overdue");
    expect(reviewDue({ lastReviewDate: "2026-09-05", noReviewRequired: false }, "2027-03-05").state).toBe("up_to_date");
  });

  it("a review held today is up to date", () => {
    expect(reviewDue({ lastReviewDate: TODAY, noReviewRequired: false }, TODAY).state).toBe("up_to_date");
  });
});

describe("how long ago", () => {
  it("counts whole calendar months", () => {
    expect(wholeMonthsBetween("2026-03-12", "2026-11-25")).toBe(8);
    expect(wholeMonthsBetween("2026-03-26", "2026-11-25")).toBe(7);
    expect(wholeMonthsBetween("2026-01-31", "2026-02-28")).toBe(1);
    expect(wholeMonthsBetween("2026-11-25", "2026-11-01")).toBe(0);
  });

  it("reads plainly", () => {
    expect(agoText(TODAY, TODAY)).toBe("today");
    expect(agoText("2026-11-24", TODAY)).toBe("yesterday");
    expect(agoText("2026-11-20", TODAY)).toBe("5 days ago");
    expect(agoText("2026-11-04", TODAY)).toBe("3 weeks ago");
    expect(agoText("2026-10-25", TODAY)).toBe("1 month ago");
    expect(agoText("2026-03-12", TODAY)).toBe("8 months ago");
    expect(agoText("2025-01-10", TODAY)).toBe("22 months ago");
    expect(agoText("2023-06-01", TODAY)).toBe("3 years ago");
  });
});

describe("sorting the column", () => {
  const val = (lastReviewDate: string | null, noReviewRequired = false) =>
    reviewDueSortValue(reviewDue({ lastReviewDate, noReviewRequired }, TODAY), lastReviewDate);

  it("A→Z: no record first, then oldest review; no review required and unknown are blank", () => {
    const values = [val("2026-10-01"), val(null), val("2025-02-01"), val("2025-02-01", true)];
    expect(values).toEqual(["2026-10-01", "0000-00-00", "2025-02-01", null]);
    expect(reviewDueSortValue(null, null)).toBeNull();
    const sorted = values.filter((v): v is string => v != null).sort();
    expect(sorted).toEqual(["0000-00-00", "2025-02-01", "2026-10-01"]);
  });
});

describe("wording", () => {
  it("audits the switch in plain words", () => {
    expect(noReviewRequiredAuditDetail(true)).toBe("Set to No review required");
    expect(noReviewRequiredAuditDetail(false)).toMatch(/required again/);
  });

  it("the review classification is the one the published email treats as a performance review", () => {
    expect(publishedKind([PERFORMANCE_APPRAISAL_LABEL], "informal")).toBe("performance");
  });
});

describe("lastReviewOf — a date marked by hand (26 Nov 2026)", () => {
  it("takes the later of the record and the marked date; the record on a tie", () => {
    expect(lastReviewOf({ date: "2026-10-29", entryId: 9 }, null)).toEqual({ date: "2026-10-29", entryId: 9, source: "record" });
    expect(lastReviewOf(null, "2026-05-01")).toEqual({ date: "2026-05-01", entryId: null, source: "marked" });
    expect(lastReviewOf({ date: "2026-03-01", entryId: 4 }, "2026-05-01")?.source).toBe("marked");
    expect(lastReviewOf({ date: "2026-06-01", entryId: 4 }, "2026-05-01")?.source).toBe("record");
    expect(lastReviewOf({ date: "2026-05-01", entryId: 4 }, "2026-05-01")?.source).toBe("record");
    expect(lastReviewOf(null, null)).toBeNull();
  });
  it("only real past days can be marked", () => {
    expect(canMarkReviewDate("2026-10-26", "2026-11-26")).toBe(true);
    expect(canMarkReviewDate("2026-11-26", "2026-11-26")).toBe(true);
    expect(canMarkReviewDate("2026-11-27", "2026-11-26")).toBe(false);
    expect(canMarkReviewDate("2026-02-30", "2026-11-26")).toBe(false);
    expect(canMarkReviewDate("26/10/2026", "2026-11-26")).toBe(false);
  });
});
