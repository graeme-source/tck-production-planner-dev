import { describe, it, expect } from "vitest";
import { parseQuickTask, parseRecurrencePhrase, parseStartDate } from "./phrase";

const TODAY = "2026-10-15"; // a Thursday

describe("every N months phrases (2026-10-15)", () => {
  it("every 6 months starts this month when the day hasn't passed, else next", () => {
    expect(parseRecurrencePhrase("every 6 months", TODAY)?.rule).toEqual({ kind: "monthly", dayOfMonth: 15, interval: 6, anchor: "2026-10-01" });
    expect(parseRecurrencePhrase("every 3 months on the 1st", TODAY)?.rule).toEqual({ kind: "monthly", dayOfMonth: 1, interval: 3, anchor: "2026-11-01" });
    expect(parseRecurrencePhrase("every 4 months", TODAY)?.rule).toMatchObject({ interval: 4 });
    expect(parseRecurrencePhrase("every other month", TODAY)?.rule).toMatchObject({ interval: 2 });
  });
  it("quarterly, yearly, annually", () => {
    expect(parseRecurrencePhrase("quarterly", TODAY)?.rule).toMatchObject({ kind: "monthly", interval: 3 });
    expect(parseRecurrencePhrase("yearly", TODAY)?.rule).toMatchObject({ kind: "monthly", interval: 12 });
    expect(parseRecurrencePhrase("annually on the 20th", TODAY)?.rule).toEqual({ kind: "monthly", dayOfMonth: 20, interval: 12, anchor: "2026-10-01" });
  });
  it("bare weekly / fortnightly / monthly use today", () => {
    expect(parseRecurrencePhrase("weekly", TODAY)?.rule).toEqual({ kind: "weekly", days: [4] });
    expect(parseRecurrencePhrase("fortnightly", TODAY)?.rule).toEqual({ kind: "weekly", days: [4], interval: 2, anchor: TODAY });
    expect(parseRecurrencePhrase("monthly", TODAY)?.rule).toEqual({ kind: "monthly", dayOfMonth: 15 });
  });
});

describe("parseQuickTask — the Add a task box", () => {
  it("pulls out priority and repeat, leaving the title", () => {
    expect(parseQuickTask("Clean the extract fans every 6 months p2", TODAY)).toMatchObject({
      title: "Clean the extract fans", priority: 2, rule: { kind: "monthly", interval: 6, dayOfMonth: 15 },
    });
    expect(parseQuickTask("P1 Order milk every mon, thu at 9am", TODAY)).toMatchObject({
      title: "Order milk", priority: 1, rule: { kind: "weekly", days: [1, 4] }, time: "09:00",
    });
  });
  it("Graeme's example: 'Book grease trap clean with Ash every 3 months'", () => {
    expect(parseQuickTask("Book grease trap clean with Ash every 3 months", TODAY)).toMatchObject({
      title: "Book grease trap clean with Ash", priority: null, rule: { kind: "monthly", dayOfMonth: 15, interval: 3, anchor: "2026-10-01" },
    });
  });
  it("leaves ordinary words alone", () => {
    expect(parseQuickTask("Check every fridge seal", TODAY)).toEqual({ title: "Check every fridge seal", priority: null, rule: null, time: null });
    expect(parseQuickTask("Top up the P10 labels", TODAY).priority).toBeNull();
  });
});

describe("starting dates (2026-10-15)", () => {
  it("every 3 months starting next Monday: first one next Monday, then 3 months on", () => {
    const r = parseRecurrencePhrase("every 3 months starting next monday", TODAY)!.rule;
    expect(r).toEqual({ kind: "monthly", dayOfMonth: 19, interval: 3, anchor: "2026-10-01", from: "2026-10-19" });
  });
  it("understands dates in words", () => {
    expect(parseStartDate("tomorrow", TODAY)).toBe("2026-10-16");
    expect(parseStartDate("1 nov", TODAY)).toBe("2026-11-01");
    expect(parseStartDate("1st november", TODAY)).toBe("2026-11-01");
    expect(parseStartDate("monday", TODAY)).toBe("2026-10-19");
    expect(parseStartDate("10 oct", TODAY)).toBe("2027-10-10");
    expect(parseStartDate("not a date", TODAY)).toBeNull();
  });
  it("weekly and daily rules start on the day too", () => {
    expect(parseRecurrencePhrase("every fri from 23 oct", TODAY)!.rule).toEqual({ kind: "weekly", days: [5], from: "2026-10-23" });
    expect(parseRecurrencePhrase("every 2 weeks on mon starting 26 oct", TODAY)!.rule).toMatchObject({ interval: 2, anchor: "2026-10-26", from: "2026-10-26" });
  });
  it("the Add box reads it from the title", () => {
    expect(parseQuickTask("Book grease trap clean every 3 months starting next monday p2", TODAY)).toMatchObject({
      title: "Book grease trap clean", priority: 2, rule: { from: "2026-10-19", dayOfMonth: 19, interval: 3 },
    });
  });
});
