import { describe, expect, it } from "vitest";
import { daysBefore, lastSent, monthToDateRange, sharePercent } from "./email-revenue-panel";

describe("sharePercent", () => {
  it("is email revenue over store sales, whole percent", () => {
    // Graeme's example: £50k of £120k ≈ 42%.
    expect(sharePercent(50_000, 120_000)).toBe(42);
    expect(sharePercent(14_710.59, 36_204)).toBe(41);
  });
  it("is null with no sales to compare against", () => {
    expect(sharePercent(100, 0)).toBeNull();
    expect(sharePercent(100, null)).toBeNull();
    expect(sharePercent(null, 100)).toBeNull();
  });
});

describe("dates", () => {
  it("runs from the 1st of the London month to today", () => {
    expect(monthToDateRange(new Date("2026-11-10T13:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    // 00:30 on 1 Jul in London is still 30 Jun in UTC.
    expect(monthToDateRange(new Date("2026-06-30T23:30:00Z"))).toEqual({ from: "2026-07-01", to: "2026-07-01" });
  });
  it("counts back across a month end", () => {
    expect(daysBefore("2026-11-10", 60)).toBe("2026-09-11");
  });
});

describe("lastSent", () => {
  const e = (status: string, sendAt: string | null) => ({ status, sendAt });
  it("keeps sent ones, newest first, five at most", () => {
    const emails = [
      e("Sent", "2026-11-04T10:00:00Z"), e("Draft", "2026-11-12T10:00:00Z"), e("Scheduled", "2026-11-11T10:00:00Z"),
      e("Sent", "2026-11-10T09:00:00Z"), e("Sending", "2026-11-10T16:00:00Z"), e("Sent", "2026-11-06T10:00:00Z"),
      e("Sent", "2026-11-08T10:00:00Z"), e("Sent", "2026-11-05T10:00:00Z"), e("Sent", null),
    ];
    expect(lastSent(emails).map((x) => x.sendAt)).toEqual([
      "2026-11-10T16:00:00Z", "2026-11-10T09:00:00Z", "2026-11-08T10:00:00Z", "2026-11-06T10:00:00Z", "2026-11-05T10:00:00Z",
    ]);
  });
});
