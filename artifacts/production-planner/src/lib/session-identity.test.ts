import { describe, it, expect } from "vitest";
import { shouldResetCachesOnIdentityChange } from "./session-identity";

describe("shouldResetCachesOnIdentityChange", () => {
  it("wipes when a different person PIN-switches in — the Lorna/Major leak", () => {
    expect(shouldResetCachesOnIdentityChange(6, 20)).toBe(true);
  });

  it("wipes on sign-out so the next person starts clean", () => {
    expect(shouldResetCachesOnIdentityChange(6, null)).toBe(true);
  });

  it("keeps the cache on first sign-in — nothing to leak yet", () => {
    expect(shouldResetCachesOnIdentityChange(null, 20)).toBe(false);
  });

  it("keeps the cache when the same person re-verifies their PIN", () => {
    // The daily lock overlay re-confirms the SAME user; wiping there would
    // refetch every screen several times a day for no privacy gain.
    expect(shouldResetCachesOnIdentityChange(20, 20)).toBe(false);
  });

  it("does nothing while nobody is signed in", () => {
    expect(shouldResetCachesOnIdentityChange(null, null)).toBe(false);
  });
});
