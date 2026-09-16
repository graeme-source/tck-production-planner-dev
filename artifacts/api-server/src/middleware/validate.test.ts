import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { Request, Response } from "express";
import { validate, rawBody } from "./validate";

// Regression (found in the Philly restructure rehearsal, 2026-09-16):
// .passthrough() only protects the TOP level — zod object schemas nested
// inside arrays re-create each item and silently strip keys the generated
// spec doesn't know yet (the sub-recipe marinade links). rawBody(req) must
// hand back the body exactly as the client sent it.
describe("validate + rawBody", () => {
  const schema = z.object({
    name: z.string(),
    ingredients: z.array(z.object({ ingredientId: z.number(), quantity: z.number() })),
  });

  function run(body: unknown) {
    const req = { body } as Request;
    let statusCode: number | null = null;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json() { return this; },
    } as unknown as Response;
    let called = false;
    validate(schema)(req, res, () => { called = true; });
    return { req, statusCode, nextCalled: called };
  }

  it("strips unknown NESTED keys from req.body but preserves them in rawBody", () => {
    const { req, nextCalled } = run({
      name: "Slow-cooked Philly Beef",
      topLevelExtra: true,
      ingredients: [{ ingredientId: 154, quantity: 0.97, marinadeForIngredientId: 154, marinadeAddAtCooking: true }],
    });
    expect(nextCalled).toBe(true);
    // The validated body loses the nested extras (zod behaviour, documented)…
    expect((req.body.ingredients[0] as Record<string, unknown>).marinadeForIngredientId).toBeUndefined();
    // …but the raw body keeps every byte the client sent.
    const raw = rawBody<{ ingredients: Array<Record<string, unknown>> }>(req);
    expect(raw.ingredients[0].marinadeForIngredientId).toBe(154);
    expect(raw.ingredients[0].marinadeAddAtCooking).toBe(true);
  });

  it("still rejects invalid bodies", () => {
    const { statusCode, nextCalled } = run({ name: 42, ingredients: [] });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(400);
  });

  it("rawBody falls back to req.body when validate never ran", () => {
    const req = { body: { plain: true } } as Request;
    expect(rawBody<{ plain: boolean }>(req).plain).toBe(true);
  });
});
