/**
 * Regression (2026-10-12): other people's onboarding files — the P45, right
 * to work / ID, signed starter forms — are read ONLY from the People record,
 * behind the private People PIN and People access. The old
 * /api/onboarding/documents/:id/file link used to open anyone's file for any
 * manager or admin. This pins the route shape so neither door reopens:
 *   • the onboarding router has no cross-user read (only /me, /me/gate and
 *     the owner-only file link);
 *   • every People-side onboarding route in person-documents.ts sits after
 *     requirePeopleUnlock + the People-access check.
 * The per-request rules themselves are tested in
 * lib/onboarding-record-documents.test.ts. No database.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>().catch(() => ({}));
  return {
    ...real,
    db: {
      execute: async () => ({ rows: [] }),
      select: () => { throw new Error("no db in tests"); },
    },
    pool: { query: async () => ({ rows: [] }), connect: async () => { throw new Error("no db in tests"); } },
  };
});

process.env.DATABASE_URL ??= "postgres://test/never-connected";

const { requirePeopleUnlock } = await import("../middleware/people-unlock");

type Layer = {
  name?: string;
  handle: unknown;
  route?: { path: string; methods: Record<string, boolean> };
};

function layers(router: unknown): Layer[] {
  return (router as { stack: Layer[] }).stack;
}

function getPaths(router: unknown): string[] {
  return layers(router).filter(l => l.route?.methods["get"]).map(l => l.route!.path);
}

describe("onboarding files are read only through the People record", () => {
  it("the onboarding router serves no one else's form or files", async () => {
    const { default: router } = await import("./onboarding");
    expect(getPaths(router).sort()).toEqual(["/documents/:id/file", "/me", "/me/gate"]);
  });

  it("every People-side onboarding route sits behind the People PIN and access check", async () => {
    const { default: router } = await import("./person-documents");
    const stack = layers(router);
    const unlockAt = stack.findIndex(l => !l.route && l.handle === requirePeopleUnlock);
    expect(unlockAt).toBeGreaterThanOrEqual(0);
    // The access check is the next router-level middleware after the unlock.
    const accessAt = stack.findIndex((l, i) => i > unlockAt && !l.route);
    expect(accessAt).toBeGreaterThan(unlockAt);
    const gated = ["/person/:userId", "/onboarding/:id/file", "/starter-forms/:id/file", "/person/:userId/onboarding-form"];
    for (const path of gated) {
      const at = stack.findIndex(l => l.route?.path === path && l.route.methods["get"]);
      expect(at, path).toBeGreaterThan(accessAt);
    }
    // Only the person's own shared-document routes come before the gate.
    const before = stack.slice(0, unlockAt).filter(l => l.route).map(l => l.route!.path);
    expect(before.sort()).toEqual(["/mine", "/mine/:id/file"]);
  });
});
