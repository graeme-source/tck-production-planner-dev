import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import { validate } from "../middleware/validate";
import { TakeBackOutBody, undoNote, UNDO_REASONS, UNDO_REASON_LABELS, batchesInRemovalOrder } from "./wrapping-undo";

/** Run the exact middleware the undo routes use, without a server. */
function run(body: unknown) {
  const req = { body } as Request;
  let statusCode: number | null = null;
  let payload: unknown = null;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(p: unknown) { payload = p; return this; },
  } as unknown as Response;
  let nextCalled = false;
  validate(TakeBackOutBody)(req, res, () => { nextCalled = true; });
  return { req, statusCode, payload, nextCalled };
}

// Regression (Graeme, 2026-10-08): one stray tap on the wrapping screen's
// "Undo 20" took 20 wrapped Philly packs back out of the record. The old
// endpoint accepted { qty } alone. A single unconfirmed request must now be
// refused before anything is touched.
describe("taking wrapped packs back out — the server refuses an unconfirmed request", () => {
  it("refuses the old one-tap body { qty, packSize }", () => {
    const r = run({ qty: 20, packSize: 2 });
    expect(r.statusCode).toBe(400);
    expect(r.nextCalled).toBe(false);
  });

  it("refuses confirm without a reason, and a reason without confirm", () => {
    expect(run({ qty: 20, confirm: true }).nextCalled).toBe(false);
    expect(run({ qty: 20, reason: "added_twice" }).nextCalled).toBe(false);
  });

  it("refuses confirm: \"true\" (string) or 1 — only a real true counts", () => {
    expect(run({ qty: 20, confirm: "true", reason: "added_twice" }).nextCalled).toBe(false);
    expect(run({ qty: 20, confirm: 1, reason: "added_twice" }).nextCalled).toBe(false);
  });

  it("refuses an unknown reason and an empty Other", () => {
    expect(run({ qty: 20, confirm: true, reason: "because" }).nextCalled).toBe(false);
    expect(run({ qty: 20, confirm: true, reason: "other" }).nextCalled).toBe(false);
    expect(run({ qty: 20, confirm: true, reason: "other", otherText: "   " }).nextCalled).toBe(false);
  });

  it("refuses a zero, negative or fractional quantity and an odd pack size", () => {
    expect(run({ qty: 0, confirm: true, reason: "added_twice" }).nextCalled).toBe(false);
    expect(run({ qty: -5, confirm: true, reason: "added_twice" }).nextCalled).toBe(false);
    expect(run({ qty: 2.5, confirm: true, reason: "added_twice" }).nextCalled).toBe(false);
    expect(run({ qty: 5, packSize: 4, confirm: true, reason: "added_twice" }).nextCalled).toBe(false);
  });

  it("accepts a confirmed request with a reason", () => {
    const r = run({ qty: 20, packSize: 2, confirm: true, reason: "added_twice" });
    expect(r.nextCalled).toBe(true);
    expect(r.req.body).toMatchObject({ qty: 20, packSize: 2, confirm: true, reason: "added_twice" });
  });

  it("accepts Other with words, trimmed", () => {
    const r = run({ qty: 1, packSize: 8, confirm: true, reason: "other", otherText: "  bag split  " });
    expect(r.nextCalled).toBe(true);
    expect((r.req.body as { otherText: string }).otherText).toBe("bag split");
  });
});

describe("undoNote — what the Stock Control history says", () => {
  it("keeps the old 'Undo wrapped' start and adds the reason", () => {
    expect(undoNote("added_twice")).toBe("Undo wrapped — Added twice");
    expect(undoNote("wrong_recipe")).toBe("Undo wrapped — Wrong recipe");
    expect(undoNote("not_wrapped")).toBe("Undo wrapped — Not actually wrapped");
  });

  it("names 8-pack bags", () => {
    expect(undoNote("added_twice", null, 8)).toBe("Undo wrapped (8-pack bags) — Added twice");
  });

  it("writes Other's words, collapsed and capped", () => {
    expect(undoNote("other", "  counted   the trolley twice ")).toBe("Undo wrapped — Other: counted the trolley twice");
    expect(undoNote("other", "x".repeat(300)).length).toBeLessThanOrEqual("Undo wrapped — Other: ".length + 120);
    expect(undoNote("other", "")).toBe("Undo wrapped — Other");
  });

  it("has a label for every reason", () => {
    for (const r of UNDO_REASONS) expect(UNDO_REASON_LABELS[r]).toBeTruthy();
  });
});

describe("batchesInRemovalOrder — an undo takes from the plan's own batch first", () => {
  const oldestFirst = [
    { batchNumber: 26279, quantity: 4 },
    { batchNumber: 26280, quantity: 6 },
    { batchNumber: 26281, quantity: 20 },
  ];
  it("puts the preferred batch first, then the rest oldest-first", () => {
    expect(batchesInRemovalOrder(oldestFirst, 26281).map(b => b.batchNumber)).toEqual([26281, 26279, 26280]);
  });
  it("is plain oldest-first without a preference, or when the batch isn't there", () => {
    expect(batchesInRemovalOrder(oldestFirst).map(b => b.batchNumber)).toEqual([26279, 26280, 26281]);
    expect(batchesInRemovalOrder(oldestFirst, 99999).map(b => b.batchNumber)).toEqual([26279, 26280, 26281]);
  });
  it("doesn't change the caller's array", () => {
    batchesInRemovalOrder(oldestFirst, 26281);
    expect(oldestFirst[0].batchNumber).toBe(26279);
  });
});
