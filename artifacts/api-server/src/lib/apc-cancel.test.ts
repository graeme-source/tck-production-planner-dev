import { describe, expect, it } from "vitest";
import { buildCancelRequest, interpretCancelReply } from "./apc-cancel";

describe("APC cancel (guide v3.1.2 section 7; the old code sent an undocumented DELETE)", () => {
  it("is a PUT with the CancelOrder body, searched by carrier waybill", () => {
    const r = buildCancelRequest("https://apc.hypaship.com/api/3.0/", "2026100703036990019775");
    expect(r.method).toBe("PUT");
    expect(r.url).toBe("https://apc.hypaship.com/api/3.0/Orders/2026100703036990019775.json?searchtype=CarrierWaybill");
    expect(JSON.parse(r.body)).toEqual({ CancelOrder: { Order: { Status: "CANCELLED" } } });
  });
  it("treats code 121 'Order Cancelled' as success", () => {
    expect(interpretCancelReply(200, JSON.stringify({ CancelOrder: { AccountNumber: "TCK001", Messages: { Code: "121", Description: "Order Cancelled" } } }))).toEqual({ ok: true });
  });
  it("reports APC's reason when it refuses", () => {
    const r = interpretCancelReply(400, JSON.stringify({ CancelOrder: { Messages: { Code: "117", Description: "Order already collected" } } }));
    expect(r).toEqual({ ok: false, error: "APC cancel failed (400): Order already collected" });
  });
  it("a 2xx with a non-cancel message is not success", () => {
    const r = interpretCancelReply(200, JSON.stringify({ CancelOrder: { Messages: { Code: "105", Description: "Order not found" } } }));
    expect(r.ok).toBe(false);
  });
});
