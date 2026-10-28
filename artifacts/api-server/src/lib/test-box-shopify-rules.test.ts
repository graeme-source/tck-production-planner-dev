import { describe, expect, it } from "vitest";
import {
  MF, chooseTemplate, collectionHandle, copiedFromRecipeId, decideRecipeAction, descriptionHtml, findBoxCollection,
  MAX_NUTRITION_PNG_BYTES, checkNutritionPng, launchTicks, metafieldPlan, missingFileScopes, missingWriteScopes, newCollectionSettings,
  nutritionImageForRun, nutritionImagePlan, nutritionRows, perPackValue,
  previousBoxCollection, productSearchQuery, recipeWarnings, sameTitle, singleLine, tagChanges, templateSearchQuery, testBoxTags, variantsToLink,
  type CollectionInfo, type MetafieldValue, productPrice } from "./test-box-shopify-rules";

describe("tags", () => {
  it("are exactly show, no-wholesale, calzones and the box name", () => {
    expect(testBoxTags("Properoni Test Box")).toEqual(["show", "no-wholesale", "calzones", "Properoni Test Box"]);
    expect(testBoxTags("  Calzones ")).toEqual(["show", "no-wholesale", "calzones"]);
  });

  it("drop the previous box's tag and anything else the template carried", () => {
    const template = ["calzones", "current-special", "Meals", "no-wholesale", "show", "Summer Test Box"];
    expect(tagChanges(template, testBoxTags("Properoni Test Box"))).toEqual({
      removed: ["current-special", "Meals", "Summer Test Box"],
      added: ["Properoni Test Box"],
    });
  });

  it("template search looks for every base tag, not archived", () => {
    expect(templateSearchQuery()).toBe('tag:"show" AND tag:"no-wholesale" AND tag:"calzones" AND -status:archived');
  });
});

describe("choosing the template", () => {
  const candidates = [
    { productId: "1", title: "Properoni Chicken & Chorizo", status: "DRAFT", tags: ["Properoni Test Box"], createdAt: "2026-10-02" },
    { productId: "2", title: "Open Fire", status: "DRAFT", tags: ["Summer Test Box"], createdAt: "2026-07-31" },
    { productId: "3", title: "Philly 2.0", status: "ACTIVE", tags: ["Summer Test Box"], createdAt: "2024-03-14" },
  ];
  it("a person's pick wins", () => {
    expect(chooseTemplate({ requested: "9", candidates, boxName: "Properoni Test Box" })).toEqual({ productId: "9", reason: "chosen" });
  });
  it("then the product of the recipe this one was copied from", () => {
    expect(chooseTemplate({ copiedFromProductId: "7", candidates, boxName: "Properoni Test Box" }).productId).toBe("7");
  });
  it("then the newest ACTIVE earlier test-box product, never this box's own", () => {
    expect(chooseTemplate({ candidates, boxName: "Properoni Test Box" })).toEqual({ productId: "3", reason: "previous-box" });
  });
  it("falls back to the newest of any status, or none", () => {
    expect(chooseTemplate({ candidates: candidates.slice(0, 2), boxName: "Properoni Test Box" }).productId).toBe("2");
    expect(chooseTemplate({ candidates: [], boxName: "X" })).toEqual({ productId: null, reason: "none" });
  });
  it("reads 'copied from recipe N' in notes", () => {
    expect(copiedFromRecipeId("Copied ingredients from recipe 26 on 1 Oct")).toBe(26);
    expect(copiedFromRecipeId("copy of the Philly, from recipe #9")).toBe(9);
    expect(copiedFromRecipeId("from recipe 3")).toBeNull();
    expect(copiedFromRecipeId(null)).toBeNull();
  });
});

describe("content", () => {
  it("calzones per pack from the recipe, default 2", () => {
    expect(perPackValue(2)).toBe("2");
    expect(perPackValue("2.0000")).toBe("2");
    expect(perPackValue(0)).toBe("2");
    expect(perPackValue("1.5")).toBe("2");
    expect(perPackValue(null)).toBe("2");
  });
  it("description as safe HTML paragraphs, and on one line for the metafield", () => {
    expect(descriptionHtml("Hot & <spicy>\n\nSecond")).toBe("<p>Hot &amp; &lt;spicy&gt;</p>\n<p>Second</p>");
    expect(singleLine(" a\n b  c ")).toBe("a b c");
  });
  it("nutrition rows: worded and rounded like the website's nutrition images, missing shown as a dash", () => {
    const rows = nutritionRows({ energyKj: 1000.4, energyKcal: 239.2, fat: 9.25, salt: 1.234, saturates: null, carbohydrate: 20.4 }, { energyKj: 2500, energyKcal: 598, fat: 23.1, salt: 3.08 });
    expect(rows[0]).toEqual({ key: "energyKj", label: "Energy", indent: false, optional: false, per100g: "1000kJ", perPortion: "2500kJ" });
    expect(rows[1]).toMatchObject({ key: "energyKcal", label: "", per100g: "239kcal" });
    expect(rows[2]).toMatchObject({ per100g: "9.3g", perPortion: "23g" });
    expect(rows[3]).toMatchObject({ label: "of which saturates", indent: true, per100g: "—" });
    expect(rows[4].per100g).toBe("20g");
    expect(rows[6]).toMatchObject({ key: "fibre", optional: true });
    expect(rows[8]).toMatchObject({ key: "salt", per100g: "1.2g", perPortion: "3.1g" });
  });
  it("nutrition rows with no pack size: per 100 g only, no per-portion column", () => {
    const rows = nutritionRows({ energyKj: 1000.4, energyKcal: 239.2 }, null);
    expect(rows[0]).toMatchObject({ label: "Energy", per100g: "1000kJ", perPortion: null });
    expect(rows.every(r => r.perPortion === null)).toBe(true);
  });
});

describe("the nutrition image", () => {
  // A real 1000 × 600 PNG header (signature + IHDR) padded out.
  const png = (w: number, h: number, extra = 40) => {
    const b = Buffer.alloc(33 + extra);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
    return b.toString("base64");
  };

  it("needs write_files (or write_images) — missing it is reported, not fatal", () => {
    expect(missingFileScopes(["write_products"])).toEqual(["write_files"]);
    expect(missingFileScopes(["write_products", "write_files"])).toEqual([]);
    expect(missingFileScopes(["write_images"])).toEqual([]);
    // The products scope check is unchanged by it.
    expect(missingWriteScopes(["write_products"])).toEqual([]);
  });

  it("is put on only when the nutrition is complete and Shopify allows file uploads", () => {
    expect(nutritionImagePlan({ nutritionComplete: true, missingFileScopes: [] }).willAttach).toBe(true);
    const noScope = nutritionImagePlan({ nutritionComplete: true, missingFileScopes: ["write_files"] });
    expect(noScope.willAttach).toBe(false);
    expect(noScope.summary).toContain("Shopify hasn't given the app permission to upload files yet (write_files) — the nutrition image will be left off; add the scope to have it put on.");
    expect(nutritionImagePlan({ nutritionComplete: false, missingFileScopes: [] })).toMatchObject({ willAttach: false });
  });

  it("the preview line: 'set' when it will be put on; otherwise the template's is still removed", () => {
    const template: MetafieldValue[] = [{ ...MF.nutrition, value: "gid://shopify/MediaImage/1" }];
    const content = { description: "x", packSize: 2, deckDocument: null, deckSummary: null };
    const on = metafieldPlan(content, template, "STD", nutritionImagePlan({ nutritionComplete: true, missingFileScopes: [] }));
    expect(on.lines.find(l => l.field === "custom.nutritional_info")).toMatchObject({ action: "set" });
    // Removed first either way, so a failed upload never leaves another recipe's table.
    expect(on.remove.map(m => m.key)).toContain("nutritional_info");
    const off = metafieldPlan(content, template, "STD", nutritionImagePlan({ nutritionComplete: true, missingFileScopes: ["write_files"] }));
    expect(off.lines.find(l => l.field === "custom.nutritional_info")).toMatchObject({ action: "remove" });
    expect(off.lines.find(l => l.field === "custom.nutritional_info")!.summary).toContain("write_files");
  });

  it("checks the browser's PNG before anything goes to Shopify", () => {
    const ok = checkNutritionPng(png(1000, 600));
    expect(ok).toMatchObject({ ok: true, width: 1000, height: 600 });
    expect(checkNutritionPng(`data:image/png;base64,${png(1000, 600)}`).ok).toBe(true);
    expect(checkNutritionPng(Buffer.from("GIF89a not a png at all, honestly, long enough").toString("base64"))).toMatchObject({ ok: false, reason: "The nutrition image isn't a PNG" });
    expect(checkNutritionPng("not base64 !!")).toMatchObject({ ok: false });
    expect(checkNutritionPng(png(50, 50))).toMatchObject({ ok: false });
    expect(checkNutritionPng(png(1000, 600, MAX_NUTRITION_PNG_BYTES))).toMatchObject({ ok: false, reason: "The nutrition image is too big" });
  });

  it("for the run: the PNG when it will be put on, else the reason for the results", () => {
    const will = { title: "Properoni CarniZone", nutritionImage: { willAttach: true, summary: "x" } };
    const r = nutritionImageForRun(will, png(1000, 600));
    expect(r.note).toBeNull();
    expect(r.image).toMatchObject({ filename: "properoni-carnizone-nutrition.png", alt: "Properoni CarniZone nutrition" });
    expect(nutritionImageForRun(will, undefined).note).toContain("didn't send one");
    expect(nutritionImageForRun({ ...will, nutritionImage: { willAttach: false, summary: "No permission" } }, png(1000, 600))).toEqual({ image: null, note: "Nutrition image left off: No permission" });
  });
});

describe("metafield plan", () => {
  const template: MetafieldValue[] = [
    { ...MF.cooking, value: '{"type":"root","children":[]}' },
    { ...MF.ingredientDeck, value: "template deck" },
    { ...MF.nutrition, value: "gid://shopify/MediaImage/1" },
    { ...MF.description, value: "Philly text" },
    { namespace: "custom_fields", key: "recipe", type: "string", value: "Philly text" },
    { namespace: "reviews", key: "rating", type: "rating", value: "{}" },
    { namespace: "custom", key: "pairs_with", type: "list.product_reference", value: "[]" },
  ];
  const content = { description: "Properoni chorizo", packSize: 2, deckDocument: '{"type":"root"}', deckSummary: "Dough…" };

  it("writes the app's deck, description and pack size; keeps the template's cooking text", () => {
    const p = metafieldPlan(content, template, "STD");
    const keys = p.set.map(m => `${m.namespace}.${m.key}=${m.value}`);
    expect(keys).toContain('custom.ingredient_deck={"type":"root"}');
    expect(keys).toContain("custom.product_recipe=Properoni chorizo");
    expect(keys).toContain("custom_fields.recipe=Properoni chorizo");
    expect(keys).toContain("custom.per_recipe=2");
    expect(keys.some(k => k.startsWith("custom.cooking_instructions"))).toBe(false);
  });

  it("removes what describes the template's recipe — nutrition image, reviews, old description — but not the pairing", () => {
    const removed = metafieldPlan(content, template, "STD").remove.map(m => `${m.namespace}.${m.key}`);
    expect(removed).toEqual(expect.arrayContaining(["custom.nutritional_info", "reviews.rating", "custom_fields.recipe"]));
    expect(removed).not.toContain("custom.pairs_with");
    expect(removed).not.toContain("custom.ingredient_deck");
  });

  it("an incomplete deck removes the template's deck instead of leaving another recipe's ingredients", () => {
    const p = metafieldPlan({ ...content, deckDocument: null }, template, "STD");
    expect(p.remove.map(m => m.key)).toContain("ingredient_deck");
    expect(p.set.map(m => m.key)).not.toContain("ingredient_deck");
  });

  it("no description: the template's description is removed, nothing blank is written", () => {
    const p = metafieldPlan({ ...content, description: "  " }, template, "STD");
    expect(p.remove.map(m => `${m.namespace}.${m.key}`)).toEqual(expect.arrayContaining(["custom.product_recipe", "custom_fields.recipe"]));
    expect(p.set.some(m => m.key === "product_recipe" || m.key === "recipe")).toBe(false);
  });

  it("standard cooking text when the template has none", () => {
    const p = metafieldPlan(content, [], "STD");
    expect(p.set.find(m => m.key === "cooking_instructions")?.value).toBe("STD");
  });
});

describe("what each recipe gets", () => {
  it("re-running updates the app's own product, never duplicates", () => {
    expect(decideRecipeAction({ createdProductId: "5", createdProductExists: true, mappedProductIds: ["5"] })).toBe("update");
  });
  it("a recipe already linked to a product (made by hand) is left alone", () => {
    expect(decideRecipeAction({ createdProductId: null, createdProductExists: false, mappedProductIds: ["15911483146614"] })).toBe("linked");
  });
  it("a product the app made that has gone from Shopify is made again", () => {
    expect(decideRecipeAction({ createdProductId: "5", createdProductExists: false, mappedProductIds: [] })).toBe("create");
    expect(decideRecipeAction({ createdProductId: null, createdProductExists: false, mappedProductIds: [] })).toBe("create");
  });
});

describe("the box's collection", () => {
  const cols: CollectionInfo[] = [
    { id: "697845875062", title: "August Test Box", handle: "august-test-box", sortOrder: "BEST_SELLING", templateSuffix: null, rules: [{ column: "TAG", relation: "EQUALS", condition: "Summer Test Box" }] },
    { id: "157321986129", title: "Calzones", handle: "calzones", sortOrder: "MANUAL", templateSuffix: "", rules: [{ column: "TAG", relation: "EQUALS", condition: "Calzones" }] },
  ];
  it("isn't duplicated: found by stored id, title or handle", () => {
    expect(findBoxCollection("August Test Box", null, cols)?.id).toBe("697845875062");
    expect(findBoxCollection("Anything", "157321986129", cols)?.id).toBe("157321986129");
    expect(findBoxCollection("Properoni Test Box", null, cols)).toBeNull();
    expect(collectionHandle("Sabores de México!")).toBe("sabores-de-mexico");
  });
  it("never mistakes a menu collection for the previous box's (found on the live store: 'Meals')", () => {
    const withMenu: CollectionInfo[] = [
      { id: "689111466358", title: "Meals", handle: "meals", sortOrder: "MANUAL", templateSuffix: "", rules: [{ column: "TAG", relation: "EQUALS", condition: "Meals" }, { column: "VARIANT_TITLE", relation: "NOT_EQUALS", condition: "8 Pack Bag" }] },
      { id: "685963608438", title: "6-Week No Takeaway Challenge", handle: "6-week", sortOrder: "MANUAL", templateSuffix: "", rules: [{ column: "TAG", relation: "EQUALS", condition: "6 Week" }] },
      ...cols,
    ];
    expect(previousBoxCollection(["Meals", "6 Week", "Summer Test Box", "current-special"], "Properoni Test Box", withMenu)?.title).toBe("August Test Box");
  });

  it("copies the previous box's sort order, found through the template's box tag", () => {
    const prev = previousBoxCollection(["calzones", "no-wholesale", "show", "Summer Test Box", "Meals"], "Properoni Test Box", cols);
    expect(prev?.title).toBe("August Test Box");
    expect(newCollectionSettings("Properoni Test Box", prev)).toEqual({
      title: "Properoni Test Box",
      rule: { column: "TAG", relation: "EQUALS", condition: "Properoni Test Box" },
      sortOrder: "BEST_SELLING", templateSuffix: null, copiedFrom: "August Test Box",
    });
    expect(newCollectionSettings("X", null).sortOrder).toBe("BEST_SELLING");
  });
});

describe("readiness and ticks", () => {
  it("needs write_products", () => {
    expect(missingWriteScopes(["read_products", "write_orders"])).toEqual(["write_products"]);
    expect(missingWriteScopes(["write_products"])).toEqual([]);
    expect(missingWriteScopes(["write_products"], ["write_discounts"])).toEqual(["write_discounts"]);
  });
  it("ticks the products step only when every recipe is linked", () => {
    expect(launchTicks({ recipeIds: [1, 2], linkedRecipeIds: [1], collectionExists: true })).toEqual({ products: false, collection: true });
    expect(launchTicks({ recipeIds: [1, 2], linkedRecipeIds: [2, 1, 3], collectionExists: false })).toEqual({ products: true, collection: false });
    expect(launchTicks({ recipeIds: [], linkedRecipeIds: [], collectionExists: false }).products).toBe(false);
  });
  it("warns about gaps; a missing template blocks only a create", () => {
    const base = { action: "create" as const, templateFound: false, description: "x", deckComplete: true, deckMissing: [], nutritionComplete: true, nutritionMissing: [], templateVariantCount: 1, existingStatus: null };
    expect(recipeWarnings(base).blocking).toHaveLength(1);
    expect(recipeWarnings({ ...base, action: "update", templateFound: false }).blocking).toHaveLength(0);
    const w = recipeWarnings({ ...base, templateFound: true, description: "", deckComplete: false, deckMissing: ["Chorizo"], nutritionComplete: false, nutritionMissing: [] });
    expect(w.warnings.join(" ")).toContain("no description");
    expect(w.warnings.join(" ")).toContain("Chorizo");
    expect(recipeWarnings({ ...base, action: "update", existingStatus: "ACTIVE" }).warnings[0]).toContain("status is left alone");
    // Names repeat when an ingredient is used twice; a linked product gets no warnings at all.
    expect(recipeWarnings({ ...base, templateFound: true, nutritionComplete: false, nutritionMissing: ["Sauce", "Sauce"] }).warnings.join(" ")).toContain("(Sauce)");
    expect(recipeWarnings({ ...base, action: "linked", description: "", deckComplete: false })).toEqual({ warnings: [], blocking: [] });
  });
  it("links the one 2 Pack variant; with more, only the template's main-mapped one", () => {
    expect(variantsToLink([{ id: "a", title: "2 Pack" }], [], [])).toEqual(["a"]);
    const tpl = [{ id: "t1", title: "2 Pack" }, { id: "t2", title: "8 Pack Bag" }];
    expect(variantsToLink([{ id: "a", title: "2 Pack" }, { id: "b", title: "8 Pack Bag" }], tpl, ["t1"])).toEqual(["a"]);
    expect(variantsToLink([{ id: "a", title: "2 Pack" }, { id: "b", title: "8 Pack Bag" }], tpl, [])).toEqual([]);
  });

  it("searches Shopify by the meaningful words of a title", () => {
    expect(productSearchQuery("The Texican Fajita Calzone 2.0")).toBe("title:*texican* title:*fajita*");
    expect(productSearchQuery("Properoni Chicken & Chorizo")).toBe("title:*properoni* title:*chicken* title:*chorizo*");
    expect(productSearchQuery("Sabores de México")).toBe("title:*sabores* title:*mexico*");
    expect(productSearchQuery("2 & a")).toBeNull();
  });

  it("spots the same product title written differently", () => {
    expect(sameTitle("Properoni Chicken & Chorizo", "properoni chicken and chorizo")).toBe(true);
    expect(sameTitle("Properoni Chicken", "Properoni Chorizo")).toBe(false);
  });
});

describe("productPrice", () => {
  it("takes the recipe's RRP on a one-variant product", () => {
    expect(productPrice(19.95, 1, "17.95")).toEqual({ price: "19.95", summary: "£19.95 from the recipe's RRP (was £17.95)" });
    expect(productPrice("19.95", 1, "19.95").summary).toBe("£19.95 (the recipe's RRP)");
  });
  it("leaves the price alone with no RRP, or several variants", () => {
    expect(productPrice(0, 1, "17.95")).toMatchObject({ price: null });
    expect(productPrice(0, 1, "17.95").summary).toContain("stays £17.95");
    expect(productPrice(19.95, 2, "17.95")).toMatchObject({ price: null });
  });
});
