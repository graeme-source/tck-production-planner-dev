import { describe, it, expect } from "vitest";
import {
  CONTINUE_WINDOW_MS, MAX_SESSION_MS, completionTiming, decideOpen, isPrepTin, prepItemOf, sessionForCompletion,
} from "./prep-session-rules";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 27, 7, 0, 0); // 07:00 UTC

describe("decideOpen", () => {
  it("starts a new session when the person has none on the item", () => {
    expect(decideOpen(null, T0)).toEqual({ kind: "new" });
  });

  it("carries on a session that is still open (reload, second iPad, screen re-showing it)", () => {
    expect(decideOpen({ id: 7, openedAt: T0, closedAt: null }, T0 + 40 * MIN))
      .toEqual({ kind: "continue", sessionId: 7, pause: null });
  });

  it("carries on a session closed a moment ago and keeps the gap as a pause", () => {
    const closedAt = T0 + 5 * MIN;
    expect(decideOpen({ id: 7, openedAt: T0, closedAt }, closedAt + 2 * MIN))
      .toEqual({ kind: "continue", sessionId: 7, pause: { from: closedAt, to: closedAt + 2 * MIN } });
  });

  it("continues right up to the window, and starts afresh after it", () => {
    const closedAt = T0 + 5 * MIN;
    expect(decideOpen({ id: 7, openedAt: T0, closedAt }, closedAt + CONTINUE_WINDOW_MS).kind).toBe("continue");
    expect(decideOpen({ id: 7, openedAt: T0, closedAt }, closedAt + CONTINUE_WINDOW_MS + 1)).toEqual({ kind: "new" });
  });

  it("never continues a session first opened more than two hours ago — even one left open", () => {
    expect(decideOpen({ id: 7, openedAt: T0, closedAt: null }, T0 + MAX_SESSION_MS + 1)).toEqual({ kind: "new" });
  });

  it("records no pause for a close and re-open in the same instant", () => {
    expect(decideOpen({ id: 7, openedAt: T0, closedAt: T0 + MIN }, T0 + MIN))
      .toEqual({ kind: "continue", sessionId: 7, pause: null });
  });
});

describe("sessionForCompletion", () => {
  it("links a tick to the session open on the item", () => {
    expect(sessionForCompletion([{ id: 1, openedAt: T0, closedAt: null }], T0 + 12 * MIN)).toBe(1);
  });

  it("takes the most recently opened session when there are several", () => {
    const candidates = [
      { id: 1, openedAt: T0, closedAt: T0 + 3 * MIN },
      { id: 2, openedAt: T0 + 30 * MIN, closedAt: null },
    ];
    expect(sessionForCompletion(candidates, T0 + 45 * MIN)).toBe(2);
  });

  it("ignores sessions opened after the tick", () => {
    const candidates = [
      { id: 1, openedAt: T0, closedAt: null },
      { id: 2, openedAt: T0 + 30 * MIN, closedAt: null },
    ];
    expect(sessionForCompletion(candidates, T0 + 10 * MIN)).toBe(1);
  });

  it("still links a tick that lands just after the person moved off the item", () => {
    expect(sessionForCompletion([{ id: 1, openedAt: T0, closedAt: T0 + 20 * MIN }], T0 + 21 * MIN)).toBe(1);
  });

  it("does not link a tick long after the session was closed", () => {
    expect(sessionForCompletion([{ id: 1, openedAt: T0, closedAt: T0 + 5 * MIN }], T0 + 5 * MIN + CONTINUE_WINDOW_MS + 1)).toBeNull();
  });

  it("does not link a tick more than two hours after the session opened", () => {
    expect(sessionForCompletion([{ id: 1, openedAt: T0, closedAt: null }], T0 + MAX_SESSION_MS + 1)).toBeNull();
  });

  it("returns null when there is nothing to link to", () => {
    expect(sessionForCompletion([], T0)).toBeNull();
  });
});

describe("completionTiming — a completion needs an open session (flag-and-allow)", () => {
  it("links a completion made inside an opened item", () => {
    expect(completionTiming([{ id: 4, openedAt: T0, closedAt: null }], T0 + 6 * MIN)).toEqual({ kind: "link", sessionId: 4 });
  });

  it("flags a completion with nothing opened on the item — the tick stands, it just isn't timed", () => {
    expect(completionTiming([], T0)).toEqual({ kind: "flag" });
  });

  it("flags a completion long after the person moved off the item", () => {
    expect(completionTiming([{ id: 4, openedAt: T0, closedAt: T0 + MIN }], T0 + MIN + CONTINUE_WINDOW_MS + 1)).toEqual({ kind: "flag" });
  });

  it("flags a completion when the only session was opened after it", () => {
    expect(completionTiming([{ id: 4, openedAt: T0 + MIN, closedAt: null }], T0)).toEqual({ kind: "flag" });
  });
});

describe("isPrepTin", () => {
  it("counts tins and trays 1…n, not the mixing station's tin-0 confirmation", () => {
    expect(isPrepTin(1)).toBe(true);
    expect(isPrepTin(12)).toBe(true);
    expect(isPrepTin(0)).toBe(false);
  });
});

describe("prepItemOf", () => {
  it("accepts exactly one of ingredient or sub-recipe", () => {
    expect(prepItemOf({ ingredientId: 4 })).toEqual({ ingredientId: 4, subRecipeId: null });
    expect(prepItemOf({ subRecipeId: 9, ingredientId: null })).toEqual({ ingredientId: null, subRecipeId: 9 });
  });
  it("refuses neither or both", () => {
    expect(prepItemOf({})).toBeNull();
    expect(prepItemOf({ ingredientId: 4, subRecipeId: 9 })).toBeNull();
  });
});
