import { describe, it, expect } from "vitest";
import {
  stationFromPath, idleTimeoutMinutes, idleTimeoutMs,
  DEFAULT_IDLE_TIMEOUTS, MAX_IDLE_MINUTES,
} from "./idle-timeout";

describe("stationFromPath", () => {
  it("reads the station from a station route", () => {
    expect(stationFromPath("/plans/123/station/dough_prep")).toBe("dough_prep");
  });

  it("survives a query string or trailing path", () => {
    expect(stationFromPath("/plans/9/station/packing?tab=cycle")).toBe("packing");
    expect(stationFromPath("/plans/9/station/ovens/details")).toBe("ovens");
  });

  it("returns null anywhere else in the app", () => {
    expect(stationFromPath("/")).toBeNull();
    expect(stationFromPath("/improvements")).toBeNull();
    expect(stationFromPath("/plans")).toBeNull();
  });
});

describe("idleTimeoutMinutes", () => {
  // The reason this exists: a screen you watch but rarely touch was locking
  // people out every fifteen minutes.
  it("gives the dough screens three hours out of the box", () => {
    expect(idleTimeoutMinutes("/plans/1/station/dough_prep", null)).toBe(180);
    expect(idleTimeoutMinutes("/plans/1/station/dough_sheeting", null)).toBe(180);
  });

  it("leaves the rest of the app on the old fifteen minutes", () => {
    expect(idleTimeoutMinutes("/", null)).toBe(15);
    expect(idleTimeoutMinutes("/plans/1/station/ovens", null)).toBe(15);
  });

  it("uses a station's own setting when one is configured", () => {
    const settings = { ...DEFAULT_IDLE_TIMEOUTS, packing: 20 };
    expect(idleTimeoutMinutes("/plans/1/station/packing", settings)).toBe(20);
  });

  it("follows the default for a station nobody has configured", () => {
    const settings = { default: 30, packing: 20 };
    expect(idleTimeoutMinutes("/plans/1/station/wrapping", settings)).toBe(30);
  });

  it("lets the default be changed for the whole app", () => {
    expect(idleTimeoutMinutes("/improvements", { default: 45 })).toBe(45);
  });

  it("keeps a configured station value even when it's shorter than the default", () => {
    expect(idleTimeoutMinutes("/plans/1/station/packing", { default: 60, packing: 20 })).toBe(20);
  });

  // Settings come from the database as free-form JSON, so nonsense has to
  // fall back rather than lock someone out instantly or never.
  it("ignores junk and falls back to the default", () => {
    expect(idleTimeoutMinutes("/plans/1/station/packing", { default: 15, packing: 0 })).toBe(15);
    expect(idleTimeoutMinutes("/plans/1/station/packing", { default: 15, packing: -5 })).toBe(15);
    expect(idleTimeoutMinutes("/plans/1/station/packing", { default: 15, packing: NaN })).toBe(15);
    expect(idleTimeoutMinutes("/plans/1/station/packing", { default: 15, packing: "abc" as unknown as number })).toBe(15);
  });

  it("falls back to the shipped default when the default itself is junk", () => {
    expect(idleTimeoutMinutes("/improvements", { default: 0 })).toBe(15);
  });

  it("caps an absurd value rather than never locking", () => {
    expect(idleTimeoutMinutes("/plans/1/station/packing", { packing: 99999 })).toBe(MAX_IDLE_MINUTES);
  });

  it("rounds a fractional value to whole minutes", () => {
    expect(idleTimeoutMinutes("/plans/1/station/packing", { packing: 20.6 })).toBe(21);
  });
});

describe("idleTimeoutMs", () => {
  it("converts to the milliseconds the idle check compares against", () => {
    expect(idleTimeoutMs("/plans/1/station/dough_prep", null)).toBe(180 * 60_000);
    expect(idleTimeoutMs("/", null)).toBe(15 * 60_000);
  });
});
