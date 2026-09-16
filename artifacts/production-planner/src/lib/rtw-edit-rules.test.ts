import { describe, it, expect } from "vitest";
import { rtwFieldsLocked, rtwCanOfferAmend } from "./rtw-edit-rules";

describe("rtwFieldsLocked", () => {
  it("keeps a draft editable for whoever can open it", () => {
    expect(rtwFieldsLocked({ status: "draft", isRtwManager: false, amending: false })).toBe(false);
    expect(rtwFieldsLocked({ status: "draft", isRtwManager: true, amending: false })).toBe(false);
  });

  it("locks a signed form by default, even for an RTW manager", () => {
    expect(rtwFieldsLocked({ status: "complete", isRtwManager: true, amending: false })).toBe(true);
    expect(rtwFieldsLocked({ status: "complete", isRtwManager: false, amending: false })).toBe(true);
  });

  it("unlocks a signed form for an RTW manager who chose to amend", () => {
    // The 2026-09-16 regression: the founder could never reach this state.
    expect(rtwFieldsLocked({ status: "complete", isRtwManager: true, amending: true })).toBe(false);
  });

  it("never unlocks a signed form for the colleague, amend flag or not", () => {
    expect(rtwFieldsLocked({ status: "complete", isRtwManager: false, amending: true })).toBe(true);
  });
});

describe("rtwCanOfferAmend", () => {
  it("offers Amend only on signed forms, only to RTW managers", () => {
    expect(rtwCanOfferAmend({ status: "complete", isRtwManager: true })).toBe(true);
    expect(rtwCanOfferAmend({ status: "complete", isRtwManager: false })).toBe(false);
    expect(rtwCanOfferAmend({ status: "draft", isRtwManager: true })).toBe(false);
  });
});
