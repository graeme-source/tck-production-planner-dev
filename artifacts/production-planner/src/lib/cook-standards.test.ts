import { describe, it, expect } from "vitest";
import { defaultHoldSeconds, meetsCookStandard, formatHold } from "./cook-standards";

describe("defaultHoldSeconds — the FSA table", () => {
  it("matches the wall table at the band boundaries", () => {
    expect(defaultHoldSeconds(60)).toBe(2700); // 45 min
    expect(defaultHoldSeconds(65)).toBe(600);  // 10 min
    expect(defaultHoldSeconds(70)).toBe(120);  // 2 min
    expect(defaultHoldSeconds(75)).toBe(30);   // 30 sec
    expect(defaultHoldSeconds(80)).toBe(6);    // 6 sec
  });

  it("uses the highest band the temperature reaches, not the nearest", () => {
    expect(defaultHoldSeconds(72.5)).toBe(120); // between 70 and 75 → 70's 2 min
    expect(defaultHoldSeconds(74.9)).toBe(120);
    expect(defaultHoldSeconds(79.9)).toBe(30);
    expect(defaultHoldSeconds(92)).toBe(6);
  });

  it("has no safe hold below 60°C", () => {
    expect(defaultHoldSeconds(59.9)).toBeNull();
    expect(defaultHoldSeconds(40)).toBeNull();
  });
});

describe("meetsCookStandard", () => {
  it("passes 70°C for 2 minutes and 75°C for 30 seconds alike", () => {
    expect(meetsCookStandard(70, 120)).toBe(true);
    expect(meetsCookStandard(75, 30)).toBe(true);
  });

  it("fails a hold shorter than the band requires", () => {
    expect(meetsCookStandard(70, 60)).toBe(false);
    expect(meetsCookStandard(75, 20)).toBe(false);
  });

  it("fails anything under 60°C regardless of time", () => {
    expect(meetsCookStandard(59, 100000)).toBe(false);
  });
});

describe("formatHold", () => {
  it("reads like the wall table", () => {
    expect(formatHold(6)).toBe("6 sec");
    expect(formatHold(30)).toBe("30 sec");
    expect(formatHold(120)).toBe("2 min");
    expect(formatHold(600)).toBe("10 min");
    expect(formatHold(2700)).toBe("45 min");
    expect(formatHold(90)).toBe("1.5 min");
  });
});
