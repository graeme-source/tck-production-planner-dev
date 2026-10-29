import { describe, expect, it, vi } from "vitest";

// No database: nothing here runs a query.
vi.mock("@workspace/db", () => ({ db: { execute: async () => ({ rows: [] }) }, pool: { query: async () => ({ rows: [] }) } }));

const { default: router, SchemeBody } = await import("./staff-bonus");
const { requireFounder } = await import("../middleware/founder-access");
const { requirePeopleUnlock } = await import("../middleware/people-unlock");

type Layer = { route?: unknown; handle: unknown };

describe("bonus calculator API", () => {
  it("is the founder's alone and behind the private PIN, on every route", () => {
    const layers = (router as unknown as { stack: Layer[] }).stack;
    const firstRoute = layers.findIndex(l => l.route);
    const guards = layers.slice(0, firstRoute).map(l => l.handle);
    expect(guards).toContain(requireFounder);
    expect(guards).toContain(requirePeopleUnlock);
  });

  it("stores only the scheme's numbers", () => {
    const ok = { atMinimum: 50, atStretch: 500, curve: 2, step: 5000, perStep: 50, maxBonus: 750, profitFloorPct: 5, employerNiPct: 15 };
    expect(SchemeBody.safeParse(ok).success).toBe(true);
    expect(SchemeBody.safeParse({ ...ok, profitFloorPct: 120 }).success).toBe(false);
    expect(SchemeBody.safeParse({ ...ok, atStretch: "500" }).success).toBe(false);
    expect(SchemeBody.safeParse({ ...ok, note: "x" }).success).toBe(false);
  });
});
