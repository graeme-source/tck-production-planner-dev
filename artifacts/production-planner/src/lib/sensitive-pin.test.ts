import { describe, it, expect } from "vitest";
import { shouldPromptForSensitivePin } from "./sensitive-pin";

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
