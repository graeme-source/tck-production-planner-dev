import { describe, expect, it } from "vitest";
import {
  BY_HAND_HEADING, PUSH_HEADING, UNTRACKED_NOTE, buildF2fAdjustRequest, canRetryF2f, f2fEventKey, f2fPushDelta, f2fPushGate,
  f2fRowText, f2fSendOutcome, isF2fPushOn, needsConfirm, planF2fPushes, type PlanItemIn,
} from "./f2f-freezer-push-rules";

const philly: PlanItemIn = { recipeId: 1, recipeName: "Philly", packs: 4, planItemId: 10, f2f: { variantId: "111", title: "F2F - Philly Cheesesteak Calzones", variantTitle: "2 Pack" }, pushesOnWrap: false };
const beef: PlanItemIn = { recipeId: 42, recipeName: "Slow Birchstead Beef", packs: 3, planItemId: 11, f2f: null, pushesOnWrap: false };
const buns: PlanItemIn = { recipeId: 27, recipeName: "Cinnamon Buns", packs: 8, planItemId: 12, f2f: { variantId: "222", title: "F2F - Buns", variantTitle: null }, pushesOnWrap: true };

describe("isF2fPushOn", () => {
  it("off unless the setting is exactly 'true'", () => {
    expect(isF2fPushOn(null)).toBe(false);
    expect(isF2fPushOn(undefined)).toBe(false);
    expect(isF2fPushOn("false")).toBe(false);
    expect(isF2fPushOn("TRUE")).toBe(false);
    expect(isF2fPushOn("true")).toBe(true);
  });
});

describe("planF2fPushes — which items get pushed vs skipped", () => {
  it("switched off: nothing pushed, nothing to say — the move is as before", () => {
    const p = planF2fPushes({ enabled: false, source: "wonky", items: [philly, beef] });
    expect(p.push).toEqual([]);
    expect(p.skipped).toEqual([]);
    expect(needsConfirm(p)).toBe(false);
  });

  it("a recipe with an F2F product is pushed; one without is skipped and named", () => {
    const p = planF2fPushes({ enabled: true, source: "closing_check", items: [philly, beef] });
    expect(p.push.map(x => x.recipeId)).toEqual([1]);
    expect(p.push[0].line).toBe("+4 packs → F2F - Philly Cheesesteak Calzones · 2 Pack");
    expect(p.skipped).toEqual([{ recipeId: 42, recipeName: "Slow Birchstead Beef", packs: 3, planItemId: 11, reason: "no_f2f", line: "Slow Birchstead Beef: 3 packs" }]);
    expect(p.heading).toBe(PUSH_HEADING);
    expect(p.byHandHeading).toBe(BY_HAND_HEADING);
    expect(needsConfirm(p)).toBe(true);
  });

  it("only no-F2F items: nothing to confirm (the screen just says so)", () => {
    expect(needsConfirm(planF2fPushes({ enabled: true, source: "wonky", items: [beef] }))).toBe(false);
  });

  it("wonky packs go onto the same F2F product", () => {
    const p = planF2fPushes({ enabled: true, source: "wonky", items: [philly] });
    expect(p.push[0].f2f.variantId).toBe("111");
  });

  it("a wrap into the freezer for a recipe that pushes on wrap isn't sent twice", () => {
    const p = planF2fPushes({ enabled: true, source: "wrap_freezer", items: [buns] });
    expect(p.push).toEqual([]);
    expect(p.skipped[0].reason).toBe("own_push");
  });

  it("…but its wonkies and closing-check packs do go to its F2F product", () => {
    expect(planF2fPushes({ enabled: true, source: "wonky", items: [buns] }).push).toHaveLength(1);
    expect(planF2fPushes({ enabled: true, source: "closing_check", items: [buns] }).push).toHaveLength(1);
  });

  it("zero or junk packs are left out; one pack reads singular; Default Title is hidden", () => {
    const p = planF2fPushes({ enabled: true, source: "wonky", items: [{ ...philly, packs: 0 }, { ...philly, packs: Number.NaN }, { ...philly, packs: 1, f2f: { ...philly.f2f!, variantTitle: "Default Title" } }] });
    expect(p.push.map(x => x.line)).toEqual(["+1 pack → F2F - Philly Cheesesteak Calzones"]);
  });
});

describe("f2fPushGate", () => {
  const ok = { unlinkedCore: [], locationSet: true, legacyFreezerSyncOn: false };
  it("can turn on once every core recipe is linked", () => expect(f2fPushGate(ok)).toEqual({ canTurnOn: true, reasons: [] }));
  it("refuses while any core recipe is unlinked and names them", () => {
    const g = f2fPushGate({ ...ok, unlinkedCore: ["Slow Birchstead Beef", "Apple Crumble"] });
    expect(g.canTurnOn).toBe(false);
    expect(g.reasons[0]).toBe("2 core recipes have no F2F product yet: Apple Crumble, Slow Birchstead Beef.");
    expect(f2fPushGate({ ...ok, unlinkedCore: ["Slow Birchstead Beef"] }).reasons[0]).toMatch(/^1 core recipe has no F2F/);
  });
  it("refuses with no wrapping location", () => expect(f2fPushGate({ ...ok, locationSet: false }).canTurnOn).toBe(false));
  it("refuses while the old wrapping-complete upload is on (double count)", () => expect(f2fPushGate({ ...ok, legacyFreezerSyncOn: true }).reasons[0]).toMatch(/twice/));
});

describe("f2fEventKey — idempotency", () => {
  it("the same tap is the same key; a different tap, item or source is not", () => {
    const k = f2fEventKey("wrap_freezer", 10, "abcd1234-ef");
    expect(k).toBe("f2f:wrap_freezer:10:abcd1234-ef");
    expect(f2fEventKey("wrap_freezer", 10, "abcd1234-ef")).toBe(k);
    expect(f2fEventKey("wrap_freezer", 10, "zzzz1234-ef")).not.toBe(k);
    expect(f2fEventKey("wrap_freezer", 11, "abcd1234-ef")).not.toBe(k);
    expect(f2fEventKey("wonky", 10, "abcd1234-ef")).not.toBe(k);
  });
  it("can't collide with a wrap-to-Shopify key (those start with wrap:/take_back:)", () => {
    expect(f2fEventKey("wonky", 1, "abcd1234")).toMatch(/^f2f:/);
  });
  it("refuses junk ids", () => {
    expect(() => f2fEventKey("wonky", 1, "short")).toThrow();
    expect(() => f2fEventKey("wonky", 1, "has spaces in it")).toThrow();
    expect(() => f2fEventKey("wonky", 0, "abcd1234")).toThrow();
  });
});

describe("f2fPushDelta", () => {
  it("+N, refusing 0 / junk", () => {
    expect(f2fPushDelta(5)).toBe(5);
    expect(f2fPushDelta(5.9)).toBe(5);
    expect(() => f2fPushDelta(0)).toThrow();
    expect(() => f2fPushDelta(Number.NaN)).toThrow();
  });
});

describe("buildF2fAdjustRequest", () => {
  it("adds to available (on-hand moves the same) with the event key as Shopify's idempotency key", () => {
    const r = buildF2fAdjustRequest({ eventKey: "f2f:wonky:10:abcd1234", delta: 4, inventoryItemGid: "gid://shopify/InventoryItem/1", locationGid: "gid://shopify/Location/2" });
    expect(r.query).toMatch(/@idempotent\(key: \$key\)/);
    expect(r.variables).toEqual({
      key: "f2f:wonky:10:abcd1234",
      input: {
        name: "available", reason: "received",
        referenceDocumentUri: "gid://tck-production-planner/F2fFreezerMove/f2f%3Awonky%3A10%3Aabcd1234",
        changes: [{ delta: 4, inventoryItemId: "gid://shopify/InventoryItem/1", locationId: "gid://shopify/Location/2" }],
      },
    });
  });
  it("refuses a zero change", () => expect(() => buildF2fAdjustRequest({ eventKey: "k", delta: 0, inventoryItemGid: "i", locationGid: "l" })).toThrow());
});

describe("f2fSendOutcome — untracked is skipped, never failed", () => {
  it("tracked and accepted → sent", () => expect(f2fSendOutcome(true, { ok: true, quantityAfter: 9 })).toEqual({ status: "sent", quantityAfter: 9, note: null }));
  it("untracked but accepted → sent, with a note", () => expect(f2fSendOutcome(false, { ok: true, quantityAfter: null })).toEqual({ status: "sent", quantityAfter: null, note: UNTRACKED_NOTE }));
  it("untracked and refused → skipped (untracked)", () => {
    const o = f2fSendOutcome(false, { ok: false, error: "not stocked" });
    expect(o.status).toBe("skipped");
    expect(o.status === "skipped" && o.skipReason).toBe("untracked");
  });
  it("tracked and refused → failed", () => expect(f2fSendOutcome(true, { ok: false, error: "nope" })).toEqual({ status: "failed", error: "nope" }));
});

describe("canRetryF2f", () => {
  it("failed and untracked-skipped only", () => {
    expect(canRetryF2f("failed", null)).toBe(true);
    expect(canRetryF2f("skipped", "untracked")).toBe(true);
    expect(canRetryF2f("skipped", "writes_off")).toBe(false);
    expect(canRetryF2f("sent", null)).toBe(false);
    expect(canRetryF2f("sending", null)).toBe(false);
    expect(canRetryF2f("pending", null)).toBe(false);
  });
});

describe("f2fRowText", () => {
  const row = { delta: 4, productTitle: "F2F - Philly", error: null, skipReason: null, note: null } as const;
  it("says plainly what happened", () => {
    expect(f2fRowText({ ...row, status: "sent" }).text).toBe("+4 → F2F - Philly in Shopify ✓");
    expect(f2fRowText({ ...row, status: "failed", error: "timeout" }).text).toMatch(/failed — timeout\. A manager can retry it\./);
    expect(f2fRowText({ ...row, status: "skipped", skipReason: "writes_off" }).text).toMatch(/switched off on this server/);
    expect(f2fRowText({ ...row, status: "sending" }).tone).toBe("busy");
  });
});
