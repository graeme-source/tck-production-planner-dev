import { describe, it, expect } from "vitest";
import { minutesUntil, settlingMessage, nextReleaseAt } from "./settling-orders";

const NOW = Date.parse("2026-11-13T09:28:00Z");
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

describe("held-back new orders on the packing card", () => {
  it("one order: says exactly how long (#139679 placed 09:21:38 → on at 09:36:38)", () => {
    expect(settlingMessage([{ orderId: 1, name: "#139679", releasesAt: "2026-11-13T09:36:38Z" }], NOW))
      .toBe("1 new order held back — on the list in 9 min");
  });
  it("several: counts them and gives the first", () => {
    expect(settlingMessage([
      { orderId: 1, name: "#1", releasesAt: at(3) },
      { orderId: 2, name: "#2", releasesAt: at(12) },
    ], NOW)).toBe("2 new orders held back — the first comes on in 3 min");
  });
  it("never says 0 min while still held; nothing once released", () => {
    expect(minutesUntil(at(0.2), NOW)).toBe(1);
    expect(settlingMessage([{ orderId: 1, name: "#1", releasesAt: at(-0.1) }], NOW)).toBeNull();
    expect(settlingMessage([], NOW)).toBeNull();
    expect(settlingMessage(undefined, NOW)).toBeNull();
  });
  it("reloads the list at the soonest release still to come", () => {
    expect(nextReleaseAt([{ orderId: 1, name: "#1", releasesAt: at(12) }, { orderId: 2, name: "#2", releasesAt: at(3) }], NOW)).toBe(NOW + 3 * 60_000);
    expect(nextReleaseAt([{ orderId: 1, name: "#1", releasesAt: at(-1) }], NOW)).toBeNull();
  });
});
