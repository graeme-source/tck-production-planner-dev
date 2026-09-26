import { describe, expect, it } from "vitest";
import { addDays, calendarWeeks, daysBetween, mondayOf } from "./order-date-calendar";

describe("order date calendar", () => {
  it("counts days across a month end", () => {
    // 30 days in September: Tue 29 Sep → Fri 2 Oct is 3 days.
    expect(daysBetween("2026-09-29", "2026-10-02")).toBe(3);
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("finds the Monday of the week", () => {
    expect(mondayOf("2026-09-26")).toBe("2026-09-21"); // Sat
    expect(mondayOf("2026-09-27")).toBe("2026-09-21"); // Sun
    expect(mondayOf("2026-09-28")).toBe("2026-09-28"); // Mon
  });

  it("lays today → delivery out as whole Mon–Sun weeks", () => {
    const weeks = calendarWeeks("2026-09-26", "2026-10-02");
    expect(weeks).toHaveLength(2);
    expect(weeks[0][0]).toBe("2026-09-21");
    expect(weeks[1][0]).toBe("2026-09-28");
    expect(weeks[1][6]).toBe("2026-10-04");
    expect(weeks.every(w => w.length === 7)).toBe(true);
  });

  it("gives a single week when both dates share one, whatever the order", () => {
    expect(calendarWeeks("2026-10-02", "2026-09-29")).toHaveLength(1);
  });
});
