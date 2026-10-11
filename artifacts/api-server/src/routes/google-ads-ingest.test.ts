import { describe, expect, it, vi } from "vitest";

// No database: these check how the routers are wired, not what they write.
vi.mock("@workspace/db", () => ({
  db: { execute: async () => ({ rows: [] }), transaction: async () => { throw new Error("no db in tests"); } },
  pool: { query: async () => ({ rows: [] }) },
}));

const { default: ingest } = await import("./google-ads-ingest");
const { default: link, MakeKeyBody } = await import("./google-ads-link");
const { requireFounder } = await import("../middleware/founder-access");

type Layer = { name?: string; handle: unknown; route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name?: string; handle: { name?: string } }> } };
const stackOf = (r: unknown) => (r as { stack: Layer[] }).stack;

describe("POST /api/ad-spend/google-ads (the script's door)", () => {
  it("is the only route, and checks the key BEFORE reading the body", () => {
    const routes = stackOf(ingest).filter(l => l.route).map(l => l.route!);
    expect(routes.map(r => [r.path, Object.keys(r.methods)])).toEqual([["/", ["post"]]]);
    const names = routes[0]!.stack.map(s => s.handle.name);
    expect(names[0]).toBe("requireIngestKey");
    expect(names.length).toBe(3); // key → validate() → handler
  });

  it("has its own rate limit in front of everything", () => {
    const first = stackOf(ingest)[0]!;
    expect(first.route).toBeUndefined();
  });

  it("refuses a request with no key (401), and never reaches the database write", async () => {
    const handler = stackOf(ingest).find(l => l.route)!.route!.stack[0]!.handle as unknown as
      (req: unknown, res: unknown, next: () => void) => Promise<void>;
    let status = 0;
    let body: { error?: string } = {};
    let passed = false;
    const res = { status(n: number) { status = n; return this; }, json(b: unknown) { body = b as typeof body; return this; } };
    await handler({ headers: {} }, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(status).toBe(401);
    expect(body.error).toMatch(/key/i);
  });
});

describe("/api/google-ads-link (the founder's side)", () => {
  it("every route is founder only", () => {
    const guards = stackOf(link).filter(l => !l.route).map(l => l.handle);
    expect(guards).toContain(requireFounder);
  });

  it("make, turn off, and status — nothing else", () => {
    const routes = stackOf(link).filter(l => l.route).map(l => `${Object.keys(l.route!.methods)[0]} ${l.route!.path}`);
    expect(routes.sort()).toEqual(["delete /key", "get /", "post /key"]);
  });

  it("making a key takes no input", () => {
    expect(MakeKeyBody.safeParse({}).success).toBe(true);
    expect(MakeKeyBody.safeParse({ key: "mine" }).success).toBe(false);
  });
});
