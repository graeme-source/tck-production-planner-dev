import { describe, it, expect } from "vitest";
import { usablePreload, shouldRefreshPreload, nextOrderToPrepare, labelPreloadUrl, LABEL_PRELOAD_MAX_AGE_MS, LABEL_PRELOAD_GIVE_UP_MS, type PreloadedLabel } from "./label-preload";

const NOW = 1_800_000_000_000;
const ready: PreloadedLabel = { orderId: 7, waybill: "2026111303036990022684", url: "/x", state: "ready", loadedAt: NOW - 30_000, firstPreparedAt: NOW - 30_000 };

describe("using a prepared label", () => {
  it("prints it for the same order and consignment while it's fresh", () => {
    expect(usablePreload(ready, 7, ready.waybill, NOW)).toBe(true);
  });
  it("never for another order, another consignment, or one still loading or failed", () => {
    expect(usablePreload(ready, 8, ready.waybill, NOW)).toBe(false);
    expect(usablePreload(ready, 7, "2026111303036990099999", NOW)).toBe(false);
    expect(usablePreload({ ...ready, state: "loading", loadedAt: 0 }, 7, ready.waybill, NOW)).toBe(false);
    expect(usablePreload({ ...ready, state: "failed" }, 7, ready.waybill, NOW)).toBe(false);
    expect(usablePreload(null, 7, ready.waybill, NOW)).toBe(false);
  });
  it("fetches fresh once it's 2 minutes old — an amended consignment can't print stale", () => {
    expect(usablePreload({ ...ready, loadedAt: NOW - LABEL_PRELOAD_MAX_AGE_MS + 1 }, 7, ready.waybill, NOW)).toBe(true);
    expect(usablePreload({ ...ready, loadedAt: NOW - LABEL_PRELOAD_MAX_AGE_MS }, 7, ready.waybill, NOW)).toBe(false);
  });
  it("stops refreshing after 10 quiet minutes", () => {
    expect(shouldRefreshPreload(ready, NOW)).toBe(true);
    expect(shouldRefreshPreload({ ...ready, firstPreparedAt: NOW - LABEL_PRELOAD_GIVE_UP_MS }, NOW)).toBe(false);
  });
});

describe("which order to prepare", () => {
  const wave = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  it("the first other order left, as Complete opens it", () => {
    expect(nextOrderToPrepare(wave, 1, new Set())?.id).toBe(2);
    expect(nextOrderToPrepare(wave, 3, new Set())?.id).toBe(1);
  });
  it("skips skipped orders; none left → nothing", () => {
    expect(nextOrderToPrepare(wave, 1, new Set([2, 3]))?.id).toBe(4);
    expect(nextOrderToPrepare([{ id: 1 }], 1, new Set())).toBeNull();
  });
  it("asks for piece 1 without telling APC it's printed", () => {
    const u = labelPreloadUrl("", "2026111303036990022684");
    expect(u).toMatch(/^\/api\/fulfilment\/shipments\/2026111303036990022684\/label\.pdf\?piece=1&preload=1&t=\d+$/);
    expect(u).not.toMatch(/print=1/);
  });
});
