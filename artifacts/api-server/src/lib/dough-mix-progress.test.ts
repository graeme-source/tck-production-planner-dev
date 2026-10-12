import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import { validate } from "../middleware/validate";
import { DoughMixProgressChange, DoughMixProgressParams, shapeMixes } from "./dough-mix-progress";

/** Run the exact middleware the PUT route uses, without a server. */
function run(body: unknown) {
  const req = { body } as Request;
  let statusCode: number | null = null;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as Response;
  let nextCalled = false;
  validate(DoughMixProgressChange)(req, res, () => { nextCalled = true; });
  return { req, statusCode, nextCalled };
}

// Regression (Graeme, 2026-10-12): mix ticks were never saved, so reloads
// and other iPads showed "0 of 2 mixes". The save endpoint takes ONE change
// at a time, validated.
describe("PUT /dough-mix-progress/:planId body", () => {
  it("accepts a tick and an untick", () => {
    expect(run({ action: "tick", mixNo: 1, ingredientKey: "42", ticked: true }).nextCalled).toBe(true);
    expect(run({ action: "tick", mixNo: 2, ingredientKey: "Water", ticked: false }).nextCalled).toBe(true);
  });

  it("accepts completing and reopening a mix", () => {
    expect(run({ action: "complete", mixNo: 1, completed: true }).nextCalled).toBe(true);
    expect(run({ action: "complete", mixNo: 1, completed: false }).nextCalled).toBe(true);
  });

  it("trims the ingredient key", () => {
    const r = run({ action: "tick", mixNo: 1, ingredientKey: "  Salt ", ticked: true });
    expect((r.req.body as { ingredientKey: string }).ingredientKey).toBe("Salt");
  });

  it.each([
    [{}],
    [{ action: "tick", mixNo: 0, ingredientKey: "1", ticked: true }],
    [{ action: "tick", mixNo: 1.5, ingredientKey: "1", ticked: true }],
    [{ action: "tick", mixNo: 51, ingredientKey: "1", ticked: true }],
    [{ action: "tick", mixNo: 1, ingredientKey: "   ", ticked: true }],
    [{ action: "tick", mixNo: 1, ingredientKey: "1" }],
    [{ action: "complete", mixNo: 1 }],
    [{ action: "complete", mixNo: "1", completed: true }],
    [{ action: "wipe", mixNo: 1 }],
    // A whole-state overwrite is not a thing — it would let one iPad clobber another's ticks.
    [{ mixes: [{ mixNo: 1, ticked: ["1"], completed: true }] }],
  ])("refuses %j", (body) => {
    const r = run(body);
    expect(r.statusCode).toBe(400);
    expect(r.nextCalled).toBe(false);
  });

  it("plan id param must be a positive whole number", () => {
    expect(DoughMixProgressParams.safeParse({ planId: "301" }).success).toBe(true);
    expect(DoughMixProgressParams.safeParse({ planId: "0" }).success).toBe(false);
    expect(DoughMixProgressParams.safeParse({ planId: "abc" }).success).toBe(false);
  });
});

describe("shapeMixes", () => {
  it("orders by mix, names who ticked and completed", () => {
    const names = new Map([[5, "Asha"], [9, "Tom"]]);
    const out = shapeMixes([
      { mixNo: 2, ticks: {}, completedAt: null, completedByUserId: null },
      { mixNo: 1, ticks: { "42": { at: "2026-10-12T08:00:00.000Z", by: 5 } }, completedAt: new Date("2026-10-12T08:20:00Z"), completedByUserId: 9 },
    ], names);
    expect(out.map(m => m.mixNo)).toEqual([1, 2]);
    expect(out[0]!.ticked).toEqual([{ ingredientKey: "42", at: "2026-10-12T08:00:00.000Z", byUserId: 5, byName: "Asha" }]);
    expect(out[0]!.completedAt).toBe("2026-10-12T08:20:00.000Z");
    expect(out[0]!.completedBy).toEqual({ id: 9, name: "Tom" });
    expect(out[1]!.completedBy).toBeNull();
  });
});
