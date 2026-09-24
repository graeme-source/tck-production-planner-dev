import { describe, it, expect } from "vitest";
import { isPeopleUnlocked, isValidPrivatePin, PEOPLE_UNLOCK_TTL_MS } from "./people-unlock";

const now = new Date("2026-09-24T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("isPeopleUnlocked", () => {
  it("locked until the private PIN has been entered", () => {
    expect(isPeopleUnlocked(undefined, now)).toBe(false);
    expect(isPeopleUnlocked("not a date", now)).toBe(false);
  });
  it("unlocked within the window", () => {
    expect(isPeopleUnlocked(ago(60_000), now)).toBe(true);
    expect(isPeopleUnlocked(ago(PEOPLE_UNLOCK_TTL_MS - 1000), now)).toBe(true);
  });
  it("locks again once the window passes", () => {
    expect(isPeopleUnlocked(ago(PEOPLE_UNLOCK_TTL_MS), now)).toBe(false);
  });
  it("a timestamp from the future never counts", () => {
    expect(isPeopleUnlocked(new Date(now.getTime() + 60_000).toISOString(), now)).toBe(false);
  });
});

describe("isValidPrivatePin", () => {
  it("accepts exactly 4 digits, like the station keypad", () => {
    expect(isValidPrivatePin("0427")).toBe(true);
  });
  it("rejects anything else", () => {
    for (const p of ["123", "12345", "12a4", "", 1234, null]) expect(isValidPrivatePin(p)).toBe(false);
  });
});
