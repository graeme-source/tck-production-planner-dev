import { describe, expect, it } from "vitest";
import { firstDateTag, isProcessedOrder } from "./wholesale-order-tags";

describe("which wholesale / 8-pack orders still need processing", () => {
  it("#138553: 'production' copied onto a draft order with no delivery date → NOT processed (shows on the dashboard)", () => {
    expect(isProcessedOrder("Large Box, Local Delivery, production, wholesale, wholesale-vip")).toBe(false);
  });
  it("processed by the dashboard: delivery date + production → processed", () => {
    expect(isProcessedOrder("2026-09-18, dispatch, Large Box, Local Delivery, production, wholesale, wholesale-vip")).toBe(true);
  });
  it("retail 8-pack order with the checkout date but no production → NOT processed (bags still to plan)", () => {
    expect(isProcessedOrder("2026-11-06, Friday, Small Box")).toBe(false);
  });
  it("capital-P Production counts the same", () => {
    expect(isProcessedOrder("2026-05-13, Production, wholesale")).toBe(true);
  });
  it("no tags → not processed", () => {
    expect(isProcessedOrder("")).toBe(false);
    expect(isProcessedOrder(null)).toBe(false);
  });
  it("reads the first date tag", () => expect(firstDateTag("wholesale, 2026-11-04, production")).toBe("2026-11-04"));
});
