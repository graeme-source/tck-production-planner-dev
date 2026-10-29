import { describe, expect, it } from "vitest";
import { HUB_UNLOCK_TTL_MS, hubGateDecision, isHubUnlocked } from "./hub-unlock";

const base = { hasPeopleAccess: false, onboarding: false, hasStationPin: true, unlocked: false };

describe("hubGateDecision — someone else's iPad never opens your records", () => {
  it("locks own records until the PIN has just been typed", () => {
    expect(hubGateDecision(base)).toBe("locked");
    expect(hubGateDecision({ ...base, unlocked: true })).toBe("pass");
  });
  it("People-access users go through the private-PIN rules instead", () => {
    expect(hubGateDecision({ ...base, hasPeopleAccess: true, unlocked: true })).toBe("people");
  });
  it("lets onboarding and PIN-less accounts through — there's nothing they could type", () => {
    expect(hubGateDecision({ ...base, onboarding: true })).toBe("pass");
    expect(hubGateDecision({ ...base, hasStationPin: false })).toBe("pass");
  });
});

describe("isHubUnlocked", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  it("is open for 15 minutes after the PIN, then shut", () => {
    expect(isHubUnlocked(new Date(now.getTime() - 60_000).toISOString(), now)).toBe(true);
    expect(isHubUnlocked(new Date(now.getTime() - HUB_UNLOCK_TTL_MS).toISOString(), now)).toBe(false);
    expect(isHubUnlocked(undefined, now)).toBe(false);
    expect(isHubUnlocked("not a date", now)).toBe(false);
  });
});
