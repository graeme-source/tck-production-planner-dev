import { describe, it, expect } from "vitest";
import {
  INITIAL_SIGN_IN, nextSignIn, shouldShowEmergencyPrompt, promptHiddenOnPath, filterTeam, onFileSummary,
  type PromptFacts,
} from "./emergency-contacts";

const BASE: PromptFacts = {
  promptNeeded: true, pinLocked: false, otherPromptShowing: false, path: "/", deferredInEpoch: null, epoch: 1,
};

describe("shouldShowEmergencyPrompt", () => {
  it("shows only when nothing is on file", () => {
    expect(shouldShowEmergencyPrompt(BASE)).toBe(true);
    expect(shouldShowEmergencyPrompt({ ...BASE, promptNeeded: false })).toBe(false);
  });
  it("never covers the PIN pad or another must-answer prompt", () => {
    expect(shouldShowEmergencyPrompt({ ...BASE, pinLocked: true })).toBe(false);
    expect(shouldShowEmergencyPrompt({ ...BASE, otherPromptShowing: true })).toBe(false);
  });
  it("stays off the kiosk, meeting, scan and print pages", () => {
    for (const p of ["/meeting", "/visitor-check-in", "/scan/batch/4", "/print/recipe-pnl"]) {
      expect(shouldShowEmergencyPrompt({ ...BASE, path: p })).toBe(false);
    }
    expect(promptHiddenOnPath("/meetings-archive")).toBe(false);
    expect(shouldShowEmergencyPrompt({ ...BASE, path: "/plans/180/station/building" })).toBe(true);
  });
  it("'Not now' lasts until the next sign-in, then it asks again", () => {
    expect(shouldShowEmergencyPrompt({ ...BASE, deferredInEpoch: 1, epoch: 1 })).toBe(false);
    expect(shouldShowEmergencyPrompt({ ...BASE, deferredInEpoch: 1, epoch: 2 })).toBe(true);
  });
});

describe("nextSignIn", () => {
  it("the app opening signed in is a sign-in", () => {
    expect(nextSignIn(INITIAL_SIGN_IN, { userId: 5, pinLocked: false }).epoch).toBe(1);
  });
  it("clearing the PIN pad is a sign-in; locking isn't", () => {
    let t = nextSignIn(INITIAL_SIGN_IN, { userId: 5, pinLocked: false });
    t = nextSignIn(t, { userId: 5, pinLocked: true });
    expect(t.epoch).toBe(1);
    t = nextSignIn(t, { userId: 5, pinLocked: false });
    expect(t.epoch).toBe(2);
  });
  it("someone else PIN-switching onto the iPad is a sign-in", () => {
    const t = nextSignIn({ userId: 5, pinLocked: true, epoch: 3 }, { userId: 6, pinLocked: false });
    expect(t).toEqual({ userId: 6, pinLocked: false, epoch: 4 });
  });
  it("nothing changing keeps the same state (no re-render churn)", () => {
    const t = { userId: 5, pinLocked: false, epoch: 2 };
    expect(nextSignIn(t, { userId: 5, pinLocked: false })).toBe(t);
  });
  it("signing out isn't a sign-in", () => {
    expect(nextSignIn({ userId: 5, pinLocked: false, epoch: 2 }, { userId: null, pinLocked: false }).epoch).toBe(2);
  });
});

describe("team list", () => {
  const people = [
    { userId: 1, name: "Zara Test", jobTitle: "Packer", hasContact: true },
    { userId: 2, name: "Ali Test", jobTitle: "Builder", hasContact: false },
    { userId: 3, name: "Kim Test", jobTitle: null, hasContact: true },
  ];
  it("keeps name order and searches name or job title", () => {
    expect(filterTeam(people, "").map(p => p.userId)).toEqual([2, 3, 1]);
    expect(filterTeam(people, "pack").map(p => p.userId)).toEqual([1]);
    expect(filterTeam(people, " ali ").map(p => p.userId)).toEqual([2]);
  });
  it("summarises how many are on file", () => {
    expect(onFileSummary(people)).toBe("2 of 3 on file");
  });
});
