import { describe, it, expect } from "vitest";
import { parseStockSendRecord, alreadySentMessage, stockSendKey } from "./fried-chicken-stock-send-rules";

describe("fried chicken stock send record", () => {
  it("keeps the same app_settings key as the live records", () => {
    // Live plan 192 was sent under this key on 12 Oct 2026 — changing it would
    // make that send invisible and let it go again.
    expect(stockSendKey(192)).toBe("fried_chicken_stock_submitted_192");
  });

  it("reads a record written before 12 Oct (no status) as a finished send", () => {
    expect(parseStockSendRecord('{"at":"2026-10-12T15:24:16.614Z","by":2,"bags":155}')).toEqual({
      at: "2026-10-12T15:24:16.614Z", by: 2, bags: 155, status: "sent",
    });
  });

  it("reads an in-progress claim as sending", () => {
    expect(parseStockSendRecord('{"at":"2026-10-12T15:24:00.000Z","by":2,"bags":0,"status":"sending"}')?.status)
      .toBe("sending");
  });

  it("no record means not sent", () => {
    expect(parseStockSendRecord(null)).toBeNull();
    expect(parseStockSendRecord("")).toBeNull();
  });

  it("an unreadable record still blocks a second send rather than allowing one", () => {
    // Regression: the old reader returned null for a damaged value, which
    // would have let the stock be added a second time.
    expect(parseStockSendRecord("not json")).not.toBeNull();
    expect(parseStockSendRecord('{"bags":3}')).not.toBeNull();
  });

  it("says it only goes once, and where to correct it", () => {
    const msg = alreadySentMessage({ at: "x", by: null, bags: 155, status: "sent" });
    expect(msg).toMatch(/already been sent/);
    expect(msg).toMatch(/Shopify/);
    expect(msg).not.toMatch(/again anyway|add them on top/);
    expect(alreadySentMessage({ at: "x", by: null, bags: 0, status: "sending" })).toMatch(/in progress/);
  });
});
