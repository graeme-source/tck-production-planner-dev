import { describe, it, expect } from "vitest";
import { sectionTabStatus, stockCheckTabStatus } from "./prep-tab-status";
import { hhmmToSeconds, stockCheckAlarmState } from "../pages/station/shared/stock-check-alarm";

const window = { warnFrom: "14:45", deadline: "15:00" };

describe("sectionTabStatus", () => {
  it("shows tasks done of total with a bar", () => {
    expect(sectionTabStatus({ done: 12, total: 18 })).toEqual({ line: "12 of 18 done", pct: 67, complete: false });
  });
  it("ticks a finished section", () => {
    expect(sectionTabStatus({ done: 18, total: 18 })).toEqual({ line: "18 of 18 done ✓", pct: 100, complete: true });
  });
  it("never reads more done than there is", () => {
    expect(sectionTabStatus({ done: 20, total: 18 }).line).toBe("18 of 18 done ✓");
  });
  it("says so when a section has nothing to prep", () => {
    expect(sectionTabStatus({ done: 0, total: 0 })).toEqual({ line: "Nothing to prep", pct: null, complete: true });
  });
  it("shows a placeholder, not a false 0, while loading", () => {
    expect(sectionTabStatus(undefined)).toEqual({ line: "…", pct: null, complete: false });
  });
});

describe("stockCheckTabStatus", () => {
  const at = (hhmm: string, dueCount: number, outstandingCount: number, prepDay = true) => {
    const secondsOfDay = hhmmToSeconds(hhmm);
    const state = stockCheckAlarmState({ dueCount, outstandingCount, prepDay, secondsOfDay, window });
    return stockCheckTabStatus({ state, dueCount, outstandingCount, secondsOfDay, window });
  };

  it("all recorded → green tick", () => {
    expect(at("10:00", 16, 0)).toEqual({ tone: "done", line: "16 of 16 ✓", pct: 100, complete: true });
  });
  it("outstanding before the warning time → amber count", () => {
    expect(at("10:00", 16, 3)).toEqual({ tone: "pending", line: "3 to record", pct: 81, complete: false });
  });
  it("outstanding but not a prep day stays amber even after the deadline", () => {
    expect(at("16:00", 16, 3, false).tone).toBe("pending");
  });
  it("from the warning time → flashing red with minutes left", () => {
    expect(at("14:48", 16, 2)).toMatchObject({ tone: "warning", line: "2 to record · 12 min left" });
  });
  it("after the deadline → overdue red", () => {
    expect(at("15:05", 16, 2)).toMatchObject({ tone: "overdue", line: "Overdue · 2 to record" });
  });
  it("nothing due today → neutral", () => {
    expect(at("10:00", 0, 0)).toEqual({ tone: "neutral", line: "None due today", pct: null, complete: true });
  });
  it("loading → placeholder", () => {
    expect(stockCheckTabStatus(null).line).toBe("…");
  });
});
