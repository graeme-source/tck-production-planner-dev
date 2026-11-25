import { describe, expect, it, vi } from "vitest";

// The live port imports services/shopify, which reads env vars at load;
// these tests never touch it — every call goes to the fake store below.
vi.mock("../services/shopify", () => ({
  shopifyGraphQL: vi.fn(), shopifyGraphQLWrite: vi.fn(), shopifyWritesBlocked: vi.fn(() => true),
  ShopifyWritesBlockedError: class extends Error {},
}));

import { applyF2fProduct, type F2fApplyInput } from "./f2f-product-shopify";
import type { ShopifyPort } from "./test-box-shopify";
import { f2fTagsFromMain } from "./f2f-product-rules";

const LOC = "gid://shopify/Location/77";

function fakeStore(opts: { tracked?: boolean; onHand?: number; stockedAtLoc?: boolean; manual?: boolean; blocked?: boolean } = {}) {
  const writes: Array<{ op: string; vars: Record<string, unknown> | undefined }> = [];
  const port: ShopifyPort = {
    async read<T>(): Promise<T> {
      return {
        product: {
          id: "gid://shopify/Product/500", title: "F2F - Philly", status: "DRAFT",
          collections: { nodes: [
            ...(opts.manual ? [{ id: "gid://shopify/Collection/1", title: "Best sellers", ruleSet: null }] : []),
            { id: "gid://shopify/Collection/2", title: "F2F - Freezer to Fridge stock", ruleSet: { appliedDisjunctively: false } },
          ] },
          variants: { nodes: [{
            id: "gid://shopify/ProductVariant/900", title: "2 Pack", price: "17.95",
            inventoryItem: {
              id: "gid://shopify/InventoryItem/42", tracked: opts.tracked ?? false,
              inventoryLevels: { nodes: opts.stockedAtLoc === false ? [] : [{ location: { id: LOC }, quantities: [{ name: "on_hand", quantity: opts.onHand ?? 0 }] }] },
            },
          }] },
        },
      } as T;
    },
    async write<T>(op: string, _q: string, vars?: Record<string, unknown>): Promise<T> {
      if (opts.blocked) throw new Error("blocked");
      writes.push({ op, vars });
      const ok = { userErrors: [] };
      if (op === "productDuplicate") return { productDuplicate: { newProduct: { id: "gid://shopify/Product/500" }, ...ok } } as T;
      return { [op]: ok } as T;
    },
  };
  return { port, writes };
}

const input = (over: Partial<F2fApplyInput> = {}): F2fApplyInput => ({
  mainProductId: "100", existingProductId: null, title: "F2F - Philly",
  tags: f2fTagsFromMain(["Meals", "calzones", "wholesale-g", "BBQ"]).tags, productType: "", locationGid: LOC, ...over,
});

describe("applyF2fProduct", () => {
  it("duplicates as a draft, sets the F2F tags, tracks stock at 0, and only then sets Active", async () => {
    const { port, writes } = fakeStore({ tracked: false, onHand: 3, manual: true });
    const stored: string[] = [];
    const res = await applyF2fProduct(port, input(), async id => { stored.push(id); });
    expect(stored).toEqual(["500"]);
    expect(writes.map(w => w.op)).toEqual([
      "productDuplicate", "productUpdate", "collectionRemoveProducts", "inventoryItemUpdate", "inventoryAdjustQuantities", "productUpdate",
    ]);
    expect(writes[0].vars).toMatchObject({ productId: "gid://shopify/Product/100", newTitle: "F2F - Philly" });
    const tags = (writes[1].vars as { product: { tags: string[]; productType: string } }).product;
    expect(tags.tags).toEqual(["Clearance", "F2F", "show", "Wonkyzone", "no-wholesale", "BBQ"]);
    expect(tags.tags).not.toContain("Meals");
    expect(tags.productType).toBe("");
    expect(writes[2].vars).toMatchObject({ id: "gid://shopify/Collection/1" }); // the manual one only
    const adj = writes[4].vars as { key: string; input: { changes: Array<{ delta: number }> } };
    expect(adj.input.changes[0].delta).toBe(-3);
    expect(adj.key).toBe("f2f-create-zero:900:77:-3");
    expect(writes[5].vars).toEqual({ product: { id: "gid://shopify/Product/500", status: "ACTIVE" } });
    expect(res.variants).toEqual([{ id: "900", title: "2 Pack", price: "17.95" }]);
  });

  it("a tracked, zero-stock copy in no manual collection needs no stock writes", async () => {
    const { port, writes } = fakeStore({ tracked: true, onHand: 0 });
    await applyF2fProduct(port, input(), async () => {});
    expect(writes.map(w => w.op)).toEqual(["productDuplicate", "productUpdate", "productUpdate"]);
  });

  it("stocks it at the wrapping location when it isn't there", async () => {
    const { port, writes } = fakeStore({ tracked: true, stockedAtLoc: false });
    await applyF2fProduct(port, input(), async () => {});
    expect(writes.map(w => w.op)).toContain("inventoryActivate");
  });

  it("a re-run finishes the product already made — never duplicates again", async () => {
    const { port, writes } = fakeStore({ tracked: true });
    const stored: string[] = [];
    const res = await applyF2fProduct(port, input({ existingProductId: "500" }), async id => { stored.push(id); });
    expect(writes.map(w => w.op)).not.toContain("productDuplicate");
    expect(stored).toEqual([]);
    expect(res.productId).toBe("500");
  });

  it("writes switched off: the first write stops the run and nothing is stored", async () => {
    const { port } = fakeStore({ blocked: true });
    const stored: string[] = [];
    await expect(applyF2fProduct(port, input(), async id => { stored.push(id); })).rejects.toThrow("blocked");
    expect(stored).toEqual([]);
  });
});
