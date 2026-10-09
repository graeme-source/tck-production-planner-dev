import { describe, expect, it, vi } from "vitest";

// No database: these tests only look at the body rules and the route wiring.
vi.mock("@workspace/db", () => ({ db: {} }));

const { default: router, ExtraPacksBody } = await import("./extra-packs");

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

describe("PATCH extra-packs-built body", () => {
  // Regression, 9 Oct 2026: the oven station sends { delta } with no line,
  // and the old handler answered 400 to every tap.
  it("accepts a tap with no building line (the oven counter)", () => {
    expect(ExtraPacksBody.safeParse({ delta: 1 }).success).toBe(true);
    expect(ExtraPacksBody.safeParse({ delta: -1 }).success).toBe(true);
  });
  it("accepts a building line's own tap", () => {
    expect(ExtraPacksBody.safeParse({ delta: 1, stationType: "building_2" }).success).toBe(true);
  });
  it("refuses anything but one pack at a time, and unknown lines", () => {
    expect(ExtraPacksBody.safeParse({ delta: 2 }).success).toBe(false);
    expect(ExtraPacksBody.safeParse({ delta: 0 }).success).toBe(false);
    expect(ExtraPacksBody.safeParse({ delta: "1" }).success).toBe(false);
    expect(ExtraPacksBody.safeParse({}).success).toBe(false);
    expect(ExtraPacksBody.safeParse({ delta: 1, stationType: "ovens" }).success).toBe(false);
  });
  it("answers the same PATCH path the stations call", () => {
    const routes = (router as unknown as { stack: Layer[] }).stack.filter(l => l.route).map(l => l.route!);
    expect(routes.map(r => `${Object.keys(r.methods)[0]} ${r.path}`)).toEqual(["patch /:id/items/:itemId/extra-packs-built"]);
  });
});
