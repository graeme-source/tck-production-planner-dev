import { describe, it, expect } from "vitest";
import { packingDeliveryTag, packingPace, packingPaceFromOrders, packingTimestamps } from "./packing-orders-per-hour";

const t = (hhmm: string) => `2026-11-25T${hhmm}:00Z`;
const order = (hhmm: string, over: Record<string, unknown> = {}) => ({
  fulfillment_status: "fulfilled",
  created_at: t("06:00"),
  fulfillments: [{ status: "success", created_at: t(hhmm) }],
  ...over,
});

describe("packing orders per hour", () => {
  it("reads the delivery day's tag, whatever the server's timezone", () => {
    expect(packingDeliveryTag("2026-07-01")).toBe("2026-07-02");
    expect(packingDeliveryTag("2026-10-24")).toBe("2026-10-25"); // clocks go back overnight
    expect(packingDeliveryTag("2026-12-31")).toBe("2027-01-01");
  });

  it("counts fulfilled orders only, at their successful fulfilment times", () => {
    const orders = [
      order("09:00"),
      order("09:05", { fulfillments: [{ status: "cancelled", created_at: t("08:00") }, { status: "success", created_at: t("09:05") }] }),
      order("09:10", { fulfillment_status: "partial" }),
      { fulfillment_status: "fulfilled", created_at: t("09:20"), fulfillments: [] },
    ];
    const pace = packingPaceFromOrders(orders);
    expect(pace.totalOrders).toBe(3);
    expect(pace.firstAt).toBe(new Date(t("09:00")).getTime());
    expect(pace.lastAt).toBe(new Date(t("09:20")).getTime());
  });

  it("takes gaps over 10 minutes out of the window", () => {
    // 09:00 → 10:00 with one 30-minute stop: 30 active minutes.
    const ts = ["09:00", "09:10", "09:20", "09:30", "10:00"].map(h => new Date(t(h)).getTime());
    const pace = packingPace(5, ts);
    expect(pace.idleBreaks).toBe(1);
    expect(pace.activeMinutes).toBe(30);
    expect(pace.ordersPerHour).toBe(10);
  });

  it("gives no rate for under a minute of packing", () => {
    expect(packingPace(2, [0, 30_000]).ordersPerHour).toBeNull();
    expect(packingPace(0, []).ordersPerHour).toBeNull();
    expect(packingTimestamps([])).toEqual([]);
  });
});
