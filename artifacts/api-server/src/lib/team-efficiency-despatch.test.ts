import { describe, it, expect } from "vitest";
import { deliveryDateTag, despatchDay, despatchByDay, type OrderInput, type RecipeInput } from "./team-efficiency-despatch";

const recipes = new Map<number, RecipeInput>([
  [1, { id: 1, category: "Line A", packSize: 2, rrp: 12 }],
  [2, { id: 2, category: "Line B", packSize: 1, rrp: 15 }],
  [3, { id: 3, category: null, packSize: 1, rrp: 4 }],
]);
const byVariant = new Map([["111", 1], ["222", 2], ["333", 3]]);
const byTitle = new Map([["the margherita", 1]]);

const order = (p: Partial<OrderInput>): OrderInput => ({
  tags: "2026-09-23, dispatch", fulfillmentStatus: "fulfilled", cancelledAt: null, lineItems: [], ...p,
});

describe("despatch day", () => {
  it("reads the delivery-date tag", () => {
    expect(deliveryDateTag("Small Box, 2026-09-23, dispatch")).toBe("2026-09-23");
    expect(deliveryDateTag("dispatch")).toBeNull();
    expect(deliveryDateTag(null)).toBeNull();
  });
  it("is the day before delivery for courier orders", () => {
    expect(despatchDay("2026-09-01, dispatch")).toBe("2026-08-31");
  });
  it("is the tagged day itself for collections", () => {
    expect(despatchDay("2026-09-23, Collection")).toBe("2026-09-23");
  });
});

describe("despatchByDay", () => {
  it("values mapped packs at RRP and 8-pack bags as 8 ÷ pack size packs", () => {
    const out = despatchByDay([
      order({ lineItems: [
        { variantId: "111", variantTitle: "2 Pack", title: "The Margherita", quantity: 3 },
        { variantId: "999", variantTitle: "8 Pack Bag", title: "The Margherita", quantity: 2 },
        { variantId: "222", variantTitle: "500g", title: "Chicken", quantity: 1 },
        { variantId: "333", variantTitle: null, title: "Sauce", quantity: 5 },   // no line
        { variantId: "444", variantTitle: null, title: "Merch", quantity: 1 },   // unmapped
      ] }),
    ], byVariant, byTitle, recipes);
    const d = out.get("2026-09-22")!;
    expect(d.orders).toBe(1);
    expect(d.lines["Line A"]).toEqual({ packs: 3, gross: 36, bagPacks: 8, bagGross: 96 });
    expect(d.lines["Line B"]).toEqual({ packs: 1, gross: 15, bagPacks: 0, bagGross: 0 });
    expect(Object.keys(d.lines)).toHaveLength(2);
  });

  it("skips unfulfilled, cancelled and untagged orders", () => {
    const li = [{ variantId: "111", variantTitle: null, title: null, quantity: 1 }];
    const out = despatchByDay([
      order({ fulfillmentStatus: null, lineItems: li }),
      order({ fulfillmentStatus: "partial", lineItems: li }),
      order({ cancelledAt: "2026-09-21T10:00:00Z", lineItems: li }),
      order({ tags: "dispatch", lineItems: li }),
    ], byVariant, byTitle, recipes);
    expect(out.size).toBe(0);
  });

  it("counts an order even when none of its lines are ours", () => {
    const out = despatchByDay([order({ lineItems: [{ variantId: "444", variantTitle: null, title: null, quantity: 1 }] })],
      byVariant, byTitle, recipes);
    expect(out.get("2026-09-22")!.orders).toBe(1);
  });
});
