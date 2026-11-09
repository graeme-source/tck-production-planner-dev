import { describe, expect, it } from "vitest";
import { shouldReclaimScanFocus } from "./scan-focus";

describe("shouldReclaimScanFocus", () => {
  it("takes the focus back from a button, so a scanner's Enter can't press it (#139291, 9 Nov 2026)", () => {
    expect(shouldReclaimScanFocus({ tagName: "BUTTON" })).toBe(true);
    expect(shouldReclaimScanFocus({ tagName: "BODY" })).toBe(true);
    expect(shouldReclaimScanFocus(null)).toBe(true);
  });

  it("takes it back from a checkbox, which can't be typed in", () => {
    expect(shouldReclaimScanFocus({ tagName: "INPUT", type: "checkbox" })).toBe(true);
  });

  it("never steals it from a box someone is typing in", () => {
    expect(shouldReclaimScanFocus({ tagName: "INPUT", type: "text" })).toBe(false);
    expect(shouldReclaimScanFocus({ tagName: "INPUT", type: "number" })).toBe(false);
    expect(shouldReclaimScanFocus({ tagName: "INPUT" })).toBe(false);
    expect(shouldReclaimScanFocus({ tagName: "TEXTAREA" })).toBe(false);
    expect(shouldReclaimScanFocus({ tagName: "DIV", isContentEditable: true })).toBe(false);
  });
});
