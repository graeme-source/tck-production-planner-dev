import { describe, expect, it } from "vitest";
import { addDays, defaultSwitchOn, dueChangeovers, longDay, nextScheduled, scheduleProblem, zapietTodos } from "./club-special-rules";

describe("club special dates", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -7)).toBe("2026-09-24");
  });
  it("names the day the way the website does", () => {
    expect(longDay("2026-09-22")).toBe("Tuesday 22 September");
  });
  it("switches a billing offset before delivery, never in the past", () => {
    expect(defaultSwitchOn("2026-10-20", 7, "2026-10-05")).toBe("2026-10-13");
    expect(defaultSwitchOn("2026-10-08", 7, "2026-10-05")).toBe("2026-10-05");
  });
});

describe("scheduleProblem", () => {
  const base = { deliveringFrom: "2026-10-20", switchOn: "2026-10-13", today: "2026-10-05", liveDeliveringFrom: ["2026-09-22"] };
  it("accepts a sensible changeover", () => {
    expect(scheduleProblem(base)).toBeNull();
  });
  it("rejects a delivery date that isn't in the future", () => {
    expect(scheduleProblem({ ...base, deliveringFrom: "2026-10-05", switchOn: "2026-10-05" })).toMatch(/after today/);
  });
  it("rejects switching after the first delivery", () => {
    expect(scheduleProblem({ ...base, switchOn: "2026-10-21" })).toMatch(/on or before/);
  });
  it("rejects a switch day in the past", () => {
    expect(scheduleProblem({ ...base, switchOn: "2026-10-04" })).toMatch(/past/);
  });
  it("rejects two changeovers for the same delivery date", () => {
    expect(scheduleProblem({ ...base, liveDeliveringFrom: ["2026-10-20"] })).toMatch(/already/);
  });
});

describe("dueChangeovers / nextScheduled", () => {
  const rows = [
    { id: 1, status: "switched", switchOn: "2026-09-15", deliveringFrom: "2026-09-22" },
    { id: 2, status: "scheduled", switchOn: "2026-10-13", deliveringFrom: "2026-10-20" },
    { id: 3, status: "scheduled", switchOn: "2026-10-06", deliveringFrom: "2026-10-13" },
    { id: 4, status: "cancelled", switchOn: "2026-10-01", deliveringFrom: "2026-10-08" },
  ];
  it("only scheduled rows whose day has come, oldest first", () => {
    expect(dueChangeovers(rows, "2026-10-05").map(r => r.id)).toEqual([]);
    expect(dueChangeovers(rows, "2026-10-06").map(r => r.id)).toEqual([3]);
    expect(dueChangeovers(rows, "2026-10-20").map(r => r.id)).toEqual([3, 2]);
  });
  it("next is the earliest still-scheduled changeover", () => {
    expect(nextScheduled(rows)?.id).toBe(3);
    expect(nextScheduled([rows[0]])).toBeNull();
  });
});

describe("zapietTodos", () => {
  it("ends the old dates now and opens the new ones on the switch day", () => {
    const [end, start] = zapietTodos({ recipeName: "The Don", deliveringFrom: "2026-10-20", switchOn: "2026-10-13", today: "2026-10-05", clubPricePence: 1795 });
    expect(end.dueDate).toBe("2026-10-05");
    expect(end.title).toContain("Monday 19 October");
    expect(start.dueDate).toBe("2026-10-13");
    expect(start.title).toContain("Tuesday 20 October");
    expect(start.notes).toContain("£17.95");
  });
});
