// Regression (Graeme, 2026-10-21): "Report defect / waste" had no way to type
// a reason — wrong recipe made, extra dough binned, no option fitted.
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { ReasonOtherField, REASON_DETAIL_MAX, resolveReasonDetail } from "./defect-reason";

// The shape the route validates (its body schema carries the same field).
const Body = z.object({ defectTypeId: z.number().int().positive(), reasonOther: ReasonOtherField });

describe("resolveReasonDetail — 'Something else…'", () => {
  it("keeps the typed text for a type that asks for it (round trip: body → stored value)", () => {
    const body = Body.parse({ defectTypeId: 9, reasonOther: "  wrong recipe —  extra dough made " });
    expect(resolveReasonDetail(true, body.reasonOther)).toEqual({ ok: true, value: "wrong recipe — extra dough made" });
  });

  it("rejects 'something else' with no text, blank text or under 3 characters", () => {
    for (const t of [undefined, null, "", "   ", "ab"]) {
      expect(resolveReasonDetail(true, t).ok).toBe(false);
    }
  });

  it("rejects text over the limit", () => {
    expect(resolveReasonDetail(true, "x".repeat(REASON_DETAIL_MAX + 1)).ok).toBe(false);
    expect(resolveReasonDetail(true, "x".repeat(REASON_DETAIL_MAX))).toEqual({ ok: true, value: "x".repeat(REASON_DETAIL_MAX) });
  });

  it("stores nothing for an ordinary type, even if text was sent", () => {
    expect(resolveReasonDetail(false, "left over from before")).toEqual({ ok: true, value: null });
    expect(resolveReasonDetail(false, undefined)).toEqual({ ok: true, value: null });
  });

  it("on edit, keeps the stored text when none is sent, and uses new text when it is", () => {
    expect(resolveReasonDetail(true, undefined, "extra dough")).toEqual({ ok: true, value: "extra dough" });
    expect(resolveReasonDetail(true, "dropped tray", "extra dough")).toEqual({ ok: true, value: "dropped tray" });
    expect(resolveReasonDetail(true, "", "extra dough").ok).toBe(false);
  });
});
