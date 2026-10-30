import { describe, expect, it, vi } from "vitest";

// The live port imports services/shopify, which reads env vars at load;
// these tests never touch it — every call goes to the fake store below.
vi.mock("../services/shopify", () => ({
  shopifyGraphQL: vi.fn(), shopifyGraphQLWrite: vi.fn(), shopifyWritesBlocked: vi.fn(() => true),
  ShopifyWritesBlockedError: class extends Error {},
}));

import { applyRecipeProduct, setNutritionImage, type ApplyInput, type FileDeps, type ProductSnapshot, type ShopifyPort } from "./test-box-shopify";
import { MF } from "./test-box-shopify-rules";
import { PACK_VARIANT_TITLE, recipeProductTags } from "./recipe-shopify-product-rules";
import { assembleRecipePreview, type PreviewInput } from "./recipe-shopify-product-preview";
import { afterProductCreated, type AfterCreatePorts } from "./recipe-shopify-product-after";
import { pushBarcodes, type PushSink, type ShopifyBarcodePort } from "./barcode-push";

class BlockedError extends Error {}

/** A fake store whose template (a core product) has a 2 Pack AND an 8 Pack
 *  Bag and product type "Calzones" — what the recipe flow has to clean up. */
function fakeStore(opts: { blocked?: boolean; mediaErrors?: string[]; noTwoPack?: boolean; images?: number } = {}) {
  const writes: Array<{ op: string; vars: Record<string, unknown> | undefined }> = [];
  const port: ShopifyPort = {
    async read<T>(query: string): Promise<T> {
      if (query.includes("on MediaImage")) return { node: { fileStatus: "READY", fileErrors: [], image: { url: "https://cdn/x.png" } } } as T;
      if (query.includes("nodes(ids")) {
        return {
          nodes: [{
            id: "gid://shopify/Product/700", title: "Chicken & Chorizo copy", handle: "x", status: "DRAFT", tags: ["Meals", "current-special"], productType: "Calzones",
            media: { nodes: Array.from({ length: opts.images ?? 0 }, (_, i) => ({ id: `m${i}` })) }, featuredMedia: null,
            variants: { nodes: opts.noTwoPack
              ? [{ id: "gid://shopify/ProductVariant/911", title: "Default Title", price: "17.95", sku: null, barcode: null }]
              : [
                { id: "gid://shopify/ProductVariant/910", title: "8 Pack Bag", price: "54.00", sku: "CC8", barcode: "5065018206000" },
                { id: "gid://shopify/ProductVariant/911", title: "2 Pack", price: "17.95", sku: "CC2", barcode: "5065018206399" },
              ] },
            metafields: { nodes: [
              { ...MF.nutrition, value: "gid://shopify/MediaImage/1" },
              { ...MF.ingredientDeck, value: '{"type":"root","children":[]}' },
              { namespace: "reviews", key: "rating", type: "rating", value: "{}" },
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
      if (op === "productDuplicate") return { productDuplicate: { ...ok, newProduct: { id: "gid://shopify/Product/700" } } } as T;
      if (op === "stagedUploadsCreate") {
        return { stagedUploadsCreate: { ...ok, stagedTargets: [{ url: "https://staged.example/upload", resourceUrl: `https://staged.example/tmp/${writes.length}`, parameters: [] }] } } as T;
      }
      if (op === "fileCreate") return { fileCreate: { ...ok, files: [{ id: "gid://shopify/MediaImage/321", fileStatus: "UPLOADED" }] } } as T;
      if (op === "productUpdateMedia") return { productUpdate: { userErrors: (opts.mediaErrors ?? []).map(message => ({ message })) } } as T;
      return { [op]: ok } as T;
    },
  };
  return { port, writes };
}

function fakeFiles() {
  const uploads: Array<{ filename: string; mimeType: string; size: number }> = [];
  const deps: FileDeps = {
    upload: async (_t, f) => { uploads.push({ filename: f.filename, mimeType: f.mimeType, size: f.bytes.length }); },
    sleep: async () => {},
    pollTries: 2,
  };
  return { deps, uploads };
}

const nutritionImage = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), filename: "chicken-tarragon-nutrition.png", alt: "Chicken & Tarragon nutrition" };
const productPhoto = { bytes: new Uint8Array(12), filename: "chicken-tarragon.jpg", alt: "Chicken & Tarragon", mimeType: "image/jpeg" };

/** What runRecipeCreate passes for a recipe. */
const input: ApplyInput = {
  action: "create",
  templateProductId: "9089721336087",
  existingProductId: null,
  title: "Chicken & Tarragon",
  tags: recipeProductTags(["Winter Warmers Test Box"]),
  descriptionHtml: "<p>We developed this one…</p>",
  includeImages: false,
  content: { description: "Chicken in tarragon cream", packSize: 2, deckDocument: '{"type":"root","deck":1}', deckSummary: "Dough" },
  standardCooking: "STD",
  price: "18.95",
  nutritionImage,
  productType: "",
  onlyVariantTitled: PACK_VARIANT_TITLE,
  productPhoto,
};

describe("making a recipe's product (fake store, no network)", () => {
  it("the whole sequence: duplicate without images → only the 2 Pack → blank type, draft, tags → price + blank barcode → metafields → nutrition image → photo", async () => {
    const { port, writes } = fakeStore();
    const { deps, uploads } = fakeFiles();
    const stored: string[] = [];
    const r = await applyRecipeProduct(port, input, async id => { stored.push(id); expect(writes.map(w => w.op)).toEqual(["productDuplicate"]); }, deps);

    expect(writes.map(w => w.op)).toEqual([
      "productDuplicate", "productVariantsBulkDelete", "productUpdate", "productVariantsBulkUpdate", "metafieldsDelete", "metafieldsSet",
      "stagedUploadsCreate", "fileCreate", "metafieldsSet",
      "stagedUploadsCreate", "productUpdateMedia",
    ]);
    expect(stored).toEqual(["700"]);
    expect(writes[0].vars).toMatchObject({ productId: "gid://shopify/Product/9089721336087", newTitle: "Chicken & Tarragon", includeImages: false });
    // The 8 Pack goes; the 2 Pack stays.
    expect(writes[1].vars).toEqual({ productId: "gid://shopify/Product/700", variantsIds: ["gid://shopify/ProductVariant/910"] });
    // Never "Calzones", always a draft, exactly the tags.
    expect(writes[2].vars).toEqual({ product: {
      id: "gid://shopify/Product/700", title: "Chicken & Tarragon", tags: ["show", "no-wholesale", "calzones", "Winter Warmers Test Box"],
      descriptionHtml: "<p>We developed this one…</p>", productType: "", status: "DRAFT",
    } });
    expect(writes[3].vars).toEqual({ productId: "gid://shopify/Product/700", variants: [{ id: "gid://shopify/ProductVariant/911", barcode: null, price: "18.95" }] });
    // The template's deck, nutrition and reviews go; this recipe's details are written.
    const removed = JSON.stringify(writes[4].vars);
    expect(removed).toContain("nutritional_info");
    expect(removed).toContain("rating");
    const set = (writes[5].vars as { metafields: Array<{ key: string; value: string }> }).metafields;
    expect(Object.fromEntries(set.map(m => [m.key, m.value]))).toMatchObject({
      ingredient_deck: '{"type":"root","deck":1}', product_recipe: "Chicken in tarragon cream", per_recipe: "2", cooking_instructions: "STD",
    });
    expect(writes[8].vars).toMatchObject({ metafields: [{ key: "nutritional_info", value: "gid://shopify/MediaImage/321" }] });
    // The photo: staged as a JPEG, then onto the product's media.
    expect(writes[9].vars).toMatchObject({ input: [{ resource: "IMAGE", filename: "chicken-tarragon.jpg", mimeType: "image/jpeg", fileSize: "12" }] });
    expect(writes[10].vars).toEqual({ product: { id: "gid://shopify/Product/700" }, media: [{ originalSource: "https://staged.example/tmp/10", mediaContentType: "IMAGE", alt: "Chicken & Tarragon" }] });
    expect(uploads.map(u => u.mimeType)).toEqual(["image/png", "image/jpeg"]);

    expect(r).toMatchObject({ productId: "700", status: "DRAFT", variants: [{ id: "911", title: "2 Pack" }] });
    expect(r.steps.join("\n")).toMatch(/Removed the template's other variant \(8 Pack Bag\) — only the 2 Pack is kept/);
    expect(r.steps.join("\n")).toMatch(/product type blank/);
    expect(r.steps.at(-1)).toMatch(/^Uploaded the recipe's photo/);
    // Nothing is ever published.
    expect(JSON.stringify(writes)).not.toMatch(/ACTIVE|publishablePublish/);
  });

  it("a template with no 2 Pack is refused after the duplicate is stored — nothing else is written", async () => {
    const { port, writes } = fakeStore({ noTwoPack: true });
    const stored = vi.fn(async () => {});
    await expect(applyRecipeProduct(port, input, stored, fakeFiles().deps)).rejects.toThrow(/no '2 Pack' variant/);
    expect(stored).toHaveBeenCalledWith("700");
    expect(writes.map(w => w.op)).toEqual(["productDuplicate"]);
  });

  it("a refused photo never fails the product — the step says it was left off", async () => {
    const { port } = fakeStore({ mediaErrors: ["Image is too large"] });
    const r = await applyRecipeProduct(port, input, async () => {}, fakeFiles().deps);
    expect(r.productId).toBe("700");
    expect(r.steps.at(-1)).toMatch(/^Product photo NOT put on: .*Image is too large/);
  });

  it("finishing a broken run: no duplicate, no variant changes, the photo only if the product has none yet", async () => {
    const a = fakeStore({ images: 0 });
    await applyRecipeProduct(a.port, { ...input, action: "update", existingProductId: "700" }, async () => {}, fakeFiles().deps);
    expect(a.writes.map(w => w.op)).not.toContain("productDuplicate");
    expect(a.writes.map(w => w.op)).not.toContain("productVariantsBulkDelete");
    expect(a.writes.map(w => w.op)).toContain("productUpdateMedia");
    expect((a.writes.find(w => w.op === "productUpdate")!.vars as { product: Record<string, unknown> }).product).not.toHaveProperty("status");

    const b = fakeStore({ images: 1 });
    await applyRecipeProduct(b.port, { ...input, action: "update", existingProductId: "700" }, async () => {}, fakeFiles().deps);
    expect(b.writes.map(w => w.op)).not.toContain("productUpdateMedia");
  });

  it("with Shopify writes blocked nothing is written, stored or uploaded", async () => {
    const { port, writes } = fakeStore({ blocked: true });
    const { deps, uploads } = fakeFiles();
    const stored = vi.fn();
    await expect(applyRecipeProduct(port, input, stored, deps)).rejects.toThrow("switched off");
    expect(writes).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    expect(stored).not.toHaveBeenCalled();
  });
});

// ── The preview ─────────────────────────────────────────────────────────────
const template: ProductSnapshot = {
  id: "9089721336087", title: "Properoni Chicken & Chorizo", handle: "p", status: "ACTIVE", tags: ["show", "no-wholesale", "calzones", "Summer Test Box"],
  productType: "", imageCount: 3, imageUrl: null,
  variants: [{ id: "1", title: "2 Pack", price: "17.95", sku: null, barcode: "50650" }, { id: "2", title: "8 Pack Bag", price: "54.00", sku: null, barcode: null }],
  metafields: [{ ...MF.cooking, value: '{"type":"root"}' }, { ...MF.nutrition, value: "gid://shopify/MediaImage/1" }],
};
const link = (p: { productId: string; title: string; status: string; variantTitle?: string }) => ({ ...p, adminUrl: `https://the-calzone-kitchen.myshopify.com/admin/products/${p.productId}` });
const base: PreviewInput = {
  recipe: {
    id: 42, name: "Chicken & Tarragon", description: "Chicken in tarragon cream", listing: "We developed this one for winter.",
    packSize: "2.0000", tags: ["Winter Warmers Test Box", "SHOW"], rrp: "18.95", isDraft: true, archived: false,
  },
  made: null,
  photo: { width: 2000, height: 1500 },
  scopes: ["write_products", "write_files"],
  candidates: [{ productId: template.id, title: template.title, status: "ACTIVE", tags: template.tags, createdAt: "2026-10-01T00:00:00Z" }],
  linked: [],
  choice: { productId: template.id, reason: "previous-box" },
  snapshots: new Map([[template.id, template]]),
  loaded: {
    deck: { deckText: "Dough (**Wheat** Flour), Chicken", mayContainStatement: null, isComplete: true, missing: [] },
    nutrition: { per100g: { energyKcal: 200 }, perPortion: { energyKcal: 400 }, portionWeightG: 200, complete: true, missing: [] },
  },
  disclaimer: "Made in a kitchen that handles…",
  standardCooking: "STD",
  writesBlocked: false,
  blockedMessage: null,
  link,
};

describe("the preview", () => {
  it("shows exactly what will be made", () => {
    const { preview: p, price, templateId, existingProductId, content } = assembleRecipePreview(base);
    expect(p.action).toBe("create");
    expect(p).toMatchObject({ title: "Chicken & Tarragon", status: "DRAFT", productType: "", barcode: { code: null, summary: expect.stringMatching(/^None yet/) } });
    expect(p.deckLeftOff).toBe(false);
    expect(p.declarationGaps).toEqual({ items: [], headlines: [] });
    expect(p.tags).toEqual(["show", "no-wholesale", "calzones", "Winter Warmers Test Box"]);
    expect(p.variant).toEqual({ title: "2 Pack", removed: ["8 Pack Bag"] });
    expect(p.price.set).toBe("18.95");
    expect(price).toBe("18.95");
    expect(p.listingDescription).toBe("We developed this one for winter.");
    expect(p.photo).toMatchObject({ willAttach: true, width: 2000, height: 1500 });
    expect(p.nutritionImage.willAttach).toBe(true);
    expect(p.metafields.map(m => [m.field, m.action])).toEqual([
      ["custom.ingredient_deck", "set"], ["custom.product_recipe", "set"], ["custom.per_recipe", "set"],
      ["custom.cooking_instructions", "keep"], ["custom.nutritional_info", "set"],
    ]);
    expect(p.metafields.find(m => m.field === "custom.per_recipe")!.summary).toBe("2");
    expect(JSON.parse(content.deckDocument!)).toMatchObject({ type: "root" });
    expect(p.blocking).toEqual([]);
    expect(p.warnings).toEqual(["The template has 2 variants — only the 2 Pack is kept, the others are removed from the copy."]);
    expect(templateId).toBe(template.id);
    expect(existingProductId).toBeNull();
    expect(p.template).toMatchObject({ price: "17.95", variantTitles: ["2 Pack", "8 Pack Bag"], reason: "the newest test-box product" });
  });

  it("already linked → 'Already in Shopify', nothing to make, nothing blocking", () => {
    const linked = [link({ productId: "555", title: "Chicken & Tarragon", status: "DRAFT", variantTitle: "2 Pack" })];
    const { preview: p } = assembleRecipePreview({ ...base, linked, recipe: { ...base.recipe, listing: null } });
    expect(p.action).toBe("linked");
    expect(p.linkedProducts[0].adminUrl).toBe("https://the-calzone-kitchen.myshopify.com/admin/products/555");
    expect(p.blocking).toEqual([]);
  });

  it("the app's own unfinished product is finished, not duplicated", () => {
    const made: ProductSnapshot = { ...template, id: "700", title: "Chicken & Tarragon", status: "DRAFT", variants: [template.variants[0]] };
    const { preview: p, existingProductId } = assembleRecipePreview({
      ...base, made: { shopifyProductId: "700", state: "created", lastError: "Shopify refused writing the details" },
      snapshots: new Map([[template.id, template], ["700", made]]),
    });
    expect(p.action).toBe("update");
    expect(existingProductId).toBe("700");
    expect(p.warnings[0]).toMatch(/finishes that same draft/);
    expect(p.createdProduct).toMatchObject({ productId: "700", lastError: "Shopify refused writing the details" });
  });

  it("no listing description → blocked; no write_files → nutrition image left off, still makeable otherwise", () => {
    const { preview: p } = assembleRecipePreview({ ...base, scopes: ["write_products"], recipe: { ...base.recipe, listing: " " } });
    expect(p.blocking).toHaveLength(1);
    expect(p.blocking[0]).toMatch(/listing description/);
    expect(p.missingFileScopes).toEqual(["write_files"]);
    expect(p.nutritionImage).toMatchObject({ willAttach: false, summary: expect.stringMatching(/write_files/) });
  });

  it("missing declarations / nutrition (sub-recipe ingredients too) → an explicit warning per ingredient, NOT blocking; the deck is left off, never partial", () => {
    const { preview: p, content } = assembleRecipePreview({
      ...base,
      loaded: {
        deck: {
          deckText: "Dough (**Wheat** Flour), Chicken, Mustard", mayContainStatement: null, isComplete: false, missing: ["Mustard", "Chorizo"],
          missingDetail: [{ ingredientId: 7, name: "Mustard" }], unwrapped: ["Chorizo"],
        },
        nutrition: {
          per100g: { energyKcal: 200 }, perPortion: null, portionWeightG: null, complete: false, missing: ["Tarragon"],
          missingDetail: [{ ingredientId: 9, name: "Tarragon", missing: ["fat", "salt"] }],
        },
      },
    });
    expect(p.blocking).toEqual([]);
    expect(p.deckLeftOff).toBe(true);
    expect(content.deckDocument).toBeNull();
    expect(p.declarationGaps.items.map(g => `${g.name}: ${g.missing.join("; ")}`)).toEqual([
      "Tarragon: nutrition: fat, salt", "Mustard: no label declaration", "Chorizo: declaration doesn't name the compound ingredient",
    ]);
    expect(p.declarationGaps.headlines[0]).toBe(
      "These aren't complete, so the ingredient deck won't be complete. Ingredient deck left off — finish the declarations, then use Push to Shopify on the Label tab.",
    );
    expect(p.declarationGaps.headlines[1]).toMatch(/nutrition image is left off/);
    // The metafield line says so too; the template has no deck here, so nothing to remove.
    const deckLine = p.metafields.find(m => m.field === "custom.ingredient_deck")!;
    expect(deckLine.action).toBe("none");
    expect(deckLine.summary).toContain("Ingredient deck left off");
    expect(p.warnings.join("\n")).toMatch(/ingredient deck isn't complete \(Mustard, Chorizo\)/);
  });

  it("the barcode held for the recipe shows as what goes on the 2 Pack", () => {
    const { preview: p } = assembleRecipePreview({ ...base, barcode: { barcode: "5065018206009", mixed: false, pending: true, heldProblem: null } });
    expect(p.barcode.code).toBe("5065018206009");
    expect(p.barcode.summary).toMatch(/from the label page/);
  });

  it("no write_products → the preview says so", () => {
    expect(assembleRecipePreview({ ...base, scopes: [] }).preview.missingScopes).toEqual(["write_products"]);
  });

  it("a chosen template that has gone from Shopify blocks the create", () => {
    const { preview: p } = assembleRecipePreview({ ...base, choice: { productId: "999", reason: "chosen" } });
    expect(p.blocking[0]).toMatch(/isn't in Shopify any more/);
  });
});

describe("adding the nutrition table to products that already exist (fake store)", () => {
  it("uploads the image once and points every ticked product at it in one call", async () => {
    const { port, writes } = fakeStore();
    const { deps, uploads } = fakeFiles();
    const r = await setNutritionImage(port, deps, ["700", "800"], nutritionImage);
    expect(r.ready).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(writes.map(w => w.op)).toEqual(["stagedUploadsCreate", "fileCreate", "metafieldsSet"]);
    const set = writes[2].vars as { metafields: Array<{ ownerId: string; namespace: string; key: string; value: string }> };
    expect(set.metafields.map(m => m.ownerId)).toEqual(["gid://shopify/Product/700", "gid://shopify/Product/800"]);
    expect(set.metafields.every(m => m.namespace === MF.nutrition.namespace && m.key === MF.nutrition.key && m.value === "gid://shopify/MediaImage/321")).toBe(true);
  });
  it("writes nothing with no products, and the write guard stops it", async () => {
    await expect(setNutritionImage(fakeStore().port, fakeFiles().deps, [], nutritionImage)).rejects.toThrow(/No products/);
    await expect(setNutritionImage(fakeStore({ blocked: true }).port, fakeFiles().deps, ["700"], nutritionImage)).rejects.toThrow(/switched off/);
  });
});

// ── The create with an incomplete deck, and what follows it (30 Oct 2026) ──
const incompleteDeck: PreviewInput["loaded"] = {
  ...base.loaded,
  deck: { deckText: "Dough, Mustard", mayContainStatement: null, isComplete: false, missing: ["Mustard"], missingDetail: [{ ingredientId: 7, name: "Mustard" }], unwrapped: [] },
};

/** The barcode writer's Shopify side, reading what the fake store holds. */
function fakeBarcodeShopify(shopifyBarcode: () => string | null) {
  const sent: Array<{ productId: string; variants: Array<{ variantId: string; barcode: string }> }> = [];
  const port: ShopifyBarcodePort = {
    read: async ids => new Map(ids.map(id => [id, { productId: "700", barcode: shopifyBarcode(), status: "draft", productTitle: "Chicken & Tarragon", variantTitle: "2 Pack" }])),
    blockedReason: async () => null,
    write: async (productId, variants) => { sent.push({ productId, variants }); },
  };
  const sink: PushSink = { record: async () => {}, log: async () => {} };
  return { port, sink, sent };
}

describe("making the product with an incomplete deck (fake store)", () => {
  it("is allowed, removes the template's deck and writes NO custom.ingredient_deck — never a partial deck", async () => {
    const { content, preview } = assembleRecipePreview({ ...base, loaded: incompleteDeck });
    expect(preview.blocking).toEqual([]);
    const { port, writes } = fakeStore();
    await applyRecipeProduct(port, { ...input, content }, async () => {}, fakeFiles().deps);
    const setKeys = writes.filter(w => w.op === "metafieldsSet")
      .flatMap(w => (w.vars as { metafields: Array<{ key: string }> }).metafields.map(m => m.key));
    expect(setKeys).not.toContain("ingredient_deck");
    expect(JSON.stringify(writes.find(w => w.op === "metafieldsDelete")!.vars)).toContain("ingredient_deck");
  });
});

describe("after the product is made: link → barcode → labels (fakes, no network, no database)", () => {
  const hash = "a".repeat(64);

  it("links the 2 Pack, THEN its barcode goes through the one barcode writer to the new variant; then the ticked labels", async () => {
    const { port, writes } = fakeStore();
    const made = await applyRecipeProduct(port, input, async () => {}, fakeFiles().deps);
    // The create cleared the copied barcode, so Shopify has none.
    const cleared = () => (writes.find(w => w.op === "productVariantsBulkUpdate")!.vars as { variants: Array<{ barcode: string | null }> }).variants[0].barcode;
    const shop = fakeBarcodeShopify(cleared);
    const order: string[] = [];
    const ports: AfterCreatePorts = {
      link: async v => { order.push(`link ${v.shopifyVariantId}`); return { linked: true }; },
      // What afterListingLinked does once the held barcode is on the listing.
      applyBarcode: async () => {
        order.push("barcode");
        const [r] = await pushBarcodes([{ variantId: "911", ours: "5065018206009", replaceable: [], clubSpecial: false }], shop.port, shop.sink);
        return r.message;
      },
      publishBackLabel: async h => { order.push(`back ${h}`); return { ok: true, versionNo: 1, publishedByName: "Graeme" }; },
      setFrontLabel: async () => { order.push("front"); },
    };
    const r = await afterProductCreated(ports, { variants: made.variants, backLabelHash: hash, frontLabel: true });
    expect(order).toEqual(["link 911", "barcode", `back ${hash}`, "front"]);
    expect(shop.sent).toEqual([{ productId: "700", variants: [{ variantId: "911", barcode: "5065018206009" }] }]);
    expect(r.linkedVariants).toEqual(["2 Pack"]);
    expect(r.barcode).toBe("Sent to Shopify");
    expect(r.backLabel).toMatchObject({ done: true, versionNo: 1 });
    expect(r.frontLabel).toMatchObject({ done: true });
  });

  it("a different number already in Shopify is never overwritten", async () => {
    const shop = fakeBarcodeShopify(() => "5000000000000");
    const [r] = await pushBarcodes([{ variantId: "911", ours: "5065018206009", replaceable: [], clubSpecial: false }], shop.port, shop.sink);
    expect(r.outcome).toBe("conflict");
    expect(shop.sent).toEqual([]);
  });

  it("nothing linked (another recipe has the variant) → no barcode moved; labels untouched unless ticked; a refused publish is a line, never a failure", async () => {
    const applyBarcode = vi.fn(async () => "x");
    const setFrontLabel = vi.fn(async () => {});
    const r = await afterProductCreated({
      link: async () => ({ linked: false }),
      applyBarcode,
      publishBackLabel: async () => ({ ok: false, status: 422, error: "This label can't go live yet.", blockers: ["Ingredients don't fit."] }),
      setFrontLabel,
    }, { variants: [{ id: "911", title: "2 Pack", sku: null }], backLabelHash: hash, frontLabel: false });
    expect(applyBarcode).not.toHaveBeenCalled();
    expect(setFrontLabel).not.toHaveBeenCalled();
    expect(r.conflicts).toEqual(["2 Pack"]);
    expect(r.barcode).toBeNull();
    expect(r.frontLabel).toBeNull();
    expect(r.backLabel).toMatchObject({ done: false, message: expect.stringMatching(/^Back label not published — This label can't go live yet\. Ingredients don't fit\./) });
  });

  it("a barcode or label step that throws never fails the product", async () => {
    const r = await afterProductCreated({
      link: async () => ({ linked: true }),
      applyBarcode: async () => { throw new Error("database busy"); },
      publishBackLabel: async () => { throw new Error("render failed"); },
      setFrontLabel: async () => { throw new Error("this recipe has no name to print"); },
    }, { variants: [{ id: "911", title: "2 Pack", sku: null }], backLabelHash: hash, frontLabel: true });
    expect(r.barcode).toMatch(/database busy/);
    expect(r.backLabel).toMatchObject({ done: false });
    expect(r.frontLabel).toMatchObject({ done: false, message: expect.stringMatching(/no name to print/) });
  });
});
