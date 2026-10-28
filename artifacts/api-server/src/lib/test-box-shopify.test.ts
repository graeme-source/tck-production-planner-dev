import { describe, expect, it, vi } from "vitest";

// The live port imports services/shopify, which reads env vars at load;
// these tests never touch it — every call goes to the fake store below.
vi.mock("../services/shopify", () => ({
  shopifyGraphQL: vi.fn(), shopifyGraphQLWrite: vi.fn(), shopifyWritesBlocked: vi.fn(() => true),
  ShopifyWritesBlockedError: class extends Error {},
}));

import {
  applyRecipeProduct, createBoxCollection, createDiscountCode,
  type ApplyInput, type FileDeps, type ShopifyPort, type StagedTarget,
} from "./test-box-shopify";
import { MF } from "./test-box-shopify-rules";

class BlockedError extends Error {}

/** A fake store: records every write; reads return the "duplicated" product. */
function fakeStore(opts: { blocked?: boolean; fileStatuses?: string[]; fileCreateErrors?: string[] } = {}) {
  const writes: Array<{ op: string; vars: Record<string, unknown> | undefined }> = [];
  const statuses = [...(opts.fileStatuses ?? ["READY"])];
  const polls: string[] = [];
  const port: ShopifyPort = {
    async read<T>(query: string, vars?: Record<string, unknown>): Promise<T> {
      if (query.includes("on MediaImage")) {
        polls.push(String(vars?.id));
        const fileStatus = statuses.length > 1 ? statuses.shift()! : statuses[0];
        return { node: { fileStatus, fileErrors: fileStatus === "FAILED" ? [{ message: "Image is corrupt" }] : [], image: fileStatus === "READY" ? { url: "https://cdn/x.png" } : null } } as T;
      }
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
      if (op === "stagedUploadsCreate") {
        return { stagedUploadsCreate: { ...ok, stagedTargets: [{ url: "https://staged.example/upload", resourceUrl: "https://staged.example/tmp/abc", parameters: [{ name: "key", value: "tmp/abc" }] }] } } as T;
      }
      if (op === "fileCreate") {
        const errs = (opts.fileCreateErrors ?? []).map(message => ({ message }));
        return { fileCreate: { userErrors: errs, files: errs.length ? null : [{ id: "gid://shopify/MediaImage/321", fileStatus: "UPLOADED" }] } } as T;
      }
      return { [op]: ok } as T;
    },
  };
  return { port, writes, polls };
}

/** The staged-upload POST and the poll's wait, faked: no network, no clock. */
function fakeFiles(opts: { uploadFails?: boolean } = {}) {
  const uploads: Array<{ target: StagedTarget; filename: string; mimeType: string; size: number }> = [];
  const sleeps: number[] = [];
  const deps: FileDeps = {
    upload: async (target, file) => {
      if (opts.uploadFails) throw new Error("Shopify's file storage refused the upload (HTTP 403)");
      uploads.push({ target, filename: file.filename, mimeType: file.mimeType, size: file.bytes.length });
    },
    sleep: async ms => { sleeps.push(ms); },
    pollTries: 3,
  };
  return { deps, uploads, sleeps };
}

const nutritionImage = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), filename: "properoni-carnizone-nutrition.png", alt: "Properoni CarniZone nutrition" };

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

  it("sets the price from the recipe's RRP with the blank barcode on a new product", async () => {
    const { port, writes } = fakeStore();
    const r = await applyRecipeProduct(port, { ...input, price: "19.95" }, async () => {});
    expect(writes.find(w => w.op === "productVariantsBulkUpdate")!.vars).toMatchObject({ variants: [{ id: "gid://shopify/ProductVariant/900", barcode: null, price: "19.95" }] });
    expect(r.steps).toContain("Set the price to £19.95 from the recipe's RRP");
  });

  it("a re-run with an RRP sets the price only — the barcode added since is left alone", async () => {
    const { port, writes } = fakeStore();
    await applyRecipeProduct(port, { ...input, action: "update", existingProductId: "500", price: "21.50" }, async () => {});
    const v = (writes.find(w => w.op === "productVariantsBulkUpdate")!.vars as { variants: Array<Record<string, unknown>> }).variants;
    expect(v).toEqual([{ id: "gid://shopify/ProductVariant/900", price: "21.50" }]);
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

describe("the nutrition image (fake store, fake upload)", () => {
  it("staged upload → POST → fileCreate → poll until READY → metafieldsSet custom.nutritional_info, after the template's is removed", async () => {
    const { port, writes, polls } = fakeStore({ fileStatuses: ["PROCESSING", "READY"] });
    const { deps, uploads, sleeps } = fakeFiles();
    const r = await applyRecipeProduct(port, { ...input, nutritionImage }, async () => {}, deps);

    expect(writes.map(w => w.op)).toEqual([
      "productDuplicate", "productUpdate", "productVariantsBulkUpdate", "metafieldsDelete", "metafieldsSet",
      "stagedUploadsCreate", "fileCreate", "metafieldsSet",
    ]);
    // The template's image goes first, so a failed upload never leaves another recipe's table.
    expect(JSON.stringify(writes[3].vars)).toContain("nutritional_info");
    expect(writes[5].vars).toEqual({ input: [{ resource: "IMAGE", filename: "properoni-carnizone-nutrition.png", mimeType: "image/png", httpMethod: "POST", fileSize: "7" }] });
    expect(uploads).toEqual([{ target: expect.objectContaining({ url: "https://staged.example/upload" }), filename: "properoni-carnizone-nutrition.png", mimeType: "image/png", size: 7 }]);
    expect(writes[6].vars).toEqual({ files: [{ originalSource: "https://staged.example/tmp/abc", contentType: "IMAGE", alt: "Properoni CarniZone nutrition" }] });
    expect(polls).toEqual(["gid://shopify/MediaImage/321", "gid://shopify/MediaImage/321"]);
    expect(sleeps).toEqual([1000]);
    expect(writes[7].vars).toEqual({ metafields: [{ ownerId: "gid://shopify/Product/500", namespace: "custom", key: "nutritional_info", type: "file_reference", value: "gid://shopify/MediaImage/321" }] });
    expect(r.steps.at(-1)).toMatch(/^Uploaded this recipe's nutrition table image and put it on/);
  });

  it("a re-run makes and attaches a fresh image (the last one is replaced)", async () => {
    const { port, writes } = fakeStore();
    const { deps, uploads } = fakeFiles();
    await applyRecipeProduct(port, { ...input, action: "update", existingProductId: "500", nutritionImage }, async () => {}, deps);
    expect(writes.map(w => w.op)).toEqual(expect.arrayContaining(["metafieldsDelete", "stagedUploadsCreate", "fileCreate"]));
    expect(uploads).toHaveLength(1);
    expect(writes.at(-1)!.vars).toMatchObject({ metafields: [{ key: "nutritional_info", value: "gid://shopify/MediaImage/321" }] });
  });

  it("still processing after the short wait: attached anyway, and the step says so", async () => {
    const { port, writes, polls } = fakeStore({ fileStatuses: ["PROCESSING"] });
    const { deps, sleeps } = fakeFiles();
    const r = await applyRecipeProduct(port, { ...input, nutritionImage }, async () => {}, deps);
    expect(polls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 1000]);
    expect(writes.at(-1)!.op).toBe("metafieldsSet");
    expect(r.steps.at(-1)).toContain("still processing");
  });

  it("no image (nutrition incomplete or write_files missing): no upload at all, the template's is still removed", async () => {
    const { port, writes } = fakeStore();
    const { deps, uploads } = fakeFiles();
    await applyRecipeProduct(port, { ...input, nutritionImage: null }, async () => {}, deps);
    expect(writes.map(w => w.op)).not.toContain("stagedUploadsCreate");
    expect(writes.map(w => w.op)).not.toContain("fileCreate");
    expect(JSON.stringify(writes.find(w => w.op === "metafieldsDelete")!.vars)).toContain("nutritional_info");
    expect(uploads).toHaveLength(0);
  });

  it("Shopify refusing the file (e.g. no write_files after all) never fails the product — the step says it was left off", async () => {
    const { port, writes } = fakeStore({ fileCreateErrors: ["Access denied for fileCreate field. Required access: write_files access scope."] });
    const { deps } = fakeFiles();
    const r = await applyRecipeProduct(port, { ...input, nutritionImage }, async () => {}, deps);
    expect(r.productId).toBe("500");
    expect(writes.filter(w => w.op === "metafieldsSet")).toHaveLength(1); // the details only
    expect(r.steps.at(-1)).toMatch(/^Nutrition image NOT put on: .*write_files/);
  });

  it("a failed upload or a file Shopify can't process: left off, product made", async () => {
    const up = fakeStore();
    const r1 = await applyRecipeProduct(up.port, { ...input, nutritionImage }, async () => {}, fakeFiles({ uploadFails: true }).deps);
    expect(up.writes.map(w => w.op)).not.toContain("fileCreate");
    expect(r1.steps.at(-1)).toContain("HTTP 403");

    const bad = fakeStore({ fileStatuses: ["FAILED"] });
    const r2 = await applyRecipeProduct(bad.port, { ...input, nutritionImage }, async () => {}, fakeFiles().deps);
    expect(bad.writes.filter(w => w.op === "metafieldsSet")).toHaveLength(1);
    expect(r2.steps.at(-1)).toContain("Image is corrupt");
  });

  it("with Shopify writes blocked nothing is written and nothing is uploaded", async () => {
    const { port, writes } = fakeStore({ blocked: true });
    const { deps, uploads } = fakeFiles();
    await expect(applyRecipeProduct(port, { ...input, nutritionImage }, async () => {}, deps)).rejects.toThrow("switched off");
    expect(writes).toHaveLength(0);
    expect(uploads).toHaveLength(0);
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
