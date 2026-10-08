import { describe, expect, it, vi } from "vitest";

// No database: the founder check reads one email, which we hand it.
const lookedUpEmail = { value: "tommy@thecalzonekitchen.co.uk" as string | null };
vi.mock("@workspace/db", () => ({
  db: { execute: async () => ({ rows: [{ email: lookedUpEmail.value, is_active: true }] }) },
  pool: { query: async () => ({ rows: [] }), connect: async () => { throw new Error("no db in tests"); } },
}));
vi.mock("../lib/feature-access", () => ({ allowedFeatureKeys: async () => ["founder.numbers", "founder.sales"] }));

const { default: router } = await import("./revenue-targets");
const { requireFounder } = await import("../middleware/founder-access");

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } };

describe("revenue targets: only the founder can change them", () => {
  const routes = (router as unknown as { stack: Layer[] }).stack.filter(l => l.route).map(l => l.route!);

  it("has the four write routes the editor uses", () => {
    const writes = routes.filter(r => !r.methods["get"]).map(r => `${Object.keys(r.methods)[0]!.toUpperCase()} ${r.path}`);
    expect(writes.sort()).toEqual(["DELETE /stretch/:month", "POST /changes", "PUT /minimum", "PUT /stretch/:month"]);
  });

  it("puts requireFounder in front of every write", () => {
    for (const r of routes.filter(r => !r.methods["get"])) {
      expect(r.stack.map(s => s.handle), r.path).toContain(requireFounder);
    }
  });

  it("refuses a Numbers/Sales grantee with 403", async () => {
    lookedUpEmail.value = "tommy@thecalzonekitchen.co.uk";
    const res = fakeRes();
    const next = vi.fn();
    await requireFounder({ session: { userId: 24 } } as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("refuses a look-alike founder address (exact match only)", async () => {
    lookedUpEmail.value = "GRAEME@thecalzonekitchen.co.uk";
    const res = fakeRes();
    const next = vi.fn();
    await requireFounder({ session: { userId: 1 } } as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("lets the founder through", async () => {
    lookedUpEmail.value = "graeme@thecalzonekitchen.co.uk";
    const next = vi.fn();
    await requireFounder({ session: { userId: 1 } } as never, fakeRes() as never, next);
    expect(next).toHaveBeenCalled();
  });
});

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(b: unknown) { res.body = b; return res; },
  };
  return res;
}
