import { describe, expect, it } from "vitest";
import {
  agreedSummary, recordEntriesSummary, contractsSummary, documentsSummary, fmtAmount, holidaySummary, hoursSummary, sectionFromSearch,
} from "./person-record-sections";
import type { PersonHoursResponse, HoursReport } from "./hours-worked-view";
import type { EmploymentResponse } from "./people-api";
import type { ContractHistoryResponse, IssuedContractRow } from "./contract-history";
import type { PersonDocumentsResponse } from "./person-documents";

function hours(report: Partial<HoursReport> | null, contracted: number | null, status: PersonHoursResponse["status"] = "ok"): PersonHoursResponse {
  return {
    status,
    person: { id: 1, name: "X", avatarUrl: null, jobTitle: null, linkedToPlanday: true },
    range: { from: "2026-07-12", to: "2026-10-12", today: "2026-10-12" },
    contract: { hours: contracted, source: contracted == null ? null : "issued_contract", sourceText: null, sourceDate: null, notes: [] },
    report: report == null ? null : ({ shifts: 30, avgPaidPerWeek: 38.46, standing: "under", difference: -1.5, ...report } as HoursReport),
  } as PersonHoursResponse;
}

describe("sectionFromSearch", () => {
  it("opens a known panel and ignores anything else", () => {
    expect(sectionFromSearch("?section=holiday")).toBe("holiday");
    expect(sectionFromSearch("section=hours&spell=3:2026-01-01")).toBe("hours");
    expect(sectionFromSearch("?section=pay")).toBeNull();
    expect(sectionFromSearch("")).toBeNull();
  });
});

describe("fmtAmount", () => {
  it("reads days and hours the way the panel does", () => {
    expect(fmtAmount(12.5, "Days")).toBe("12.5 days");
    expect(fmtAmount(40, "Hours")).toBe("40h");
    expect(fmtAmount(null, "Days")).toBe("—");
  });
});

describe("hoursSummary", () => {
  it("compares the weekly average with the contract", () => {
    expect(hoursSummary(hours({}, 40), false)).toEqual({ line: "38.5 h a week vs 40.0 h contracted", tone: "warn" });
    expect(hoursSummary(hours({ standing: "over", avgPaidPerWeek: 42 }, 40), false).tone).toBe("plain");
  });
  it("says when there are no contracted hours", () => {
    expect(hoursSummary(hours({}, null), false).line).toBe("38.5 h a week · no contracted hours on file");
  });
  it("covers loading, Planday problems and empty ranges", () => {
    expect(hoursSummary(undefined, true).line).toBe("Adding up shifts…");
    expect(hoursSummary(hours(null, 40, "not_linked"), false).line).toBe("Not linked to Planday yet");
    expect(hoursSummary(hours(null, 40, "unreachable"), false).line).toMatch(/Couldn't reach Planday/);
    expect(hoursSummary(hours({ shifts: 0 }, 40), false).line).toBe("No approved shifts in the last 3 months");
    expect(hoursSummary(hours({ shifts: 1, avgPaidPerWeek: null }, 40), false).line).toBe("1 shift in the last 3 months");
  });
});

describe("holidaySummary", () => {
  const ok = (balanceNow: number | null, after: number | null): EmploymentResponse => ({
    status: "ok",
    employment: { hiredFrom: "2025-03-03", employeeType: "Full time", contractRule: null, contractRuleNote: null },
    holiday: { accountNames: ["Holiday"], yearStart: null, yearEnd: null, unit: "Days", balanceNow, balanceAfterBooked: after, takenThisYear: 0, upcoming: [], upcomingTotal: 0 },
    fetchedAt: "",
  });
  it("leads with holiday left, then start date and type", () => {
    const s = holidaySummary(ok(12.5, 10), false);
    expect(s.line).toMatch(/^12\.5 days holiday left · Started .*2025 · Full time$/);
    expect(s.tone).toBe("plain");
  });
  it("flags holiday booked beyond what they'll have", () => {
    expect(holidaySummary(ok(2, -1), false).tone).toBe("alert");
  });
  it("covers Planday states", () => {
    expect(holidaySummary({ status: "not_linked" }, false).line).toBe("Not linked to Planday yet");
    expect(holidaySummary(undefined, true).line).toBe("Asking Planday…");
  });
});

describe("contractsSummary", () => {
  const issued = (id: number, issueDate: string, signed: boolean): IssuedContractRow => ({
    id, jobTitle: "", rateOfPay: "", weeklyHours: "", startDate: issueDate, issueDate, issuedAt: issueDate,
    acknowledgedAt: signed ? issueDate : null, signedInitials: null,
  });
  const hist = (i: IssuedContractRow[], uploaded = 0): ContractHistoryResponse => ({
    person: { id: 1, name: "X", jobTitle: null },
    issued: i,
    uploaded: Array.from({ length: uploaded }, (_, n) => ({ id: n, userId: 1, fileName: null, mime: "application/pdf", byteSize: 1, originalIssueDate: null, uploadedAt: "2024-01-01" })),
  });
  it("reads the newest issued contract", () => {
    expect(contractsSummary(hist([issued(1, "2025-01-01", true), issued(2, "2026-01-01", false)]), false, false))
      .toEqual({ line: "Awaiting signature · 2 on file", tone: "warn" });
    expect(contractsSummary(hist([issued(1, "2025-01-01", true)]), false, false).line).toBe("Signed in the app");
  });
  it("counts uploaded-only and empty histories", () => {
    expect(contractsSummary(hist([], 2), false, false).line).toBe("2 uploaded contracts");
    expect(contractsSummary(hist([]), false, false).line).toBe("None on file yet");
    expect(contractsSummary(undefined, false, true).line).toBe("Couldn't load contracts");
  });
});

describe("documentsSummary", () => {
  const docs = (filed: number, onboarding: number, form: boolean): PersonDocumentsResponse => ({
    person: { id: 1, name: "X" }, canSetVisibility: false,
    documents: Array.from({ length: filed }, () => ({})) as PersonDocumentsResponse["documents"],
    onboarding: Array.from({ length: onboarding }, () => ({})) as PersonDocumentsResponse["onboarding"],
    onboardingForm: form ? ({} as PersonDocumentsResponse["onboardingForm"]) : null,
  });
  it("counts filed and onboarding documents together", () => {
    expect(documentsSummary(docs(3, 1, true), false, false).line).toBe("4 on file · onboarding form");
    expect(documentsSummary(docs(0, 0, true), false, false).line).toBe("Onboarding form only");
    expect(documentsSummary(docs(0, 0, false), false, false).line).toBe("None on file yet");
  });
});

describe("agreedSummary", () => {
  it("says how many things are open", () => {
    expect(agreedSummary(0).line).toBe("Nothing open");
    expect(agreedSummary(2)).toEqual({ line: "2 things agreed", tone: "warn" });
  });
});

describe("Reviews & records", () => {
  it("opens from a to-do's ?entry= link", () => {
    expect(sectionFromSearch("?entry=12")).toBe("record");
    expect(sectionFromSearch("?section=hours&entry=12")).toBe("hours");
  });
  it("shows the most serious open entry, else a live warning, else the count", () => {
    expect(recordEntriesSummary({ count: 3, badgeLabel: "Formal · Verbal warning · Attendance", formal: true, liveWarningUntil: null }, false, false))
      .toEqual({ line: "Formal · Verbal warning · Attendance", tone: "alert" });
    expect(recordEntriesSummary({ count: 3, badgeLabel: "In review · Timekeeping", formal: false, liveWarningUntil: null }, false, false).tone).toBe("warn");
    expect(recordEntriesSummary({ count: 3, badgeLabel: null, formal: false, liveWarningUntil: null }, false, false).line).toBe("3 entries");
    expect(recordEntriesSummary({ count: 0, badgeLabel: null, formal: false, liveWarningUntil: null }, false, false).line).toBe("Nothing on the record yet");
    expect(recordEntriesSummary(undefined, true, false).line).toBe("Loading the record…");
  });
});
