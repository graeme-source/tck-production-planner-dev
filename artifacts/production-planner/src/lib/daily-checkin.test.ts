import { describe, expect, it } from "vitest";
import {
  boardLine, checkinHoldsOthers, checkinMessage, goalBarFill, partOfDay, projectedPct,
  scoreSum, shouldShowCheckin, type CheckinCard, type CheckinShowFacts,
} from "./daily-checkin";

const card = (over: Partial<CheckinCard> = {}): CheckinCard => ({
  firstName: "Sam",
  window: { from: "2026-09-22", to: "2026-10-21" },
  scorePct: 40,
  shifts30: 10,
  credits30: 4,
  improvements30: 3,
  great30: 1,
  substantial30: 0,
  countAll: 12,
  board: { place: 3, of: 9 },
  prompts: [],
  nudge: null,
  ...over,
});

describe("checkinMessage — the tailored words", () => {
  it("none yet this month, never done one: your first could be today", () => {
    const m = checkinMessage(card({ improvements30: 0, credits30: 0, scorePct: 0, countAll: 0 }), 7);
    expect(m.tone).toBe("first");
    expect(m.line).toBe("Your first improvement could be today — and every one counts.");
  });

  it("none yet this month but done some before: the first one this month", () => {
    const m = checkinMessage(card({ improvements30: 0, credits30: 0, scorePct: 0 }), 7);
    expect(m.tone).toBe("first");
    expect(m.line).toBe("Nothing yet this month — your first one this month could be today.");
  });

  it("below 100%: one small improvement today gets you to X%", () => {
    const m = checkinMessage(card(), 7);
    expect(m.tone).toBe("climbing");
    expect(m.line).toBe("One small improvement today gets you to 50%.");
    // The Leaner-board's own step travels with it.
    expect(m.step?.key).toBe("rolling");
  });

  it("at 100% or more: celebrate and keep going", () => {
    const m = checkinMessage(card({ scorePct: 120, credits30: 12 }), 7);
    expect(m.tone).toBe("celebrate");
    expect(m.line).toBe("120% — that's more than one improvement a shift. Amazing work — keep it going!");
    expect(m.step?.key).toBe("legend");
  });

  it("no score (not linked to Planday): credits and count only, no %", () => {
    const m = checkinMessage(card({ scorePct: null, shifts30: null }), 7);
    expect(m.tone).toBe("no-score");
    expect(m.line).not.toMatch(/%/);
    expect(m.line).toBe("3 improvements in the last 30 days — brilliant. One more today keeps it rolling.");
  });

  it("greets by first name and time of day", () => {
    expect(checkinMessage(card(), 7).greeting).toBe("Morning, Sam!");
    expect(checkinMessage(card(), 13).greeting).toBe("Afternoon, Sam!");
    expect(checkinMessage(card({ firstName: "" }), 19).greeting).toBe("Evening!");
  });
});

describe("numbers on the card", () => {
  it("projects one more credit over the same shifts", () => {
    expect(projectedPct({ credits30: 4, shifts30: 10 })).toBe(50);
    expect(projectedPct({ credits30: 0, shifts30: 3 })).toBe(33);
    expect(projectedPct({ credits30: 4, shifts30: 0 })).toBeNull();
    expect(projectedPct({ credits30: 4, shifts30: null })).toBeNull();
  });

  it("fills the bar towards 100%, capped", () => {
    expect(goalBarFill(40)).toBe(40);
    expect(goalBarFill(160)).toBe(100);
    expect(goalBarFill(null)).toBe(0);
    expect(goalBarFill(0)).toBe(0);
  });

  it("says the sum plainly", () => {
    expect(scoreSum({ credits30: 4, shifts30: 10 })).toBe("4 credits ÷ 10 shifts worked");
    expect(scoreSum({ credits30: 4, shifts30: null })).toBeNull();
  });

  it("names their place on the Leaner-board", () => {
    expect(boardLine({ place: 1, of: 9 })).toBe("You're top of the Leaner-board this month!");
    expect(boardLine({ place: 2, of: 9 })).toBe("You're 2nd of 9 on the Leaner-board this month");
    expect(boardLine({ place: 3, of: 9 })).toBe("You're 3rd of 9 on the Leaner-board this month");
    expect(boardLine({ place: 11, of: 12 })).toBe("You're 11th of 12 on the Leaner-board this month");
    expect(boardLine({ place: 22, of: 30 })).toBe("You're 22nd of 30 on the Leaner-board this month");
    expect(boardLine(null)).toBeNull();
  });

  it("splits the day at noon and 5pm", () => {
    expect(partOfDay(11)).toBe("Morning");
    expect(partOfDay(12)).toBe("Afternoon");
    expect(partOfDay(17)).toBe("Evening");
  });
});

describe("shouldShowCheckin — when it may be on screen", () => {
  const due = { day: "2026-10-21", due: true, card: card() };
  const facts = (over: Partial<CheckinShowFacts> = {}): CheckinShowFacts => ({
    signedIn: true, pinLocked: false, otherMustAnswerPrompt: false, path: "/", status: due, acknowledgedLocally: false, ...over,
  });

  it("shows when due for a signed-in, unlocked person", () => {
    expect(shouldShowCheckin(facts())).toBe(true);
  });

  it("the morning PIN pad comes first", () => {
    expect(shouldShowCheckin(facts({ pinLocked: true }))).toBe(false);
  });

  it("the People PIN prompts come first", () => {
    expect(shouldShowCheckin(facts({ otherMustAnswerPrompt: true }))).toBe(false);
  });

  it("never on the visitor kiosk, meeting, scan or print pages", () => {
    for (const path of ["/visitor-check-in", "/meeting", "/scan", "/print/sop/3"]) {
      expect(shouldShowCheckin(facts({ path }))).toBe(false);
    }
  });

  it("does show on station screens, where PIN-switching happens", () => {
    expect(shouldShowCheckin(facts({ path: "/plans/12/station/building" }))).toBe(true);
  });

  it("not when nobody is signed in", () => {
    expect(shouldShowCheckin(facts({ signedIn: false }))).toBe(false);
  });

  it("not once acknowledged, or when the server says it's done", () => {
    expect(shouldShowCheckin(facts({ acknowledgedLocally: true }))).toBe(false);
    expect(shouldShowCheckin(facts({ status: { day: "2026-10-21", due: false, card: null } }))).toBe(false);
  });

  it("lets them through when the status failed to load", () => {
    expect(shouldShowCheckin(facts({ status: undefined }))).toBe(false);
  });
});

describe("checkinHoldsOthers — other first-of-day pop-ups wait their turn", () => {
  const base: CheckinShowFacts & { loading: boolean } = {
    signedIn: true, pinLocked: false, otherMustAnswerPrompt: false, path: "/",
    status: undefined, acknowledgedLocally: false, loading: true,
  };

  it("holds while the status is loading", () => {
    expect(checkinHoldsOthers(base)).toBe(true);
  });

  it("holds while the card is up", () => {
    expect(checkinHoldsOthers({ ...base, loading: false, status: { day: "d", due: true, card: card() } })).toBe(true);
  });

  it("lets them go once it's answered, not due, or failed", () => {
    expect(checkinHoldsOthers({ ...base, loading: false, status: { day: "d", due: true, card: card() }, acknowledgedLocally: true })).toBe(false);
    expect(checkinHoldsOthers({ ...base, loading: false, status: { day: "d", due: false, card: null } })).toBe(false);
    expect(checkinHoldsOthers({ ...base, loading: false, status: undefined })).toBe(false);
  });

  it("never holds on kiosk pages or behind the PIN pad (those have their own rules)", () => {
    expect(checkinHoldsOthers({ ...base, path: "/visitor-check-in" })).toBe(false);
    expect(checkinHoldsOthers({ ...base, pinLocked: true })).toBe(false);
  });
});
