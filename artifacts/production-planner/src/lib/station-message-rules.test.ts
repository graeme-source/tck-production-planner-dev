import { describe, it, expect } from "vitest";
import { routeStationMessages } from "./station-message-rules";

const msg = (id: number, createdAt: string, requiresAck?: boolean) => ({ id, createdAt, requiresAck });

describe("routeStationMessages", () => {
  it("keeps ordinary messages as banners and blocks nothing", () => {
    const routed = routeStationMessages([msg(1, "2026-09-15T08:00:00Z"), msg(2, "2026-09-15T09:00:00Z")]);
    expect(routed.blocking).toBeNull();
    expect(routed.blockedQueue).toEqual([]);
    expect(routed.banners.map(m => m.id)).toEqual([1, 2]);
  });

  it("routes a must-acknowledge message to blocking, not the banners", () => {
    const routed = routeStationMessages([msg(1, "2026-09-15T08:00:00Z"), msg(2, "2026-09-15T09:00:00Z", true)]);
    expect(routed.blocking?.id).toBe(2);
    expect(routed.banners.map(m => m.id)).toEqual([1]);
  });

  it("shows the OLDEST unconfirmed must-acknowledge message first and queues the rest", () => {
    // The server returns newest-first; confirmation order must still be
    // send order, so nobody actions instruction 2 before instruction 1.
    const routed = routeStationMessages([
      msg(3, "2026-09-15T11:00:00Z", true),
      msg(2, "2026-09-15T10:00:00Z", true),
      msg(1, "2026-09-15T09:00:00Z", true),
    ]);
    expect(routed.blocking?.id).toBe(1);
    expect(routed.blockedQueue.map(m => m.id)).toEqual([2, 3]);
    expect(routed.banners).toEqual([]);
  });

  it("treats a missing requiresAck flag as an ordinary banner", () => {
    const routed = routeStationMessages([msg(1, "2026-09-15T08:00:00Z", undefined)]);
    expect(routed.blocking).toBeNull();
    expect(routed.banners.map(m => m.id)).toEqual([1]);
  });

  it("handles an empty list", () => {
    const routed = routeStationMessages([]);
    expect(routed.blocking).toBeNull();
    expect(routed.blockedQueue).toEqual([]);
    expect(routed.banners).toEqual([]);
  });
});
