import { describe, it, expect } from "vitest";
import { shouldPromptForSensitivePin, shouldDemandPinOnEntry } from "./sensitive-pin";

const TTL = 5 * 60 * 1000;

describe("shouldPromptForSensitivePin", () => {
  it("prompts a manager whose unlock window has passed", () => {
    expect(shouldPromptForSensitivePin({ role: "manager", includeAdmins: false, msSinceUnlock: TTL + 1, ttlMs: TTL })).toBe(true);
  });

  it("doesn't nag inside the unlock window", () => {
    expect(shouldPromptForSensitivePin({ role: "manager", includeAdmins: false, msSinceUnlock: 60_000, ttlMs: TTL })).toBe(false);
  });

  it("exempts admins on ordinary sensitive pages (settings, reports)", () => {
    expect(shouldPromptForSensitivePin({ role: "admin", includeAdmins: false, msSinceUnlock: TTL + 1, ttlMs: TTL })).toBe(false);
  });

  it("prompts EVERYONE — admins included — where people-data lives", () => {
    // The Employee Hub case: an admin's left-behind iPad is the one that
    // holds every employee's reviews and recorded feedback.
    expect(shouldPromptForSensitivePin({ role: "admin", includeAdmins: true, msSinceUnlock: TTL + 1, ttlMs: TTL })).toBe(true);
  });

  it("a fresh PIN entry covers the admin too — no double prompt", () => {
    expect(shouldPromptForSensitivePin({ role: "admin", includeAdmins: true, msSinceUnlock: 30_000, ttlMs: TTL })).toBe(false);
  });

  it("prompts a viewer who has never unlocked (msSinceUnlock = forever)", () => {
    expect(shouldPromptForSensitivePin({ role: "viewer", includeAdmins: false, msSinceUnlock: Number.MAX_SAFE_INTEGER, ttlMs: TTL })).toBe(true);
  });

  it("fresh ignores the unlock window — entering the hub always asks", () => {
    // Graeme, 2026-09-07: leaving the Employee Hub and coming straight back
    // must ask again, however recent the last PIN entry was.
    expect(shouldPromptForSensitivePin({ role: "viewer", includeAdmins: true, msSinceUnlock: 0, ttlMs: TTL, fresh: true })).toBe(true);
    expect(shouldPromptForSensitivePin({ role: "admin", includeAdmins: true, msSinceUnlock: 0, ttlMs: TTL, fresh: true })).toBe(true);
  });

  it("fresh still respects the admin exemption when includeAdmins is false", () => {
    expect(shouldPromptForSensitivePin({ role: "admin", includeAdmins: false, msSinceUnlock: 0, ttlMs: TTL, fresh: true })).toBe(false);
  });
});

describe("shouldDemandPinOnEntry", () => {
  const base = { authenticated: true, enabled: true };

  it("demands the PIN the first time a page is entered", () => {
    expect(shouldDemandPinOnEntry({ ...base, demandedFor: null, entryKey: "employees" })).toBe(true);
  });

  it("REGRESSION: does not re-demand after the PIN is accepted", () => {
    // Accepting the PIN flips pinLocked, which changes requireSensitivePin's
    // identity and re-runs the page effect. Before this rule existed, that
    // second run re-locked the screen and Employee Records was unreachable —
    // the only way out was the overlay's sign-out button, which is why it
    // looked like "it goes back to the login screen" (Graeme, 2026-09-17).
    expect(shouldDemandPinOnEntry({ ...base, demandedFor: "employees", entryKey: "employees" })).toBe(false);
  });

  it("demands again when the user moves to a different sensitive tab", () => {
    expect(shouldDemandPinOnEntry({ ...base, demandedFor: "analytics", entryKey: "employees" })).toBe(true);
  });

  it("stays quiet on tabs that aren't gated", () => {
    expect(shouldDemandPinOnEntry({ ...base, enabled: false, demandedFor: null, entryKey: "issues" })).toBe(false);
  });

  it("never prompts before the user is signed in", () => {
    expect(shouldDemandPinOnEntry({ ...base, authenticated: false, demandedFor: null, entryKey: "employees" })).toBe(false);
  });
});
