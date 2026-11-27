// Regression (Graeme, 27 Nov 2026): Tommy holds the Numbers grant but
// couldn't see "Every order" on Numbers — its data (GET /predict) was
// founder only. /predict must take the Numbers grant; every other profit
// tracker route stays founder only.
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("../lib/finance/profit-tracker-load", () => ({ TRACKER_SETTINGS: {} }));
vi.mock("../middleware/founder-access", () => ({ requireFounder: function founderOnly() {} }));
vi.mock("../middleware/founder-area-access", () => ({
  requireFounderArea: (key: string) => Object.defineProperty(function area() {}, "name", { value: `area:${key}` }),
}));

type Layer = { name: string; route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> } };

describe("profit tracker access", () => {
  it("GET /predict and GET /settings open to the Numbers grant; the rest stays founder only", async () => {
    const router = (await import("./profit-tracker")).default as unknown as { stack: Layer[] };
    const stack = router.stack;
    const open = (l: Layer) => !!l.route && l.route.methods["get"] === true && (l.route.path === "/predict" || l.route.path === "/settings");
    const founderGate = stack.findIndex(l => !l.route && l.name === "founderOnly");
    const opened = stack.map((l, i) => ({ l, i })).filter(x => open(x.l));
    expect(opened.map(x => x.l.route!.path).sort()).toEqual(["/predict", "/settings"]);
    for (const o of opened) {
      expect(o.l.route!.stack.map(h => h.name)).toContain("area:founder.numbers");
      expect(o.i).toBeLessThan(founderGate);
    }
    // Everything else (PUT /settings included) sits behind the founder gate.
    const others = stack.map((l, i) => ({ l, i })).filter(x => x.l.route && !open(x.l));
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) expect(o.i).toBeGreaterThan(founderGate);
  });
});
