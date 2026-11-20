import { describe, it, expect } from "vitest";
import { draftFromTheirWords, keepKnownPath, keepKnownSops, trimLiveHistory, MAX_LIVE_TURNS, type LiveTurn } from "./report-live-chat-rules";

const turns = (n: number): LiveTurn[] => Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", text: `t${i}` }));

describe("trimLiveHistory", () => {
  it("keeps a short chat as it is", () => {
    expect(trimLiveHistory(turns(5))).toEqual(turns(5));
  });
  it("keeps the opening message and the latest turns, still alternating", () => {
    const out = trimLiveHistory(turns(40));
    expect(out.length).toBeLessThanOrEqual(MAX_LIVE_TURNS);
    expect(out[0].text).toBe("t0");
    expect(out[out.length - 1].text).toBe("t39");
    for (let i = 1; i < out.length; i++) expect(out[i].role).not.toBe(out[i - 1].role);
  });
});

describe("draftFromTheirWords", () => {
  it("uses only what the person said", () => {
    expect(draftFromTheirWords([{ role: "user", text: "Oven 2 won't heat" }, { role: "assistant", text: "Is it on?" }, { role: "user", text: " Yes " }]))
      .toBe("Oven 2 won't heat\n\nYes");
  });
});

describe("keepKnownSops / keepKnownPath", () => {
  it("only lets through SOPs and paths Jane actually found", () => {
    const seen = new Map([[4, "Oven start-up"], [9, "Deep clean"]]);
    expect(keepKnownSops([4, "9", 77, 4], seen)).toEqual([{ id: 4, title: "Oven start-up" }, { id: 9, title: "Deep clean" }]);
    expect(keepKnownSops("4", seen)).toEqual([]);
    expect(keepKnownPath("/orders", new Set(["/orders"]))).toBe("/orders");
    expect(keepKnownPath("/made-up", new Set(["/orders"]))).toBeNull();
  });
});
