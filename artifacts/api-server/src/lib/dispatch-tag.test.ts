import { describe, it, expect } from "vitest";
import { isDispatchTagged } from "./dispatch-tag";

describe("isDispatchTagged", () => {
  it("finds the tag among others", () => {
    expect(isDispatchTagged("2026-08-26, large box, dispatch")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isDispatchTagged("small box,  Dispatch ")).toBe(true);
    expect(isDispatchTagged("DISPATCH")).toBe(true);
  });

  it("matches whole tags only", () => {
    expect(isDispatchTagged("dispatched")).toBe(false);
    expect(isDispatchTagged("no-dispatch")).toBe(false);
    expect(isDispatchTagged("pre dispatch check")).toBe(false);
  });

  it("is false for an order with no tags", () => {
    expect(isDispatchTagged("")).toBe(false);
    expect(isDispatchTagged(null)).toBe(false);
    expect(isDispatchTagged(undefined)).toBe(false);
  });

  // Regression: an untagged order must never be treated as approved, because
  // that is what lets a courier label be raised before anyone signed the
  // order off for dispatch (Graeme, 2026-08-29).
  it("does not approve an order that is only box-tagged", () => {
    expect(isDispatchTagged("large box, wholesale")).toBe(false);
  });
});
