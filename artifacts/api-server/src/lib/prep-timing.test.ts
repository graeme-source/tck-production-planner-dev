import { describe, it, expect } from "vitest";
import {
  COMPLETED_WITHOUT_OPEN, CONFIDENT_SESSIONS, ENOUGH_SESSIONS, MAX_SESSION_MS, MIN_SESSION_MS, UNENDED_BREAK_MS,
  cleanSessions, confidenceFor, quantile, rateFrom, sessionAmount, shareOverlaps, spreadOf,
  subtractIntervals, summariseItem, withinFences,
  type CleanSession, type TimingSession,
} from "./prep-timing";

const MIN = 60_000;
const SEC = 1000;
const T0 = Date.UTC(2026, 9, 27, 7, 0, 0);

function session(over: Partial<TimingSession> & { id: number }): TimingSession {
  return {
    userId: 1,
    itemKey: "ingredient:1",
    openedAt: T0,
    completedAt: T0 + 10 * MIN,
    closedAt: null,
    pauses: [],
    amounts: [{ quantity: 1, unit: "kg" }],
    ...over,
  };
}

/** Opened, never completed. */
const look = (id: number, over: Partial<TimingSession> = {}) => session({ id, completedAt: null, amounts: [], ...over });

const noneExcluded = { quick_look: 0, not_completed: 0, quick_completion: 0, too_long: 0, completed_without_open: 0 };

const byId = (clean: CleanSession[]) => new Map(clean.map(c => [c.id, c]));

describe("subtractIntervals", () => {
  it("cuts a gap out of the middle, trims the ends, ignores cuts outside", () => {
    expect(subtractIntervals([0, 100], [[20, 30]])).toEqual([[0, 20], [30, 100]]);
    expect(subtractIntervals([0, 100], [[-10, 10], [90, 120]])).toEqual([[10, 90]]);
    expect(subtractIntervals([0, 100], [[200, 300]])).toEqual([[0, 100]]);
    expect(subtractIntervals([0, 100], [[0, 100]])).toEqual([]);
  });
});

describe("shareOverlaps", () => {
  it("splits overlapping time evenly and keeps the rest whole", () => {
    const out = shareOverlaps(new Map([[1, [[0, 20]] as [number, number][]], [2, [[10, 30]] as [number, number][]]]));
    expect(out.get(1)).toEqual({ ms: 15, shared: true });
    expect(out.get(2)).toEqual({ ms: 15, shared: true });
  });
  it("never adds up to more than the time the person actually spent", () => {
    const out = shareOverlaps(new Map<number, [number, number][]>([[1, [[0, 30]]], [2, [[0, 30]]], [3, [[15, 30]]]]));
    const total = [...out.values()].reduce((n, v) => n + v.ms, 0);
    expect(total).toBe(30);
    expect(out.get(3)!.ms).toBeCloseTo(5);
  });
  it("treats touching sessions as not overlapping", () => {
    const out = shareOverlaps(new Map<number, [number, number][]>([[1, [[0, 10]]], [2, [[10, 20]]]]));
    expect(out.get(1)).toEqual({ ms: 10, shared: false });
    expect(out.get(2)).toEqual({ ms: 10, shared: false });
  });
});

describe("cleanSessions", () => {
  it("times opening to the latest completion", () => {
    const { clean } = cleanSessions([session({ id: 1 })], []);
    expect(clean[0]!.minutes).toBeCloseTo(10);
    expect(clean[0]!.grams).toBe(1000);
  });

  it("ignores sessions that completed nothing", () => {
    const { clean, excluded } = cleanSessions([look(1), session({ id: 2, amounts: [] })], []);
    expect(clean).toHaveLength(0);
    expect(excluded.not_completed).toBe(2);
  });

  it("the cut-off is 30 seconds", () => {
    expect(MIN_SESSION_MS).toBe(30 * SEC);
  });

  it("ignores a quick look — opened and closed again inside 30 s without completing — entirely", () => {
    const { clean, excluded, quickCompletionsByItem } = cleanSessions([
      look(1, { closedAt: T0 + 20 * SEC }),
      look(2, { closedAt: T0 + 29 * SEC }),
    ], []);
    expect(clean).toHaveLength(0);
    expect(excluded).toEqual({ ...noneExcluded, quick_look: 2 });
    expect(quickCompletionsByItem.size).toBe(0);
  });

  it("an item opened for 30 s or more, or never closed, without completing is just not completed", () => {
    const { excluded } = cleanSessions([
      look(1, { closedAt: T0 + 30 * SEC }),
      look(2, { closedAt: T0 + 5 * MIN }),
      look(3, { closedAt: null }),
    ], []);
    expect(excluded).toEqual({ ...noneExcluded, not_completed: 3 });
  });

  it("a pause doesn't turn a long look into a quick one, or a quick one into a long one", () => {
    // Open 10 s, away 10 min, back 10 s, closed: 20 s of looking.
    const { excluded } = cleanSessions([
      look(1, { closedAt: T0 + 10 * MIN + 20 * SEC, pauses: [{ from: T0 + 10 * SEC, to: T0 + 10 * MIN + 10 * SEC }] }),
    ], []);
    expect(excluded.quick_look).toBe(1);
  });

  it("keeps a completion made inside 30 s out of every average and counts it per item", () => {
    const { clean, excluded, quickCompletionsByItem } = cleanSessions([
      session({ id: 1, itemKey: "sub_recipe:43", completedAt: T0 + 12 * SEC }),
      session({ id: 2, itemKey: "sub_recipe:43", completedAt: T0 + 29 * SEC }),
      session({ id: 3, itemKey: "ingredient:7", completedAt: T0 + 5 * SEC }),
      session({ id: 4, itemKey: "sub_recipe:43", completedAt: T0 + 30 * SEC }),
    ], []);
    expect(clean.map(c => c.id)).toEqual([4]); // exactly 30 s is timed
    expect(excluded).toEqual({ ...noneExcluded, quick_completion: 3 });
    expect(quickCompletionsByItem.get("sub_recipe:43")).toBe(2);
    expect(quickCompletionsByItem.get("ingredient:7")).toBe(1);
  });

  it("never times a completion made with nothing opened, and counts it per item", () => {
    const { clean, excluded, unopenedByItem } = cleanSessions([
      session({ id: 1, completedAt: T0, closedAt: T0, flag: COMPLETED_WITHOUT_OPEN }),
      session({ id: 2 }),
    ], []);
    expect(clean.map(c => c.id)).toEqual([2]);
    expect(excluded).toEqual({ ...noneExcluded, completed_without_open: 1 });
    expect(unopenedByItem.get("ingredient:1")).toBe(1);
  });

  it("ignores sessions over two hours (left open)", () => {
    const { clean, excluded } = cleanSessions([
      session({ id: 1, completedAt: T0 + MAX_SESSION_MS }),
      session({ id: 2, completedAt: T0 + MAX_SESSION_MS + 1 }),
    ], []);
    expect(clean.map(c => c.id)).toEqual([1]);
    expect(excluded).toEqual({ ...noneExcluded, too_long: 1 });
  });

  it("takes a pause (moved off the item and came back) out of the time", () => {
    const { clean } = cleanSessions([session({ id: 1, completedAt: T0 + 20 * MIN, pauses: [{ from: T0 + 5 * MIN, to: T0 + 8 * MIN }] })], []);
    expect(clean[0]!.minutes).toBeCloseTo(17);
    expect(clean[0]!.hadIdleGap).toBe(true);
  });

  it("takes the person's own breaks out, not other people's", () => {
    const breaks = [
      { userId: 1, from: T0 + 10 * MIN, to: T0 + 25 * MIN },
      { userId: 2, from: T0, to: T0 + 30 * MIN },
    ];
    const { clean } = cleanSessions([session({ id: 1, completedAt: T0 + 40 * MIN })], breaks);
    expect(clean[0]!.minutes).toBeCloseTo(25);
  });

  it("counts a break nobody ended as at most 45 minutes", () => {
    const breaks = [{ userId: 1, from: T0 + 10 * MIN, to: null }];
    const { clean } = cleanSessions([session({ id: 1, completedAt: T0 + 100 * MIN })], breaks);
    expect(clean[0]!.minutes).toBeCloseTo(100 - UNENDED_BREAK_MS / MIN);
  });

  it("splits a person's overlapping sessions rather than double-counting", () => {
    // Peppers 07:00–07:20 and onions 07:10–07:30 on two iPads: 30 minutes of
    // work, the shared ten minutes halved between them.
    const { clean } = cleanSessions([
      session({ id: 1, itemKey: "ingredient:1", completedAt: T0 + 20 * MIN }),
      session({ id: 2, itemKey: "ingredient:2", openedAt: T0 + 10 * MIN, completedAt: T0 + 30 * MIN }),
    ], []);
    const m = byId(clean);
    expect(m.get(1)!.minutes).toBeCloseTo(15);
    expect(m.get(2)!.minutes).toBeCloseTo(15);
    expect(m.get(1)!.shared).toBe(true);
    expect(m.get(1)!.activeMinutes).toBeCloseTo(20);
  });

  it("does not split between different people", () => {
    const { clean } = cleanSessions([
      session({ id: 1, userId: 1, completedAt: T0 + 20 * MIN }),
      session({ id: 2, userId: 2, completedAt: T0 + 20 * MIN }),
    ], []);
    expect(clean.map(c => c.minutes)).toEqual([20, 20]);
  });

  it("an excluded session (left open) doesn't take time from a real one", () => {
    const { clean } = cleanSessions([
      session({ id: 1, completedAt: T0 + 150 * MIN }),
      session({ id: 2, openedAt: T0 + 10 * MIN, completedAt: T0 + 20 * MIN }),
    ], []);
    expect(clean.map(c => [c.id, Math.round(c.minutes)])).toEqual([[2, 10]]);
  });
});

describe("sessionAmount", () => {
  it("adds weights in grams across units", () => {
    expect(sessionAmount([{ quantity: 1, unit: "kg" }, { quantity: 500, unit: "g" }, { quantity: 0.25, unit: "l" }]))
      .toEqual({ grams: 1750, count: null, countUnit: null });
  });
  it("adds counts in one unit", () => {
    expect(sessionAmount([{ quantity: 24, unit: "pieces" }, { quantity: 24, unit: "Pieces" }]))
      .toEqual({ grams: null, count: 48, countUnit: "pieces" });
  });
  it("is unknown when any amount is missing or the measures are mixed", () => {
    expect(sessionAmount([{ quantity: 1, unit: "kg" }, { quantity: null, unit: null }]).grams).toBeNull();
    expect(sessionAmount([{ quantity: 1, unit: "kg" }, { quantity: 3, unit: "pieces" }])).toEqual({ grams: null, count: null, countUnit: null });
  });
});

describe("spread and outliers", () => {
  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(spreadOf([10, 2, 6])).toEqual({ median: 6, q1: 4, q3: 8 });
  });
  it("drops a wild value once there are enough to judge, and none before", () => {
    expect(withinFences([5, 5.5, 6, 6.5, 60])).toEqual([true, true, true, true, false]);
    expect(withinFences([5, 6, 60])).toEqual([true, true, true]);
  });
  it("prices a kilo as total minutes ÷ total kilos, after trimming", () => {
    // 5 min for 1 kg, 20 min for 10 kg … and one session left running.
    const r = rateFrom([
      { minutes: 5, amount: 1 }, { minutes: 20, amount: 10 }, { minutes: 21, amount: 10 },
      { minutes: 19, amount: 10 }, { minutes: 110, amount: 1 },
    ]);
    expect(r.trimmed).toBe(1);
    expect(r.rate).toBeCloseTo((5 + 20 + 21 + 19) / 31);
  });
});

describe("confidenceFor", () => {
  const tight = { median: 10, q1: 8, q3: 12 };
  const wide = { median: 10, q1: 3, q3: 20 };
  it("needs more data below eight sessions", () => {
    expect(confidenceFor(ENOUGH_SESSIONS - 1, tight)).toBe("needs_more_data");
  });
  it("is settling with enough sessions, confident with many consistent ones", () => {
    expect(confidenceFor(ENOUGH_SESSIONS, tight)).toBe("settling");
    expect(confidenceFor(CONFIDENT_SESSIONS, tight)).toBe("confident");
    expect(confidenceFor(CONFIDENT_SESSIONS, wide)).toBe("settling");
  });
});

describe("summariseItem", () => {
  it("gives the median session, the per-kg rate, days and people", () => {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const clean: CleanSession[] = [4, 5, 6].map((m, i) => ({
      id: i + 1, userId: i % 2, itemKey: "ingredient:9", minutes: m, activeMinutes: m,
      grams: 2000, count: null, countUnit: null, completedAt: T0 + i * 24 * 60 * MIN, hadIdleGap: false, shared: false,
    }));
    const s = summariseItem("ingredient:9", clean, day, { quickCompletions: 2, unopenedCompletions: 1 })!;
    expect(s.sessions).toBe(3);
    expect(s.minutes!.median).toBe(5);
    expect(s.quickCompletions).toBe(2);
    expect(s.unopenedCompletions).toBe(1);
    expect(s.rate.minutesPerKg).toBeCloseTo(15 / 6);
    expect(s.days).toBe(3);
    expect(s.people).toBe(2);
    expect(s.confidence).toBe("needs_more_data");
  });
  it("uses a per-piece rate for counted items", () => {
    const clean: CleanSession[] = [{
      id: 1, userId: 1, itemKey: "ingredient:3", minutes: 12, activeMinutes: 12,
      grams: null, count: 48, countUnit: "pieces", completedAt: T0, hadIdleGap: false, shared: false,
    }];
    const s = summariseItem("ingredient:3", clean, () => "d")!;
    expect(s.rate.minutesPerKg).toBeNull();
    expect(s.rate.minutesPerCount).toBeCloseTo(0.25);
    expect(s.rate.countUnit).toBe("pieces");
  });
  it("still lists an item that has only quick completions — no minutes, but the count", () => {
    const s = summariseItem("sub_recipe:43", [], () => "d", { quickCompletions: 5 })!;
    expect(s).toMatchObject({ sessions: 0, minutes: null, quickCompletions: 5, unopenedCompletions: 0, confidence: "needs_more_data", lastAt: null });
    expect(s.rate.minutesPerKg).toBeNull();
  });
  it("is nothing at all when there's nothing to say", () => {
    expect(summariseItem("ingredient:1", [], () => "d")).toBeNull();
  });
});
