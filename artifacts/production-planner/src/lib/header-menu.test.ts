import { describe, it, expect } from "vitest";
import { headerMenuBadge, isPhoneHeader } from "./header-menu";

describe("isPhoneHeader", () => {
  // Regression (Graeme, 2026-10-10): on a phone the bell was cut off the
  // end of the bar. Phones fold the bar into one menu; iPads don't.
  it("folds on a phone, never on an iPad (portrait 810, landscape 1080)", () => {
    expect(isPhoneHeader(390)).toBe(true);
    expect(isPhoneHeader(767)).toBe(true);
    expect(isPhoneHeader(768)).toBe(false);
    expect(isPhoneHeader(810)).toBe(false);
    expect(isPhoneHeader(1080)).toBe(false);
  });
});

describe("headerMenuBadge", () => {
  it("adds unread notifications and messages", () => {
    expect(headerMenuBadge({ notifications: 2, messages: 3, messageWaiting: false })).toBe("5");
    expect(headerMenuBadge({ notifications: 120, messages: 0, messageWaiting: false })).toBe("99+");
  });
  it("shows ! for a message waiting to be confirmed, nothing when all is read", () => {
    expect(headerMenuBadge({ notifications: 0, messages: 0, messageWaiting: true })).toBe("!");
    expect(headerMenuBadge({ notifications: 0, messages: 0, messageWaiting: false })).toBeNull();
  });
});
