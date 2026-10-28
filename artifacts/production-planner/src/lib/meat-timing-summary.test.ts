import { describe, expect, it } from "vitest";
import { meatTimingSummary, type MeatTimingInput } from "./meat-timing-summary";

const spread = { estimate: 5, median: 7, slow: 31, min: 0, max: 32 };

const base = (over: Partial<MeatTimingInput> = {}): MeatTimingInput => ({
  cookMinutes: 24,
  processMinutes: 5,
  bufferMinutes: 22,
  configuredLeadMinutes: 51,
  autoLearn: true,
  learning: { status: "learned", runsUsed: 18, processing: spread, proposed: { processMinutes: 5, bufferMinutes: 22 }, changes: [] },
  review: null,
  ...over,
});

describe("meat timing in plain English", () => {
  it("says when it goes in, what really happened, and that nothing needs changing", () => {
    const s = meatTimingSummary(base(), true);
    expect(s.now).toBe("Goes in the oven 51 min before the builders need it.");
    expect(s.happened[0]).toBe("Over the last 18 days, the first tin was mixed about 7 min after the meat came out of the oven (31 min on a slow day).");
    expect(s.proposal).toEqual({ kind: "none", headline: "No change needed — the time is about right." });
    expect(s.breakdown).toMatch(/^24 min cooking, then 5 min to cool, pull, dice and mix, plus 22 min spare/);
  });

  it("a proposed change is one new put-in time, how much earlier or later, and why", () => {
    const s = meatTimingSummary(base({
      learning: {
        status: "learned", runsUsed: 18, processing: spread, proposed: { processMinutes: 5, bufferMinutes: 12 },
        changes: [{ field: "buffer", from: 22, to: 12, reason: "" }],
      },
    }), true);
    expect(s.proposal).toEqual({
      kind: "change",
      headline: "Put it in 41 min before the builders need it — 10 min later than now.",
      why: "Why: the meat has been sitting ready longer than it needs to.",
      when: "Changes automatically after today's production. It moves in small steps, so it may move again.",
    });
  });

  it("earlier when the mix takes longer; says it won't apply when learning is off", () => {
    const longer: MeatTimingInput["learning"] = {
      status: "learned", runsUsed: 18, processing: spread, proposed: { processMinutes: 12, bufferMinutes: 22 },
      changes: [{ field: "process", from: 5, to: 12, reason: "" }],
    };
    const s = meatTimingSummary(base({ autoLearn: false, learning: longer }), true);
    expect(s.proposal).toEqual({
      kind: "change",
      headline: "Put it in 58 min before the builders need it — 7 min earlier than now.",
      why: "Why: the mix has been taking longer after the oven than we allow.",
      when: "Not applied — automatic learning is off for this meat.",
    });
    expect(meatTimingSummary(base({ learning: longer }), false).proposal)
      .toMatchObject({ when: "Not applied — daily automatic learning is switched off." });
  });

  it("not enough days yet: says how many more, and nothing about what happened", () => {
    const s = meatTimingSummary(base({ learning: { status: "not_enough_data", runsUsed: 2, processing: null, proposed: null, changes: [] } }), true);
    expect(s.happened).toEqual([]);
    expect(s.proposal).toEqual({ kind: "waiting", headline: "No suggestion yet — needs 1 more recorded day of it coming out of the oven and being mixed." });
  });

  it("the daily checks read as days right, days waited, days too early", () => {
    const s = meatTimingSummary(base({ review: { reviewed: 10, perfect: 6, waited: 1, tooEarly: 3, avgSat: 14, avgWait: 6 } }), true);
    expect(s.happened[1]).toBe("Checked 10 days: right on 6 days, the builders waited on 1 day (about 6 min), ready too early on 3 days. On average the meat sat ready for 14 min before it was needed.");
  });

  it("no cook time: never guessed", () => {
    const s = meatTimingSummary(base({ cookMinutes: null, configuredLeadMinutes: null, learning: { status: "no_cook_time", runsUsed: 0, processing: null, proposed: null, changes: [] } }), true);
    expect(s.now).toBeNull();
    expect(s.proposal.kind).toBe("no_cook_time");
  });
});
