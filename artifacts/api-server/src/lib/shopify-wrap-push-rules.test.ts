import { describe, it, expect } from "vitest";
import {
  wrapEventKey, wrapPushDelta, locationGid, variantGid,
  buildInventoryAdjustRequest, parseInventoryAdjustResponse, canRetry, itemShopifyState,
  INVENTORY_ADJUST_MUTATION, STUCK_SENDING_MS, type WrapPushRow,
} from "./shopify-wrap-push-rules";

describe("event keys and deltas", () => {
  it("one key per tap, kind and item in it", () => {
    expect(wrapEventKey("wrap", 812, "3f2b9c1a-77aa")).toBe("wrap:812:3f2b9c1a-77aa");
    expect(wrapEventKey("take_back", 812, "abcdefgh")).toBe("take_back:812:abcdefgh");
  });
  it("refuses an unsafe client id", () => {
    expect(() => wrapEventKey("wrap", 1, "short")).toThrow();
    expect(() => wrapEventKey("wrap", 1, "has space in it")).toThrow();
  });
  it("wrap is +N, take-back is −N, zero is refused", () => {
    expect(wrapPushDelta("wrap", 8)).toBe(8);
    expect(wrapPushDelta("take_back", 8)).toBe(-8);
    expect(() => wrapPushDelta("wrap", 0)).toThrow();
    expect(() => wrapPushDelta("wrap", Number.NaN)).toThrow();
  });
});

describe("pinned location", () => {
  it("accepts a GID or a numeric id, nothing else", () => {
    expect(locationGid("gid://shopify/Location/30144839")).toBe("gid://shopify/Location/30144839");
    expect(locationGid(" 30144839 ")).toBe("gid://shopify/Location/30144839");
    expect(locationGid("")).toBeNull();
    expect(locationGid(null)).toBeNull();
    expect(locationGid("gid://shopify/Product/1")).toBeNull();
  });
  it("variant ids become GIDs", () => {
    expect(variantGid("55574675816822")).toBe("gid://shopify/ProductVariant/55574675816822");
  });
});

describe("the Shopify request", () => {
  const base = {
    eventKey: "wrap:812:3f2b9c1a-77aa",
    inventoryItemGid: "gid://shopify/InventoryItem/54001980637558",
    locationGid: "gid://shopify/Location/30144839",
  };
  it("a wrap adds to 'available' at the pinned location, received, with the event as idempotency key", () => {
    const req = buildInventoryAdjustRequest({ ...base, kind: "wrap", delta: 8 });
    expect(req.query).toBe(INVENTORY_ADJUST_MUTATION);
    expect(req.query).toContain("@idempotent(key: $key)");
    expect(req.variables).toEqual({
      key: "wrap:812:3f2b9c1a-77aa",
      input: {
        name: "available",
        reason: "received",
        referenceDocumentUri: "gid://tck-production-planner/WrapEvent/wrap%3A812%3A3f2b9c1a-77aa",
        changes: [{ delta: 8, inventoryItemId: base.inventoryItemGid, locationId: base.locationGid }],
      },
    });
  });
  it("a take-back is a correction with a negative delta", () => {
    const req = buildInventoryAdjustRequest({ ...base, eventKey: "take_back:812:zzzzzzzz", kind: "take_back", delta: -8 });
    const input = req.variables.input as { reason: string; changes: Array<{ delta: number }> };
    expect(input.reason).toBe("correction");
    expect(input.changes[0].delta).toBe(-8);
  });
  it("never builds an empty change", () => {
    expect(() => buildInventoryAdjustRequest({ ...base, kind: "wrap", delta: 0 })).toThrow();
  });
});

describe("reading Shopify's answer", () => {
  it("sent, with the figure after the change", () => {
    expect(parseInventoryAdjustResponse({
      inventoryAdjustQuantities: {
        inventoryAdjustmentGroup: { id: "gid://shopify/InventoryAdjustmentGroup/1", changes: [{ name: "available", delta: 8, quantityAfterChange: 19 }, { name: "on_hand", delta: 8, quantityAfterChange: 43 }] },
        userErrors: [],
      },
    })).toEqual({ ok: true, quantityAfter: 19 });
  });
  it("user errors are failures, with Shopify's words", () => {
    expect(parseInventoryAdjustResponse({
      inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: ["input"], message: "The specified location could not be found", code: "INVALID_LOCATION" }] },
    })).toEqual({ ok: false, error: "The specified location could not be found (INVALID_LOCATION)" });
  });
  it("an empty answer is a failure, never a success", () => {
    expect(parseInventoryAdjustResponse({}).ok).toBe(false);
    expect(parseInventoryAdjustResponse({ inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [] } }).ok).toBe(false);
  });
});

describe("retry and what the wrapping screen says", () => {
  const at = new Date("2026-10-16T10:00:00Z").getTime();
  const row = (p: Partial<WrapPushRow>): WrapPushRow => ({
    id: 1, planItemId: 812, kind: "wrap", delta: 8, status: "sent", error: null, updatedAt: new Date(at), ...p,
  });

  it("only failed pushes can be retried", () => {
    expect(canRetry("failed")).toBe(true);
    for (const s of ["pending", "sending", "sent", "skipped"] as const) expect(canRetry(s)).toBe(false);
  });
  it("+16 sent ✓ after two wraps, net of a take-back", () => {
    expect(itemShopifyState([row({ id: 1 }), row({ id: 2 }), row({ id: 3, kind: "take_back", delta: -8 })], at))
      .toEqual({ state: "ok", sentPacks: 8 });
  });
  it("a failure wins and says which pushes to retry", () => {
    const s = itemShopifyState([row({ id: 1 }), row({ id: 2, status: "failed", error: "Throttled" })], at);
    expect(s).toEqual({ state: "failed", failedIds: [2], failedPacks: 8, error: "Throttled", sentPacks: 8 });
  });
  it("writes switched off on this server: skipped, not success", () => {
    expect(itemShopifyState([row({ status: "skipped" })], at)).toEqual({ state: "skipped", packs: 8 });
  });
  it("a send stuck for minutes is unknown — check Shopify, don't resend", () => {
    expect(itemShopifyState([row({ status: "sending", updatedAt: new Date(at - STUCK_SENDING_MS - 1) })], at))
      .toEqual({ state: "stuck", ids: [1] });
    expect(itemShopifyState([row({ status: "sending" })], at)).toEqual({ state: "sending", packs: 8 });
  });
  it("nothing yet", () => {
    expect(itemShopifyState([], at)).toEqual({ state: "none" });
  });
});
