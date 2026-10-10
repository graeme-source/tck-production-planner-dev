import { describe, expect, it } from "vitest";
import {
  barcodeFor, checkGtin, checkNewBarcode, countOutcomes, decidePull, decidePush, deriveLinkedVariants, gtinCheckDigit,
  gtinKey, isDifferentInShopify, kindLabel, matchScan, missingScopes, shouldRefreshOnMiss, type BarcodeHolder, type MappingRow,
} from "./index";

describe("GTIN validation", () => {
  it("accepts real TCK EAN-13s", () => {
    expect(checkGtin("5065018206054")).toEqual({ ok: true, digits: "5065018206054", format: "EAN-13" });
    expect(checkGtin("5065018206207").ok).toBe(true);
  });
  it("ignores spaces and dashes people type", () => {
    expect(checkGtin(" 5065018 206054 ")).toMatchObject({ ok: true, digits: "5065018206054" });
    expect(checkGtin("5065-0182-06054")).toMatchObject({ ok: true });
  });
  it("accepts UPC-A, EAN-8 and GTIN-14 with their check digits", () => {
    expect(checkGtin("036000291452")).toMatchObject({ ok: true, format: "UPC-A" });
    expect(checkGtin("96385074")).toMatchObject({ ok: true, format: "EAN-8" });
    expect(checkGtin("15065018206051")).toMatchObject({ ok: true, format: "GTIN-14" });
  });
  it("says which last digit was expected", () => {
    const r = checkGtin("5065018206055");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("should be 4");
  });
  it("rejects letters, wrong lengths and empty", () => {
    expect(checkGtin("50650182060AB")).toEqual({ ok: false, reason: "Numbers only" });
    expect(checkGtin("12345")).toMatchObject({ ok: false });
    expect(checkGtin("")).toEqual({ ok: false, reason: "No barcode number" });
    expect(checkGtin(null)).toMatchObject({ ok: false });
  });
  it("check digit agrees with the EAN-13 1-3 weighting", () => {
    expect(gtinCheckDigit("506501820605")).toBe(4);
    expect(gtinCheckDigit("03600029145")).toBe(2);
  });
});

describe("linked variants", () => {
  const mappings: MappingRow[] = [
    { recipeId: 1, recipeName: "Margherita", shopifyVariantId: "11", wonkyVariantId: null, eightPackVariantId: null },
    { recipeId: 1, recipeName: "Margherita", shopifyVariantId: "12", wonkyVariantId: "13", eightPackVariantId: null },
    { recipeId: 2, recipeName: "Godfather", shopifyVariantId: "21", wonkyVariantId: null, eightPackVariantId: "29" },
    { recipeId: 3, recipeName: "Carnizone", shopifyVariantId: "31", wonkyVariantId: null, eightPackVariantId: null },
    { recipeId: 4, recipeName: "Twin", shopifyVariantId: "32", wonkyVariantId: null, eightPackVariantId: null },
  ];
  const catalogue = [
    { variantId: "11", productId: "P1", variantTitle: "2 Pack" },
    { variantId: "12", productId: "P1b", variantTitle: "2 Pack" },
    { variantId: "18", productId: "P1", variantTitle: "8 Pack Bag" },
    { variantId: "21", productId: "P2", variantTitle: "2 Pack" },
    { variantId: "28", productId: "P2", variantTitle: "8 Pack Bag" }, // eight_pack_variant_id wins: 29
    { variantId: "29", productId: "P2", variantTitle: "8 pack bag" },
    { variantId: "31", productId: "P3", variantTitle: "2 Pack" },
    { variantId: "32", productId: "P3", variantTitle: "Other" },
    { variantId: "38", productId: "P3", variantTitle: "8 Pack Bag" },
    { variantId: "99", productId: "P9", variantTitle: "8 Pack Bag" }, // nobody's pack
  ];
  const { links, ambiguousBags } = deriveLinkedVariants(mappings, catalogue);
  const byId = new Map(links.map(l => [l.variantId, l]));

  it("links every mapped pack and wonky listing", () => {
    expect(byId.get("11")).toMatchObject({ recipeId: 1, kind: "pack" });
    expect(byId.get("12")).toMatchObject({ recipeId: 1, kind: "pack" });
    expect(byId.get("13")).toMatchObject({ recipeId: 1, kind: "wonky" });
  });
  it("finds the 8-pack bag in the same Shopify product as a pack", () => {
    expect(byId.get("18")).toMatchObject({ recipeId: 1, kind: "bag" });
  });
  it("uses eight_pack_variant_id when it is set, and still links a titled bag in the product", () => {
    expect(byId.get("29")).toMatchObject({ recipeId: 2, kind: "bag" });
    expect(byId.get("28")).toMatchObject({ recipeId: 2, kind: "bag" });
  });
  it("never guesses a bag whose product holds two recipes' packs", () => {
    expect(byId.has("38")).toBe(false);
    expect(ambiguousBags).toEqual(["38"]);
  });
  it("leaves bags of unlinked products alone", () => {
    expect(byId.has("99")).toBe(false);
  });
  it("names groups from the recipe's pack size, not a product name", () => {
    expect(kindLabel("pack", 2)).toBe("2-pack");
    expect(kindLabel("pack", 1)).toBe("Pack");
    expect(kindLabel("bag", 2)).toBe("8-pack bag");
    expect(kindLabel("wonky", 2)).toBe("Wonky pack");
  });
});

describe("setting a barcode — duplicate check", () => {
  const holders: BarcodeHolder[] = [
    { variantId: "11", barcode: "5065018206054", name: "Margherita · 2 Pack", recipeName: "Margherita" },
    { variantId: "12", barcode: "5065018206054", name: "Margherita (old) · 2 Pack", recipeName: "Margherita" },
    { variantId: "21", barcode: "5065018206207", name: "Garlic Cheese · 2 Pack", recipeName: "Garlic Cheese" },
    { variantId: "77", barcode: "036000291452", name: "Burger Sauce · Bottle", recipeName: null },
  ];
  it("allows the same number across the listings of one group", () => {
    expect(checkNewBarcode("5065018206054", ["11", "12"], holders)).toMatchObject({ ok: true, digits: "5065018206054" });
  });
  it("refuses a number on another product, naming it", () => {
    const r = checkNewBarcode("5065018206207", ["11", "12"], holders);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("Garlic Cheese · 2 Pack");
      expect(r.clash?.variantId).toBe("21");
    }
  });
  it("catches a UPC-A typed as its 13-digit EAN form", () => {
    const r = checkNewBarcode("0036000291452", ["11"], holders);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not linked to a recipe");
  });
  it("refuses invalid numbers and blanks before looking for duplicates", () => {
    expect(checkNewBarcode("5065018206055", ["11"], holders)).toMatchObject({ ok: false });
    const blank = checkNewBarcode("  ", ["11"], holders);
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.reason).toContain("not removed");
  });
  it("gtinKey pads numbers to 14 digits", () => {
    expect(gtinKey("036000291452")).toBe(gtinKey("0036000291452"));
    expect(gtinKey("ABC")).toBe("abc");
  });
});

describe("pull / hourly check classification", () => {
  const linked = (ours: string | null, theirs: string | null | undefined, pushPending = false) =>
    decidePull({ linked: true, ours, pushPending, shopify: theirs === undefined ? null : { barcode: theirs } });

  it("filled: we had none, Shopify had one", () => {
    expect(linked(null, "5065018206054")).toEqual({ outcome: "filled", setOurs: "5065018206054", clearPending: false, invalid: false });
  });
  it("unchanged: same both sides (spaces ignored)", () => {
    const d = linked("5065018206054", " 5065018206054");
    expect(d.outcome).toBe("unchanged");
    expect(d).not.toHaveProperty("setOurs");
  });
  it("conflict: both set and different — neither side is changed", () => {
    const d = linked("5065018206054", "5065018206207");
    expect(d.outcome).toBe("conflict");
    expect(d.setOurs).toBeUndefined();
  });
  it("missing: Shopify has no barcode", () => {
    expect(linked("5065018206054", null).outcome).toBe("missing");
    expect(linked(null, "").outcome).toBe("missing");
  });
  it("not in Shopify: the variant is gone", () => {
    expect(linked("5065018206054", undefined).outcome).toBe("not-in-shopify");
  });
  it("invalid: still stored, but flagged", () => {
    const d = linked(null, "31035957422417");
    expect(d).toMatchObject({ outcome: "filled", setOurs: "31035957422417", invalid: true });
    expect(linked("97748478844497", "97748478844497")).toMatchObject({ outcome: "unchanged", invalid: true });
  });
  it("a waiting push is never mistaken for a conflict, and clears once Shopify matches", () => {
    expect(linked("5065018206054", "5065018206207", true).outcome).toBe("pending");
    expect(linked("5065018206054", null, true).outcome).toBe("pending");
    expect(linked("5065018206054", "5065018206054", true)).toMatchObject({ outcome: "unchanged", clearPending: true });
  });
  it("unlinked variants follow Shopify (it is their only source)", () => {
    expect(decidePull({ linked: false, ours: "1", pushPending: false, shopify: { barcode: "5065018206054" } }))
      .toMatchObject({ outcome: "followed", setOurs: "5065018206054" });
    expect(decidePull({ linked: false, ours: "5065018206054", pushPending: false, shopify: { barcode: "5065018206054" } }).outcome)
      .toBe("followed-unchanged");
  });
  it("an unlinked variant with an unsent change keeps ours", () => {
    expect(decidePull({ linked: false, ours: "5065018206054", pushPending: true, shopify: { barcode: "5065018206207" } }).outcome).toBe("pending");
  });
  it("counts outcomes and invalids", () => {
    const c = countOutcomes([linked(null, "5065018206054"), linked("5065018206054", "5065018206207"), linked(null, "31035957422417"), linked(null, null)]);
    expect(c).toMatchObject({ filled: 2, conflict: 1, missing: 1, invalid: 1 });
  });
  it("'Different in Shopify' only when both are set, differ and nothing is waiting", () => {
    const base = { ours: "5065018206054", shopifyBarcode: "5065018206207", shopifyCheckedAt: new Date(), pushPending: false };
    expect(isDifferentInShopify(base)).toBe(true);
    expect(isDifferentInShopify({ ...base, pushPending: true })).toBe(false);
    expect(isDifferentInShopify({ ...base, shopifyBarcode: "5065018206054" })).toBe(false);
    expect(isDifferentInShopify({ ...base, shopifyCheckedAt: null })).toBe(false);
  });
});

describe("push result handling", () => {
  const wanted = { variantId: "11", barcode: "5065018206054" };
  it("sent when Shopify saves the number", () => {
    expect(decidePush({ kind: "answered", userErrors: [], saved: [{ variantId: "11", barcode: "5065018206054" }] }, wanted)).toEqual({ state: "sent" });
  });
  it("blocked writes leave it pending with the reason", () => {
    const r = decidePush({ kind: "blocked" }, wanted);
    expect(r).toMatchObject({ state: "pending", result: "blocked" });
    if (r.state === "pending") expect(r.reason).toContain("BLOCK_SHOPIFY_WRITES");
  });
  it("a missing permission names the scope", () => {
    const r = decidePush({ kind: "missing-scope", scopes: ["write_products"] }, wanted);
    expect(r).toMatchObject({ state: "pending", result: "blocked" });
    if (r.state === "pending") expect(r.reason).toContain("write_products");
  });
  it("Shopify's userErrors and transport failures are pending + failed", () => {
    expect(decidePush({ kind: "answered", userErrors: ["Barcode is invalid"], saved: [] }, wanted)).toMatchObject({ state: "pending", result: "failed" });
    expect(decidePush({ kind: "error", message: "Shopify GraphQL error 502" }, wanted)).toMatchObject({ state: "pending", result: "failed" });
  });
  it("an answer that doesn't show the new number isn't trusted", () => {
    expect(decidePush({ kind: "answered", userErrors: [], saved: [{ variantId: "11", barcode: "999" }] }, wanted)).toMatchObject({ state: "pending" });
  });
  it("missingScopes", () => {
    expect(missingScopes(["read_products"])).toEqual(["write_products"]);
    expect(missingScopes(["read_products", "write_products"])).toEqual([]);
  });
});

describe("packing scan — live barcode map", () => {
  const lines = [
    { variantId: "11", barcode: "5065018206054", sku: "6", title: "Margherita" },
    { variantId: "21", barcode: null, sku: "4a", title: "Garlic Cheese" },
  ];
  it("a barcode saved in the app beats the one the orders arrived with", () => {
    expect(barcodeFor("21", null, { "21": "5065018206207" })).toBe("5065018206207");
    expect(barcodeFor(11, "5065018206054", { "11": "5065018206061" })).toBe("5065018206061");
    expect(barcodeFor("11", "5065018206054", {})).toBe("5065018206054");
    expect(barcodeFor(null, "x", { "11": "y" })).toBe("x");
    expect(barcodeFor("11", "5065018206054", null)).toBe("5065018206054");
  });
  it("matches on barcode after the live map is applied", () => {
    const live = { "21": "5065018206207" };
    const withLive = lines.map(l => ({ ...l, barcode: barcodeFor(l.variantId, l.barcode, live) }));
    expect(matchScan("5065018206207", withLive)?.variantId).toBe("21");
    expect(matchScan("5065018206207", lines)).toBeNull();
  });
  it("matches a UPC read as EAN-13, then SKU, then title", () => {
    const upc = [{ barcode: "036000291452", sku: null, title: "Sauce" }];
    expect(matchScan("0036000291452", upc)).toBe(upc[0]);
    expect(matchScan("4A", lines)?.variantId).toBe("21");
    expect(matchScan("marg", lines)?.variantId).toBe("11");
    expect(matchScan("   ", lines)).toBeNull();
  });
  it("refreshes the live map on a missed barcode, but not on every keystroke-like miss", () => {
    expect(shouldRefreshOnMiss("5065018206207", null, 1000)).toBe(true);
    expect(shouldRefreshOnMiss("5065018206207", 0, 1000)).toBe(false);
    expect(shouldRefreshOnMiss("5065018206207", 0, 2500)).toBe(true);
    expect(shouldRefreshOnMiss("marg", null, 1000)).toBe(false);
    expect(shouldRefreshOnMiss("123", null, 1000)).toBe(false);
  });
});
