import { describe, expect, it, vi } from "vitest";

// The live port imports services/shopify, which reads env vars at load;
// these tests never touch it — every call goes to the fake store below.
vi.mock("../services/shopify", () => ({ shopifyGraphQL: vi.fn(), shopifyGraphQLWrite: vi.fn() }));

import { applyRecipeProduct, createBoxCollection, createDiscountCode, type ApplyInput, type ShopifyPort } from "./test-box-shopify";
import { MF } from "./test-box-shopify-rules";

class BlockedError extends Error {}

/** A fake store: records every write; reads return the "duplicated" product. */
function fakeStore(opts: { blocked?: boolean } = {}) {
  const writes: Array<{ op: string; vars: Record<string, unknown> | undefined }> = [];
  const port: ShopifyPort = {
    async read<T>(query: string): Promise<T> {
      if (query.includes("nodes(ids")) {
        return {
          nodes: [{
            id: "gid://shopify/Product/500", title: "Philly copy", handle: "x", status: "DRAFT", tags: ["Summer Test Box"], productType: "",
            media: { nodes: [{ id: "m1" }] }, featuredMedia: null,
            variants: { nodes: [{ id: "gid://shopify/ProductVariant/900", title: "2 Pack", price: "17.95", sku: null, barcode: "5065018206399" }] },
            metafields: { nodes: [
              { ...MF.nutrition, value: "gid://shopify/MediaImage/1" },
              { ...MF.cooking, value: '{"type":"root","children":[]}' },
            ] },
          }],
        } as T;
      }
      throw new Error(`unexpected read: ${query}`);
    },
    async write<T>(op: string, _query: string, vars?: Record<string, unknown>): Promise<T> {
      if (opts.blocked) throw new BlockedError("Shopify writes are switched off");
      writes.push({ op, vars });
      const ok = { userErrors: [] };
      if (op === "productDuplicate") return { productDuplicate: { ...ok, newProduct: { id: "gid://shopify/Product/500" } } } as T;
      if (op === "collectionCreate") return { collectionCreate: { ...ok, collection: { id: "gid://shopify/Collection/77" } } } as T;
      return { [op]: ok } as T;
    },
  };
  return { port, writes };
}

const input: ApplyInput = {
  action: "create",
  templateProductId: "9089721336087",
  existingProductId: null,
  title: "Properoni CarniZone",
  tags: ["show", "no-wholesale", "calzones", "Properoni Test Box"],
  descriptionHtml: "<p>Meat</p>",
  includeImages: true,
  content: { description: "Meat", packSize: 2, deckDocument: '{"type":"root"}', deckSummary: "Dough" },
  standardCooking: "STD",
};

describe("making one recipe's product (fake store, no network)", () => {
  it("duplicates as a draft, stores the id first, then title/tags, blank barcode, metafields", async () => {
    const { port, writes } = fakeStore();
    const order: string[] = [];
    const stored = vi.fn(async (id: string) => { order.push(`stored ${id}`); });
    const r = await applyRecipeProduct(port, input, async id => { await stored(id); order.push(...writes.map(w => w.op)); });

    expect(writes.map(w => w.op)).toEqual(["productDuplicate", "productUpdate", "productVariantsBulkUpdate", "metafieldsDelete", "metafieldsSet"]);
    expect(order).toEqual(["stored 500", "productDuplicate"]); // stored before anything else was written
    expect(writes[0].vars).toMatchObject({ productId: "gid://shopify/Product/9089721336087", newTitle: "Properoni CarniZone", includeImages: true });
    expect(writes[1].vars).toMatchObject({ product: { status: "DRAFT", tags: input.tags, title: "Properoni CarniZone" } });
    expect(writes[2].vars).toMatchObject({ variants: [{ id: "gid://shopify/ProductVariant/900", barcode: null }] });
    expect(JSON.stringify(writes[3].vars)).toContain("nutritional_info");
    expect(r).toMatchObject({ productId: "500", status: "DRAFT", variants: [{ id: "900", title: "2 Pack" }] });
  });

  it("can leave the images behind", async () => {
    const { port, writes } = fakeStore();
    await applyRecipeProduct(port, { ...input, includeImages: false }, async () => {});
    expect(writes[0].vars).toMatchObject({ includeImages: false });
  });

  it("a re-run updates the existing product: no duplicate, no status change, barcodes untouched", async () => {
    const { port, writes } = fakeStore();
    const stored = vi.fn();
    await applyRecipeProduct(port, { ...input, action: "update", existingProductId: "500" }, stored);
    expect(stored).not.toHaveBeenCalled();
    expect(writes.map(w => w.op)).not.toContain("productDuplicate");
    expect(writes.map(w => w.op)).not.toContain("productVariantsBulkUpdate");
    expect((writes.find(w => w.op === "productUpdate")!.vars as { product: Record<string, unknown> }).product).not.toHaveProperty("status");
  });

  it("with Shopify writes blocked, the guard stops it at the first write and nothing is stored", async () => {
    const { port, writes } = fakeStore({ blocked: true });
    const stored = vi.fn();
    await expect(applyRecipeProduct(port, input, stored)).rejects.toThrow("switched off");
    expect(writes).toHaveLength(0);
    expect(stored).not.toHaveBeenCalled();
  });

  it("Shopify's refusal is reported, not swallowed", async () => {
    const { port } = fakeStore();
    port.write = async <T,>() => ({ productDuplicate: { newProduct: null, userErrors: [{ message: "Access denied" }] } }) as T;
    await expect(applyRecipeProduct(port, input, async () => {})).rejects.toThrow("Access denied");
  });
});

describe("the discount code", () => {
  it("reports a code Shopify already has as 'taken' (so a new one is generated), other refusals as errors", async () => {
    const port: ShopifyPort = {
      read: async <T,>() => ({}) as T,
      write: async <T,>() => ({ discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ code: "TAKEN", message: "Code must be unique" }] } }) as T,
    };
    expect(await createDiscountCode(port, {})).toBe("taken");
    port.write = async <T,>() => ({ discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ code: "INVALID", message: "Access denied" }] } }) as T;
    await expect(createDiscountCode(port, {})).rejects.toThrow("Access denied");
    port.write = async <T,>() => ({ discountCodeBasicCreate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/42" }, userErrors: [] } }) as T;
    expect(await createDiscountCode(port, {})).toEqual({ id: "42" });
  });

  it("is a write — blocked writes never reach Shopify", async () => {
    const { port, writes } = fakeStore({ blocked: true });
    await expect(createDiscountCode(port, {})).rejects.toThrow("switched off");
    expect(writes).toHaveLength(0);
  });
});

describe("the box's collection", () => {
  it("is a smart collection: tag equals the box name", async () => {
    const { port, writes } = fakeStore();
    const id = await createBoxCollection(port, { title: "Properoni Test Box", rule: { column: "TAG", relation: "EQUALS", condition: "Properoni Test Box" }, sortOrder: "BEST_SELLING", templateSuffix: null });
    expect(id).toBe("77");
    expect(writes[0].vars).toEqual({
      input: { title: "Properoni Test Box", sortOrder: "BEST_SELLING", ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: "Properoni Test Box" }] } },
    });
  });
});
