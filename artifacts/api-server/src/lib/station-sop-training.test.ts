import { describe, it, expect } from "vitest";
import {
  reviewStatus,
  gateDecision,
  deadlineFor,
  endOfLondonDay,
  rosteredStations,
  SKIP_WINDOW_MS,
  type GateInput,
} from "./station-sop-training";

const NOW = new Date("2026-09-24T10:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const base = (over: Partial<GateInput> = {}): GateInput => ({
  outstanding: [],
  now: NOW,
  enforce: true,
  rostered: true,
  pass: null,
  ...over,
});

describe("reviewStatus", () => {
  it("never reviewed → untrained", () => {
    expect(reviewStatus(null, 3)).toBe("untrained");
    expect(reviewStatus(undefined, 1)).toBe("untrained");
  });
  it("reviewed an older version → refresher", () => {
    expect(reviewStatus(2, 3)).toBe("refresher");
  });
  it("reviewed the current version → trained", () => {
    expect(reviewStatus(3, 3)).toBe("trained");
  });
});

describe("gateDecision", () => {
  it("nothing outstanding → no gate, nothing to skip", () => {
    const d = gateDecision(base());
    expect(d.show).toBe(false);
    expect(d.canSkip).toBe(false);
  });

  it("first time asked → gate shows, skippable for 24 hours from the first prompt", () => {
    const d = gateDecision(base({ outstanding: [{ sopId: 1, firstPromptedAt: hoursAgo(0) }] }));
    expect(d.show).toBe(true);
    expect(d.canSkip).toBe(true);
    expect(d.required).toEqual([]);
    expect(d.skipUntil?.getTime()).toBe(NOW.getTime() + SKIP_WINDOW_MS);
  });

  it("after 24 hours the SOP is required and the skip is gone", () => {
    const d = gateDecision(base({ outstanding: [{ sopId: 1, firstPromptedAt: hoursAgo(24) }] }));
    expect(d.required).toEqual([1]);
    expect(d.canSkip).toBe(false);
    expect(d.show).toBe(true);
  });

  it("one expired SOP blocks skipping the fresh ones too", () => {
    const d = gateDecision(base({ outstanding: [
      { sopId: 1, firstPromptedAt: hoursAgo(30) },
      { sopId: 2, firstPromptedAt: hoursAgo(1) },
    ] }));
    expect(d.required).toEqual([1]);
    expect(d.deferrable).toEqual([2]);
    expect(d.canSkip).toBe(false);
  });

  it("skip expires at the EARLIEST deadline", () => {
    const d = gateDecision(base({ outstanding: [
      { sopId: 1, firstPromptedAt: hoursAgo(20) },
      { sopId: 2, firstPromptedAt: hoursAgo(2) },
    ] }));
    expect(d.skipUntil?.getTime()).toBe(deadlineFor(hoursAgo(20)).getTime());
  });

  it("a live skip covering every outstanding SOP holds the gate off", () => {
    const d = gateDecision(base({
      outstanding: [{ sopId: 1, firstPromptedAt: hoursAgo(2) }],
      pass: { kind: "skipped", validUntil: deadlineFor(hoursAgo(2)), sopIds: [1] },
    }));
    expect(d.show).toBe(false);
  });

  it("a newly attached SOP brings the gate back despite an earlier skip", () => {
    const d = gateDecision(base({
      outstanding: [{ sopId: 1, firstPromptedAt: hoursAgo(2) }, { sopId: 9, firstPromptedAt: NOW }],
      pass: { kind: "skipped", validUntil: deadlineFor(hoursAgo(2)), sopIds: [1] },
    }));
    expect(d.show).toBe(true);
  });

  it("an expired skip no longer covers", () => {
    const d = gateDecision(base({
      outstanding: [{ sopId: 1, firstPromptedAt: hoursAgo(25) }],
      pass: { kind: "skipped", validUntil: hoursAgo(1), sopIds: [1] },
    }));
    expect(d.show).toBe(true);
  });

  it("rostered on the station → no 'just checking' option", () => {
    const d = gateDecision(base({ rostered: true, outstanding: [{ sopId: 1, firstPromptedAt: NOW }] }));
    expect(d.canJustLook).toBe(false);
  });

  it("not rostered → may say they're just checking, even after the window closes", () => {
    const d = gateDecision(base({ rostered: false, outstanding: [{ sopId: 1, firstPromptedAt: hoursAgo(48) }] }));
    expect(d.canJustLook).toBe(true);
    expect(d.canSkip).toBe(false);
  });

  it("a 'just checking' pass covers the day — until they're rostered onto the station", () => {
    const pass = { kind: "just_looking" as const, validUntil: new Date(NOW.getTime() + 3600_000), sopIds: [1] };
    const outstanding = [{ sopId: 1, firstPromptedAt: hoursAgo(48) }];
    expect(gateDecision(base({ rostered: false, outstanding, pass })).show).toBe(false);
    expect(gateDecision(base({ rostered: true, outstanding, pass })).show).toBe(true);
  });

  it("enforcement off → never blocks, but still reports what's outstanding", () => {
    const d = gateDecision(base({ enforce: false, outstanding: [{ sopId: 1, firstPromptedAt: hoursAgo(48) }] }));
    expect(d.show).toBe(false);
    expect(d.required).toEqual([1]);
  });
});

describe("endOfLondonDay", () => {
  it("BST: 10:00Z is 11:00 London → ends at 23:00Z", () => {
    expect(endOfLondonDay(new Date("2026-09-24T10:00:00Z")).toISOString()).toBe("2026-09-24T23:00:00.000Z");
  });
  it("GMT: 10:00Z in December ends at midnight Z", () => {
    expect(endOfLondonDay(new Date("2026-12-10T10:00:00Z")).toISOString()).toBe("2026-12-11T00:00:00.000Z");
  });
  it("just after London midnight (23:30Z in BST) rolls to the next day's end", () => {
    expect(endOfLondonDay(new Date("2026-09-24T23:30:00Z")).toISOString()).toBe("2026-09-25T23:00:00.000Z");
  });
});

describe("rosteredStations", () => {
  const mapping = { stations: [
    { title: "Dough Sheeting", positions: ["Dough"] },
    { title: "Mixing", positions: ["Mixing Prep"] },
    { title: "Building Table 1", positions: ["Builder 1"] },
    { title: "Prep", positions: ["OG Prep"] },
    { title: "Something New", positions: ["Odd Job"], stationKeys: ["packing"] },
  ] };

  it("maps positions through station titles to planner keys (case/space-insensitive)", () => {
    expect([...rosteredStations(["mixing  prep"], mapping)]).toEqual(["mixing"]);
    expect([...rosteredStations(["Dough"], mapping)]).toEqual(["dough_sheeting"]);
    expect([...rosteredStations(["Builder 1"], mapping)]).toEqual(["building_1"]);
  });
  it("Prep covers the prep sub-stations", () => {
    expect(rosteredStations(["OG Prep"], mapping).has("prep_meat")).toBe(true);
  });
  it("explicit stationKeys on a mapping entry win", () => {
    expect([...rosteredStations(["Odd Job"], mapping)]).toEqual(["packing"]);
  });
  it("unmapped positions put you on no station", () => {
    expect(rosteredStations(["Office"], mapping).size).toBe(0);
  });
});
