import { describe, it, expect } from "vitest";
import { peopleAccessLabel, peopleAccessToggleBlocked } from "./people-access-labels";

describe("peopleAccessLabel", () => {
  it("names the three states the way Graeme asked", () => {
    expect(peopleAccessLabel("none").label).toBe("No access");
    expect(peopleAccessLabel("pin_needed").label).toBe("Access — private PIN not set yet");
    expect(peopleAccessLabel("ready").label).toBe("Access — private PIN set");
  });
  it("flags 'PIN not set yet' as needing attention", () => {
    expect(peopleAccessLabel("pin_needed").tone).toBe("warn");
  });
});

describe("peopleAccessToggleBlocked", () => {
  it("blocks every switch for anyone who isn't the founder", () => {
    expect(peopleAccessToggleBlocked({ viewerCanGrant: false, rowIsFounder: false, rowHasAccess: false })).toMatch(/Only Graeme/);
  });
  it("blocks the founder switching their own access off", () => {
    expect(peopleAccessToggleBlocked({ viewerCanGrant: true, rowIsFounder: true, rowHasAccess: true })).toMatch(/can't be removed/);
  });
  it("lets the founder switch anyone else either way", () => {
    expect(peopleAccessToggleBlocked({ viewerCanGrant: true, rowIsFounder: false, rowHasAccess: true })).toBeNull();
    expect(peopleAccessToggleBlocked({ viewerCanGrant: true, rowIsFounder: false, rowHasAccess: false })).toBeNull();
  });
});
