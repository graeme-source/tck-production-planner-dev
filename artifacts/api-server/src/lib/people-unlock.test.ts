import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import {
  isPeopleUnlocked, isValidPrivatePin, PEOPLE_UNLOCK_TTL_MS,
  peopleGateDecision, peopleGateRefusal, peoplePinHashFor, pinClashes,
} from "./people-unlock";

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

describe("peopleGateDecision — the private PIN is compulsory with People access", () => {
  it("lets someone without People access through (their own record only)", () => {
    expect(peopleGateDecision({ hasAccess: false, hasPrivatePin: false, unlocked: false })).toBe("pass");
    expect(peopleGateDecision({ hasAccess: false, hasPrivatePin: true, unlocked: false })).toBe("pass");
  });

  it("REGRESSION: access without a private PIN opens nothing — 428, not the station PIN", () => {
    expect(peopleGateDecision({ hasAccess: true, hasPrivatePin: false, unlocked: false })).toBe("private_pin_required");
    // Even a session stamped unlocked (e.g. by the old station-PIN fallback)
    // gets nothing until a private PIN exists.
    expect(peopleGateDecision({ hasAccess: true, hasPrivatePin: false, unlocked: true })).toBe("private_pin_required");
  });

  it("asks for the private PIN when it's set but not entered recently", () => {
    expect(peopleGateDecision({ hasAccess: true, hasPrivatePin: true, unlocked: false })).toBe("locked");
  });

  it("opens once unlocked with the private PIN", () => {
    expect(peopleGateDecision({ hasAccess: true, hasPrivatePin: true, unlocked: true })).toBe("pass");
  });
});

describe("peopleGateRefusal", () => {
  it("maps 'private PIN not set' to 428 with a code the app recognises", () => {
    expect(peopleGateRefusal("private_pin_required")).toEqual({
      status: 428,
      body: { error: "Set your private PIN to open People", code: "private_pin_required" },
    });
  });
  it("maps 'locked' to 423 as before", () => {
    expect(peopleGateRefusal("locked")?.status).toBe(423);
    expect(peopleGateRefusal("locked")?.body.code).toBe("PEOPLE_PIN_REQUIRED");
  });
  it("lets 'pass' through", () => {
    expect(peopleGateRefusal("pass")).toBeNull();
  });
});

describe("peoplePinHashFor", () => {
  it("REGRESSION: never falls back to the station PIN", () => {
    // /people-pin/verify used to check the station PIN when no private PIN
    // was set, which made the private PIN optional (Graeme, 2026-09-25).
    expect(peoplePinHashFor({ privatePinHash: null, pinHash: "station-hash" })).toBeNull();
  });
  it("uses the private PIN when set", () => {
    expect(peoplePinHashFor({ privatePinHash: "private-hash", pinHash: "station-hash" })).toBe("private-hash");
  });
});

describe("pinClashes — station and private PINs must differ both ways", () => {
  // Real bcrypt at a low cost, so this is the same comparison the routes use.
  const stationHash = bcrypt.hashSync("1111", 4);
  const privateHash = bcrypt.hashSync("2222", 4);

  it("REGRESSION: a new station PIN equal to the private PIN is caught", async () => {
    expect(await pinClashes("2222", privateHash, bcrypt.compare)).toBe(true);
  });
  it("a new private PIN equal to the station PIN is caught", async () => {
    expect(await pinClashes("1111", stationHash, bcrypt.compare)).toBe(true);
  });
  it("different PINs are fine", async () => {
    expect(await pinClashes("3333", privateHash, bcrypt.compare)).toBe(false);
    expect(await pinClashes("3333", stationHash, bcrypt.compare)).toBe(false);
  });
  it("no other PIN set → nothing to clash with", async () => {
    expect(await pinClashes("2222", null, bcrypt.compare)).toBe(false);
  });
});
