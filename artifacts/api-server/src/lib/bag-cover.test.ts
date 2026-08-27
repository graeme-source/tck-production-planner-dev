import { describe, it, expect } from "vitest";
import { computeBagCover, dispatchDayFor, nextDispatchDays, type BagCoverInput } from "./bag-cover";

const TODAY = "2026-09-01"; // a Tuesday

function demand(over: Partial<BagCoverInput["demand"][number]> = {}) {
  return {
    dispatchDate: "2026-09-02",
    deliveryDate: "2026-09-03",
    recipeId: 1,
    recipeName: "Balsamic",
    bags: 4,
    orderName: "#1001",
    ...over,
  };
}

function run(over: Partial<BagCoverInput>) {
  return computeBagCover({
    today: TODAY,
    dispatchDates: ["2026-09-02"],
    demand: [],
    supply: [],
    wrappedToday: {},
    ...over,
  });
}

describe("dispatchDayFor", () => {
  it("is the calendar day before delivery", () => {
    expect(dispatchDayFor("2026-09-03")).toBe("2026-09-02");
    // Across a month boundary.
    expect(dispatchDayFor("2026-10-01")).toBe("2026-09-30");
  });
});

describe("nextDispatchDays", () => {
  // Deliveries are Tue–Sat, despatch the day before, so despatch days are
  // Mon–Fri and the weekend is a two-day gap.
  it("gives the next three despatch days from a Tuesday", () => {
    // Tue 1 Sep 2026 → deliveries Wed 2, Thu 3, Fri 4, despatched Tue 1 (today
    // — that van may not have gone yet), Wed 2 and Thu 3.
    expect(nextDispatchDays("2026-09-01", 3)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("steps over the weekend", () => {
    // Thu 3 Sep → deliveries Fri 4, Sat 5, then Tue 8 (nothing delivers Sun or
    // Mon), so the vans leave Thu 3, Fri 4 and Mon 7.
    expect(nextDispatchDays("2026-09-03", 3)).toEqual(["2026-09-03", "2026-09-04", "2026-09-07"]);
  });

  it("never looks backwards", () => {
    for (const d of nextDispatchDays("2026-09-05", 3)) expect(d >= "2026-09-05").toBe(true);
  });

  it("returns as many as asked for", () => {
    expect(nextDispatchDays("2026-09-01", 5)).toHaveLength(5);
    expect(nextDispatchDays("2026-09-01", 1)).toEqual(["2026-09-01"]);
  });
});

describe("computeBagCover", () => {
  it("is happy when a plan before the van leaves covers the order", () => {
    const r = run({
      demand: [demand({ bags: 4 })],
      supply: [{ productionDate: "2026-09-02", recipeId: 1, bags: 4, queued: false }],
    });
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toMatchObject({ needed: 4, covered: 4, shortfall: 0 });
  });

  // The reason this check exists at all.
  it("does NOT count production scheduled after the despatch", () => {
    const r = run({
      demand: [demand({ dispatchDate: "2026-09-02", deliveryDate: "2026-09-03", bags: 4 })],
      // Made the day AFTER the van would have to leave — useless to this order.
      supply: [{ productionDate: "2026-09-03", recipeId: 1, bags: 10, queued: false }],
    });
    expect(r.ok).toBe(false);
    expect(r.shortfalls[0]).toMatchObject({ needed: 4, covered: 0, shortfall: 4 });
  });

  it("counts production ON the despatch day — that's the tightest turnaround we run", () => {
    const r = run({
      demand: [demand({ dispatchDate: "2026-09-02", bags: 4 })],
      supply: [{ productionDate: "2026-09-02", recipeId: 1, bags: 4, queued: false }],
    });
    expect(r.ok).toBe(true);
  });

  it("counts bags wrapped today as fridge stock", () => {
    const r = run({ demand: [demand({ bags: 3 })], wrappedToday: { 1: 3 } });
    expect(r.ok).toBe(true);
    expect(r.lines[0].sources).toEqual([{ date: TODAY, bags: 3, queued: false, label: "today" }]);
  });

  // Wrapping writes the bag count; the plan carries the allocation. They are
  // the same bags — adding them would invent cover that doesn't exist.
  it("does not double-count today's wrapped bags against today's plan", () => {
    const r = run({
      demand: [demand({ bags: 8 })],
      supply: [{ productionDate: TODAY, recipeId: 1, bags: 5, queued: false }],
      wrappedToday: { 1: 5 },
    });
    expect(r.shortfalls[0]).toMatchObject({ needed: 8, covered: 5, shortfall: 3 });
  });

  it("lets an over-wrap win, because the bags are physically there", () => {
    const r = run({
      demand: [demand({ bags: 7 })],
      supply: [{ productionDate: TODAY, recipeId: 1, bags: 5, queued: false }],
      wrappedToday: { 1: 7 },
    });
    expect(r.ok).toBe(true);
  });

  // Nothing decrements an 8-pack fridge reading, so an older one is a
  // high-water mark, not a stock level. It must never be silent cover.
  it("won't count production from before today, but says it exists", () => {
    const r = run({
      demand: [demand({ bags: 4 })],
      supply: [{ productionDate: "2026-08-31", recipeId: 1, bags: 4, queued: false }],
    });
    expect(r.ok).toBe(false);
    expect(r.shortfalls[0]).toMatchObject({ shortfall: 4, earlierProduction: 4 });
  });

  it("draws supply down across despatches — a bag can only leave once", () => {
    const r = run({
      dispatchDates: ["2026-09-02", "2026-09-03"],
      demand: [
        demand({ dispatchDate: "2026-09-02", deliveryDate: "2026-09-03", bags: 4 }),
        demand({ dispatchDate: "2026-09-03", deliveryDate: "2026-09-04", bags: 4, orderName: "#1002" }),
      ],
      supply: [{ productionDate: "2026-09-02", recipeId: 1, bags: 6, queued: false }],
    });
    // First van takes 4 of the 6; the second is 2 short.
    expect(r.lines[0]).toMatchObject({ dispatchDate: "2026-09-02", covered: 4, shortfall: 0 });
    expect(r.lines[1]).toMatchObject({ dispatchDate: "2026-09-03", covered: 2, shortfall: 2 });
  });

  it("adds up several orders wanting the same product on the same van", () => {
    const r = run({
      demand: [
        demand({ bags: 3, orderName: "#1001" }),
        demand({ bags: 3, orderName: "#1002" }),
      ],
      supply: [{ productionDate: "2026-09-02", recipeId: 1, bags: 5, queued: false }],
    });
    expect(r.shortfalls[0]).toMatchObject({ needed: 6, covered: 5, shortfall: 1 });
  });

  it("keeps recipes separate — spare Balsamic doesn't cover Mac", () => {
    const r = run({
      demand: [demand({ recipeId: 2, recipeName: "Mac", bags: 4 })],
      supply: [{ productionDate: "2026-09-02", recipeId: 1, bags: 40, queued: false }],
    });
    expect(r.ok).toBe(false);
    expect(r.shortfalls[0].recipeName).toBe("Mac");
  });

  // Queued bags DO count — that's the mechanism working — but the planner has
  // to know the cover rests on a plan nobody has made yet.
  it("counts queued bags but flags that they depend on an unmade plan", () => {
    const r = run({
      demand: [demand({ bags: 4 })],
      supply: [{ productionDate: "2026-09-02", recipeId: 1, bags: 4, queued: true }],
    });
    expect(r.ok).toBe(true);
    expect(r.atRiskLines).toHaveLength(1);
    expect(r.atRiskLines[0]).toMatchObject({ covered: 4, atRisk: 4 });
  });

  it("prefers real planned bags over queued ones when both could cover", () => {
    const r = run({
      demand: [demand({ bags: 4 })],
      supply: [
        { productionDate: "2026-09-02", recipeId: 1, bags: 4, queued: true },
        { productionDate: TODAY, recipeId: 1, bags: 4, queued: false },
      ],
    });
    // Earliest first, so today's real bags go out first and nothing is at risk.
    expect(r.ok).toBe(true);
    expect(r.atRiskLines).toHaveLength(0);
  });

  it("says nothing at all when there are no bag orders", () => {
    const r = run({ supply: [{ productionDate: TODAY, recipeId: 1, bags: 9, queued: false }] });
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(0);
  });

  it("shows its workings so a planner can check the sum", () => {
    const r = run({
      demand: [demand({ bags: 6 })],
      supply: [
        { productionDate: TODAY, recipeId: 1, bags: 2, queued: false },
        { productionDate: "2026-09-02", recipeId: 1, bags: 4, queued: false },
      ],
    });
    expect(r.lines[0].sources).toEqual([
      { date: TODAY, bags: 2, queued: false, label: "today" },
      { date: "2026-09-02", bags: 4, queued: false, label: "planned" },
    ]);
  });
});
