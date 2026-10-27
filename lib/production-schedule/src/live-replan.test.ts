import { describe, it, expect } from "vitest";
import { measurePace, replanLive, pendingBreaks, meatKey, type BuildTick } from "./live-replan";
import type { ScheduleRecipeInput, ScheduleOptions } from "./index";

// Two builders, 5 min/batch each → the line lands a batch every 2.5 min.
const recipes: ScheduleRecipeInput[] = [
  { planItemId: 1, recipeId: 101, name: "Carnizone", batches: 8, minutesPerBatch: 5, meats: [] },
  { planItemId: 2, recipeId: 102, name: "Godfather", batches: 8, minutesPerBatch: 5,
    meats: [{ rawMeatIngredientId: 22, rawMeatName: "Pork", processMinutes: 40, cookMinutes: 25, graceMinutes: 5 }] },
  { planItemId: 3, recipeId: 103, name: "Philly", batches: 8, minutesPerBatch: 5,
    meats: [{ rawMeatIngredientId: 154, rawMeatName: "Beef", processMinutes: 30, cookMinutes: 20, graceMinutes: 5 }] },
];
const options: ScheduleOptions = { startMinutes: 420, buildersCount: 2, changeoverSeconds: 0, breaks: [] };

/** n ticks on one item, one every `every` minutes from `from`. */
function ticks(planItemId: number, from: number, n: number, every: number): BuildTick[] {
  return Array.from({ length: n }, (_, i) => ({ planItemId, atMinutes: from + i * every }));
}
const mpb = new Map([[1, 5], [2, 5], [3, 5]]);

describe("measurePace", () => {
  it("no reading on too little data", () => {
    expect(measurePace(ticks(1, 420, 4, 2.5), mpb, 2)).toBeNull();
    expect(measurePace([], mpb, 2)).toBeNull();
  });
  it("on plan = 1", () => {
    expect(measurePace(ticks(1, 420, 10, 2.5), mpb, 2)!.factor).toBeCloseTo(1);
  });
  it("slower and faster", () => {
    expect(measurePace(ticks(1, 420, 10, 3), mpb, 2)!.factor).toBeCloseTo(1.2);
    expect(measurePace(ticks(1, 420, 10, 2), mpb, 2)!.factor).toBeCloseTo(0.8);
  });
  it("ignores breaks and changeovers", () => {
    const t = [...ticks(1, 420, 6, 2.5), ...ticks(1, 460, 6, 2.5), ...ticks(2, 476, 6, 2.5)];
    // 460 − 432.5 is a 27.5-min break; 476 − 472.5 is a recipe change.
    const p = measurePace(t, mpb, 2)!;
    expect(p.factor).toBeCloseTo(1);
    expect(p.gapsUsed).toBe(15);
  });
  it("is held inside safe bounds", () => {
    expect(measurePace(ticks(1, 420, 10, 10), mpb, 2)!.factor).toBe(1.8);
  });
});

describe("replanLive", () => {
  it("before the day starts, live = the morning plan", () => {
    const live = replanLive({ recipes, options, progress: [], ticks: [], nowMinutes: 400, pace: null, maxHoldMinutes: 210 });
    expect(live.started).toBe(false);
    const g = live.recipes[1];
    expect(g.plannedStartMinutes).toBe(440);
    expect(g.liveStartMinutes).toBe(440);
    expect(g.drift).toBe("on_time");
    expect(g.meats[0].liveCookStartMinutes).toBe(400);
  });

  it("a finished recipe drops out and the next starts now", () => {
    // 07:30 and Carnizone already done (planned to finish 07:40).
    const live = replanLive({
      recipes, options, nowMinutes: 450,
      progress: [{ planItemId: 1, built: 8, markedComplete: false }],
      ticks: ticks(1, 422, 8, 4),
      pace: null, maxHoldMinutes: 210,
    });
    const g = live.recipes[1];
    expect(live.recipes[0].state).toBe("done");
    expect(g.state).toBe("waiting");
    expect(g.liveStartMinutes).toBe(450);
    expect(g.plannedStartMinutes).toBe(440);
    // 07:30 against 07:20 planned: the line started late, so it's behind.
    expect(g.drift).toBe("behind");
  });

  it("re-times from batches left and the pace actually being built", () => {
    // 07:30: 4 of 8 Carnizone built, the line going at 1.2× planned time.
    const live = replanLive({
      recipes, options, nowMinutes: 450,
      progress: [{ planItemId: 1, built: 4, markedComplete: false }],
      ticks: ticks(1, 438, 4, 3),
      pace: { factor: 1.2, gapsUsed: 10, plannedMinutesPerBatch: 2.5, actualMinutesPerBatch: 3 },
      maxHoldMinutes: 210,
    });
    const c = live.recipes[0];
    expect(c.state).toBe("building");
    expect(c.remaining).toBe(4);
    // 4 left × 2.5 × 1.2 = 12 min → Godfather at 07:42 (was 07:20).
    expect(c.nextFlavour).toEqual({ planItemId: 2, name: "Godfather", atMinutes: 462, wasMinutes: 440 });
    const g = live.recipes[1];
    expect(g.liveStartMinutes).toBe(462);
    expect(g.drift).toBe("behind");
    expect(g.driftMinutes).toBe(22);
    expect(g.meats[0].liveCookStartMinutes).toBe(422);
    expect(g.meats[0].plannedCookStartMinutes).toBe(400);
  });

  it("faster than plan pulls times earlier", () => {
    const live = replanLive({
      recipes, options, nowMinutes: 430,
      progress: [{ planItemId: 1, built: 4, markedComplete: false }],
      ticks: ticks(1, 422, 4, 2),
      pace: { factor: 0.8, gapsUsed: 10, plannedMinutesPerBatch: 2.5, actualMinutesPerBatch: 2 },
      maxHoldMinutes: 210,
    });
    // 4 left × 2.5 × 0.8 = 8 → Godfather 07:18 (was 07:20).
    const g = live.recipes[1];
    expect(g.liveStartMinutes).toBe(438);
    expect(g.drift).toBe("on_time");
    const p = live.recipes[2];
    // Godfather 8 × 2 = 16 → Philly 07:34 (was 08:00 planned at 440+20=460)
    expect(p.liveStartMinutes).toBe(454);
    expect(p.drift).toBe("ahead");
  });

  it("flags a meat that should already be in the oven, unless a tray is in", () => {
    const base = {
      recipes, options, nowMinutes: 430,
      progress: [{ planItemId: 1, built: 7, markedComplete: false }],
      ticks: ticks(1, 412, 7, 2.5), pace: null, maxHoldMinutes: 210,
    };
    const late = replanLive(base);
    expect(late.recipes[1].meats[0].overdue).toBe(true);
    const inOven = replanLive({ ...base, meatsStarted: new Set([meatKey(102, 22)]) });
    expect(inOven.recipes[1].meats[0].overdue).toBe(false);
    expect(inOven.recipes[1].meats[0].started).toBe(true);
  });

  it("4-hour guard: a long build flags the hold and a second wave", () => {
    const long: ScheduleRecipeInput[] = [
      { planItemId: 9, recipeId: 109, name: "Pulled Pork", batches: 120, minutesPerBatch: 5,
        meats: [{ rawMeatIngredientId: 22, rawMeatName: "Pork", processMinutes: 200, cookMinutes: 180, graceMinutes: 10 }] },
    ];
    const live = replanLive({ recipes: long, options, progress: [], ticks: [], nowMinutes: 300, pace: null, maxHoldMinutes: 210 });
    const m = live.recipes[0].meats[0];
    // Builds 07:00 → 12:00; meat out at 220 + 180 = 400 → held 320 min.
    expect(m.holdMinutes).toBe(320);
    expect(m.holdBreach).toBe(true);
    expect(m.secondWaveNotBeforeMinutes).toBe(720 - 210 - 180);
    const ok = replanLive({ recipes, options, progress: [], ticks: [], nowMinutes: 300, pace: null, maxHoldMinutes: 210 });
    expect(ok.recipes[1].meats[0].holdBreach).toBe(false);
  });

  it("marked-complete items drop out even if short", () => {
    const live = replanLive({
      recipes, options, nowMinutes: 445,
      progress: [{ planItemId: 1, built: 5, markedComplete: true }],
      ticks: ticks(1, 422, 5, 2.5), pace: null, maxHoldMinutes: 210,
    });
    expect(live.recipes[0].state).toBe("done");
    expect(live.recipes[1].liveStartMinutes).toBe(445);
  });
});

describe("replanLive — the order actually built, and hot vs cold", () => {
  it("builders jump ahead to Philly (pork not cooked): Philly is in hand, Godfather waits after it", () => {
    const live = replanLive({
      recipes, options, nowMinutes: 450,
      progress: [{ planItemId: 1, built: 8, markedComplete: false }, { planItemId: 3, built: 2, markedComplete: false }],
      ticks: [...ticks(1, 422, 8, 2.5), ...ticks(3, 445, 2, 2.5)],
      pace: null, maxHoldMinutes: 210,
    });
    expect(live.recipes.map(r => [r.name, r.state])).toEqual([["Carnizone", "done"], ["Philly", "building"], ["Godfather", "waiting"]]);
    const philly = live.recipes[1];
    // 6 left x 2.5 = 15 min -> Godfather needed at 07:45.
    expect(philly.nextFlavour).toMatchObject({ name: "Godfather", atMinutes: 465 });
    expect(live.recipes[2].liveStartMinutes).toBe(465);
  });
  it("a recipe started then paused goes back in the queue", () => {
    const live = replanLive({
      recipes, options, nowMinutes: 450,
      progress: [{ planItemId: 1, built: 3, markedComplete: false }, { planItemId: 2, built: 2, markedComplete: false }],
      ticks: [...ticks(1, 422, 3, 2.5), ...ticks(2, 445, 2, 2.5)],
      pace: null, maxHoldMinutes: 210,
    });
    expect(live.recipes.map(r => [r.name, r.state])).toEqual([["Godfather", "building"], ["Carnizone", "waiting"], ["Philly", "waiting"]]);
  });
  it("recipes with a prep-oven meat are hot; the rest are cold mixes with a mix-by time", () => {
    const live = replanLive({ recipes, options, progress: [], ticks: [], nowMinutes: 400, pace: null, maxHoldMinutes: 210, mixReadyBeforeMinutes: 10 });
    expect(live.recipes.map(r => r.kind)).toEqual(["cold", "hot", "hot"]);
    expect(live.recipes[0].mixByMinutes).toBe(410);
    expect(live.recipes[1].mixByMinutes).toBe(430);
  });
});

describe("pendingBreaks", () => {
  const morning = { id: "morning", label: "Morning break", minutes: 15, anchorMinutes: 555 };
  it("a break already taken is not ahead any more", () => {
    const t = [...ticks(1, 520, 10, 2.5), ...ticks(1, 570, 4, 2.5)];
    expect(pendingBreaks([morning], t, 590).pending).toEqual([]);
  });
  it("a break being taken holds the clock to its end", () => {
    const t = ticks(1, 520, 15, 2.5); // last tick 555
    const r = pendingBreaks([morning], t, 567);
    expect(r.pending).toEqual([]);
    expect(r.resumeAtMinutes).toBe(570);
  });
  it("an overdue break not yet taken comes next", () => {
    const t = ticks(1, 540, 10, 2.5); // still building at 562.5
    const r = pendingBreaks([morning], t, 563);
    expect(r.pending[0].anchorMinutes).toBe(564);
  });
  it("a future break stays where it is", () => {
    expect(pendingBreaks([morning], ticks(1, 420, 5, 2.5), 440).pending[0].anchorMinutes).toBe(555);
  });
});
