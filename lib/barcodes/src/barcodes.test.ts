import { describe, expect, it } from "vitest";
import {
  barcodeFor, checkGtin, countOutcomes, decidePull, decideScan, deriveLinkedVariants, describeClash, gtinCheckDigit, gtinKey,
  groupBarcode, identitiesFor, isDifferentInShopify, kindLabel, planAssignment, planScanBarcodes, rankOf, resolveOwnership,
  scanMessage, shouldRefreshOnMiss, clubSpecialScan, isClubSpecialTitle, CLUB_SPECIAL_TITLE_LC, suggestF2fLinks,
  type CopyCandidate, type PackListing, type BarcodeHolder, type Holding, type KnownCodes, type MappingRow, type ScanLine,
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

describe("setting a barcode — reuse and move", () => {
  const h = (variantId: string, identityKey: string, identityName: string, current: boolean, ours: string | null, shopify: string | null = ours): BarcodeHolder =>
    ({ variantId, name: `${identityName} listing ${variantId}`, identityKey, identityName, current, ours, shopify });
  const holders: BarcodeHolder[] = [
    h("11", "r1:pack", "Margherita · 2-pack", true, "5065018206054"),
    h("12", "r1:pack", "Margherita · 2-pack", true, "5065018206054"),
    h("21", "r2:pack", "Garlic Cheese · 2-pack", true, "5065018206207"),
    h("77", "v77", "Old test box", false, null, "5065018206344"),
    h("78", "v78", "Burger Sauce", true, null, "036000291452"),
  ];
  const margherita = { identityKey: "r1:pack", name: "Margherita · 2-pack" };

  it("listings of the same product share a number without asking", () => {
    expect(planAssignment("5065018206054", margherita, holders)).toMatchObject({ ok: true, digits: "5065018206054", release: [] });
  });
  it("a number on an old product asks 'Move it?' naming both", () => {
    const r = planAssignment("5065018206344", margherita, holders);
    expect(r).toMatchObject({ ok: false, confirm: "move" });
    if (!r.ok) expect(r.reason).toBe("This barcode belongs to Old test box. Move it to Margherita · 2-pack?");
    expect(planAssignment("5065018206344", margherita, holders, { move: true })).toMatchObject({ ok: true, movedFrom: ["Old test box"] });
  });
  it("a number a CURRENT product scans with needs the explicit second confirmation, then releases it", () => {
    const r = planAssignment("5065018206207", margherita, holders, { move: true });
    expect(r).toMatchObject({ ok: false, confirm: "take", holders: ["Garlic Cheese · 2-pack"] });
    if (!r.ok) expect(r.reason).toContain("will have NO barcode and can't be scanned");
    expect(planAssignment("5065018206207", margherita, holders, { take: true })).toMatchObject({ ok: true, release: ["21"] });
  });
  it("a number only Shopify has on another listing asks to move (UPC typed as EAN-13 too)", () => {
    expect(planAssignment("0036000291452", margherita, holders)).toMatchObject({ ok: false, confirm: "move", holders: ["Burger Sauce"] });
  });
  it("refuses invalid numbers and blanks", () => {
    expect(planAssignment("5065018206055", margherita, holders)).toMatchObject({ ok: false });
    const blank = planAssignment("  ", margherita, holders);
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.reason).toContain("not removed");
  });
  it("gtinKey pads numbers to 14 digits", () => {
    expect(gtinKey("036000291452")).toBe(gtinKey("0036000291452"));
    expect(gtinKey("ABC")).toBe("abc");
  });
});

describe("product identity — one code, one product", () => {
  const links = [
    { variantId: "11", recipeId: 1, recipeName: "The Don", kind: "pack" as const },
    { variantId: "13", recipeId: 1, recipeName: "The Don", kind: "wonky" as const },
    { variantId: "18", recipeId: 1, recipeName: "The Don", kind: "bag" as const },
    { variantId: "21", recipeId: 2, recipeName: "Garlic Korma", kind: "pack" as const },
  ];
  const names = new Map([["50", "CFF The Don · 2 Pack"], ["51", "F2F The Don"], ["60", "Honey Mustard Fried Chicken"]]);
  const ids = identitiesFor(["11", "13", "18", "21", "50", "51", "60"], links, new Map([["50", "11"], ["51", "50"]]), names, new Map([[1, 2], [2, 2]]));

  it("a recipe's pack and wonky are one identity; its bag is another", () => {
    expect(ids.get("11")!.key).toBe("r1:pack");
    expect(ids.get("13")!.key).toBe("r1:pack");
    expect(ids.get("18")!.key).toBe("r1:bag");
    expect(ids.get("11")!.name).toBe("The Don · 2-pack");
  });
  it("'same product as' follows the chain to a recipe", () => {
    expect(ids.get("50")!.key).toBe("r1:pack");
    expect(ids.get("51")!.key).toBe("r1:pack");
  });
  it("anything else is its own product", () => {
    expect(ids.get("60")).toEqual({ key: "v60", name: "Honey Mustard Fried Chicken" });
  });
  it("a 'same product as' loop ends without hanging", () => {
    const loop = identitiesFor(["a", "b"], [], new Map([["a", "b"], ["b", "a"]]), new Map());
    expect(loop.size).toBe(2);
  });

  const hold = (variantId: string, barcode: string | null, extra: Partial<Holding> = {}): Holding =>
    ({ variantId, name: names.get(variantId) ?? variantId, barcode, identity: ids.get(variantId)!, current: true, setInApp: false, linkKind: links.find(l => l.variantId === variantId)?.kind, ...extra });

  it("copies of the same product share a code with no clash", () => {
    const o = resolveOwnership([hold("11", "5065018206344"), hold("50", "5065018206344"), hold("13", "5065018206344")]);
    expect(o.clashes).toEqual([]);
    expect(o.barcodeOf.get("50")).toBe("5065018206344");
  });
  it("current vs current: the recipe's pack keeps it, the other product loses it and it is listed", () => {
    const o = resolveOwnership([hold("11", "5065018206344"), hold("60", "5065018206344")]);
    expect(o.barcodeOf.get("11")).toBe("5065018206344");
    expect(o.barcodeOf.get("60")).toBeNull();
    expect(o.clashes).toHaveLength(1);
    expect(o.clashes[0].keeper?.identity.key).toBe("r1:pack");
    expect(describeClash(o.clashes[0])).toContain("Honey Mustard Fried Chicken");
  });
  it("a pack beats a bag; a code set in the app beats both", () => {
    expect(resolveOwnership([hold("18", "5065018206320"), hold("21", "5065018206320")]).barcodeOf.get("21")).toBe("5065018206320");
    const o = resolveOwnership([hold("18", "5065018206320", { setInApp: true }), hold("21", "5065018206320")]);
    expect(o.barcodeOf.get("18")).toBe("5065018206320");
    expect(o.barcodeOf.get("21")).toBeNull();
  });
  it("two different products tied for best: NOBODY can scan with it", () => {
    const o = resolveOwnership([hold("11", "5065018206399"), hold("21", "5065018206399")]);
    expect(o.barcodeOf.get("11")).toBeNull();
    expect(o.barcodeOf.get("21")).toBeNull();
    expect(o.clashes[0].keeper).toBeNull();
  });
  it("a retired product never claims a code; a reused code is listed as information, not a clash", () => {
    const o = resolveOwnership([hold("11", "5065018206344"), hold("60", "5065018206344", { current: false })]);
    expect(o.barcodeOf.get("11")).toBe("5065018206344");
    expect(o.barcodeOf.get("60")).toBeNull();
    expect(o.clashes).toEqual([]);
    expect(o.reused).toHaveLength(1);
    expect(o.reused[0].current?.identity.key).toBe("r1:pack");
    expect(o.reused[0].retired).toEqual([{ variantId: "60", name: "Honey Mustard Fried Chicken" }]);
    expect(resolveOwnership([hold("60", "5065018206344", { current: false })]).barcodeOf.get("60")).toBeNull();
  });
  it("rankOf", () => {
    expect(rankOf({ setInApp: true, linkKind: "bag" })).toBe(0);
    expect(rankOf({ setInApp: false, linkKind: "wonky" })).toBe(1);
    expect(rankOf({ setInApp: false })).toBe(3);
  });
});

describe("pull / hourly check classification", () => {
  const linked = (ours: string | null, theirs: string | null | undefined) =>
    decidePull({ linked: true, ours, shopify: theirs === undefined ? null : { barcode: theirs } });

  it("filled: we had none, Shopify had one", () => {
    expect(linked(null, "5065018206054")).toEqual({ outcome: "filled", setOurs: "5065018206054", invalid: false });
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
  it("the hourly check never fills — it reports Shopify-only instead", () => {
    const d = decidePull({ mode: "check", linked: true, ours: null, shopify: { barcode: "5065018206054" } });
    expect(d.outcome).toBe("shopify-only");
    expect(d).not.toHaveProperty("setOurs");
    expect(decidePull({ mode: "check", linked: true, ours: "5065018206054", shopify: { barcode: "5065018206207" } }).outcome).toBe("conflict");
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
  it("a barcode set in the app is never overwritten by a check, even once unlinked", () => {
    expect(decidePull({ mode: "check", linked: false, setInApp: true, ours: "5065018206054", shopify: { barcode: "5065018206207" } }).outcome).toBe("conflict");
  });
  it("unlinked variants follow Shopify (it is their only source)", () => {
    expect(decidePull({ linked: false, ours: "1", shopify: { barcode: "5065018206054" } }))
      .toMatchObject({ outcome: "followed", setOurs: "5065018206054" });
    expect(decidePull({ linked: false, ours: "5065018206054", shopify: { barcode: "5065018206054" } }).outcome)
      .toBe("followed-unchanged");
  });
  it("retired products stop claiming a barcode", () => {
    expect(decidePull({ linked: false, current: false, ours: "5065018206344", shopify: { barcode: "5065018206344" } })).toEqual({ outcome: "retired", setOurs: null, invalid: false });
    expect(decidePull({ linked: true, current: false, ours: null, shopify: { barcode: "5065018206344" } })).toEqual({ outcome: "retired", invalid: false });
  });
  it("counts outcomes and invalids", () => {
    const c = countOutcomes([linked(null, "5065018206054"), linked("5065018206054", "5065018206207"), linked(null, "31035957422417"), linked(null, null)]);
    expect(c).toMatchObject({ filled: 2, conflict: 1, missing: 1, invalid: 1 });
  });
  it("'Different in Shopify' when Shopify has a number that isn't ours", () => {
    const base = { ours: "5065018206054", shopifyBarcode: "5065018206207", shopifyCheckedAt: new Date() };
    expect(isDifferentInShopify(base)).toBe(true);
    expect(isDifferentInShopify({ ...base, notInShopify: true })).toBe(false);
    expect(isDifferentInShopify({ ...base, shopifyBarcode: "5065018206054" })).toBe(false);
    expect(isDifferentInShopify({ ...base, shopifyCheckedAt: null })).toBe(false);
    expect(isDifferentInShopify({ ...base, ours: null })).toBe(true);
    expect(isDifferentInShopify({ ...base, shopifyBarcode: null })).toBe(false);
  });
  it("a group shares one barcode; different numbers are 'mixed'", () => {
    expect(groupBarcode(["5065018206054", " 5065018206054", null])).toEqual({ barcode: "5065018206054", mixed: false });
    expect(groupBarcode(["5065018206054", "5065018206207"])).toEqual({ barcode: null, mixed: true });
    expect(groupBarcode([null, ""])).toEqual({ barcode: null, mixed: false });
  });
});

describe("packing scan — safety", () => {
  const line = (key: string, barcode: string | null, identityKey: string | null, name: string, remaining = 1, sku: string | null = null): ScanLine =>
    ({ key, barcode, identityKey, name, sku, title: name, remaining });
  const lines = [
    line("v11", "5065018206054", "r1:pack", "Margherita", 2, "6"),
    line("v21", null, "r2:pack", "Garlic Cheese", 1, "4a"),
    line("v31", "5065018206061", "r3:pack", "Godfather", 0),
  ];
  const known: KnownCodes = { [gtinKey("5065018206344")]: { identityKey: "r9:pack", name: "The Don · 2-pack" } };

  it("once the live map has loaded it is the only authority", () => {
    expect(barcodeFor("21", null, { "21": "5065018206207" })).toBe("5065018206207");
    expect(barcodeFor(11, "5065018206054", { "11": "5065018206061" })).toBe("5065018206061");
    expect(barcodeFor("11", "5065018206054", {})).toBeNull();
    expect(barcodeFor(null, "x", { "11": "y" })).toBeNull();
    expect(barcodeFor("11", "5065018206054", null)).toBe("5065018206054");
  });
  it("an exact barcode ticks its line (UPC read as EAN-13 included)", () => {
    expect(decideScan("5065018206054", lines, known)).toEqual({ kind: "tick", key: "v11" });
    expect(decideScan("036000291452", [line("s", "0036000291452", "v5", "Sauce")], {})).toEqual({ kind: "tick", key: "s" });
  });
  it("a code belonging to another product is 'Wrong item' — never a tick", () => {
    const d = decideScan("5065018206344", lines, known);
    expect(d).toEqual({ kind: "wrong-item", product: "The Don · 2-pack" });
    expect(scanMessage(d)).toBe("Wrong item — this is The Don · 2-pack.");
  });
  it("a fully picked line says so", () => {
    expect(decideScan("5065018206061", lines, known)).toMatchObject({ kind: "already-picked", key: "v31" });
  });
  it("digits never fall back to SKU or title", () => {
    expect(decideScan("6", lines, known)).toEqual({ kind: "unknown-barcode" });
    expect(decideScan("5065018206", lines, known)).toEqual({ kind: "unknown-barcode" });
  });
  it("a code on two different products' lines is refused", () => {
    const d = decideScan("5065018206054", [...lines, line("v41", "5065018206054", "r4:pack", "Pepperoni")], known);
    expect(d).toEqual({ kind: "ambiguous", products: ["Margherita", "Pepperoni"] });
  });
  it("typed text needs an EXACT SKU or title — no partial title match", () => {
    expect(decideScan("4A", lines, known)).toEqual({ kind: "tick", key: "v21" });
    expect(decideScan("garlic cheese", lines, known)).toEqual({ kind: "tick", key: "v21" });
    expect(decideScan("marg", lines, known)).toEqual({ kind: "no-match" });
    expect(decideScan("   ", lines, known)).toEqual({ kind: "no-match" });
  });
  it("a typed SKU shared by two products is refused (SKUs are shelf labels)", () => {
    const shelf = [line("a", null, "r1:pack", "Garlic Cheese", 1, "4a"), line("b", null, "r5:pack", "Big Nanny's", 1, "4a")];
    expect(decideScan("4a", shelf, {})).toMatchObject({ kind: "ambiguous" });
  });
  it("scan queue: our table first; Shopify only for variants we hold no row for", () => {
    const plan = planScanBarcodes(["11", "21", "31"], new Map<string, string | null>([["11", "5065018206054"], ["21", null]]));
    expect(plan.barcodes).toEqual({ "11": "5065018206054" });
    expect(plan.askShopify).toEqual(["31"]);
  });
  it("refreshes the live map on a missed barcode, but not on every keystroke-like miss", () => {
    expect(shouldRefreshOnMiss("5065018206207", null, 1000)).toBe(true);
    expect(shouldRefreshOnMiss("5065018206207", 0, 1000)).toBe(false);
    expect(shouldRefreshOnMiss("5065018206207", 0, 2500)).toBe(true);
    expect(shouldRefreshOnMiss("marg", null, 1000)).toBe(false);
    expect(shouldRefreshOnMiss("123", null, 1000)).toBe(false);
  });
});

describe("Calzone Club Special — follows the current special", () => {
  const known: KnownCodes = {
    [gtinKey("5065018206399")]: { identityKey: "r26:pack", name: "Philly Cheesesteak 2.0 · 2-pack" },
    [gtinKey("5065018206467")]: { identityKey: "r25:pack", name: "The Benji · 2-pack" },
    [gtinKey("5065018206146")]: { identityKey: "r3:bag", name: "BBQ Pulled Pork · 8-pack bag" },
  };
  it("recognises the Club Special by its product title, one copy of the rule", () => {
    expect(isClubSpecialTitle(" Calzone Club Special ")).toBe(true);
    expect(isClubSpecialTitle("Calzone Club Special Box")).toBe(false);
    expect(CLUB_SPECIAL_TITLE_LC).toBe("calzone club special");
  });
  it("its identity IS the current special's pack", () => {
    const ids = identitiesFor(["cs", "26"], [{ variantId: "26", recipeId: 26, recipeName: "Philly Cheesesteak 2.0", kind: "pack" }], new Map(), new Map(),
      new Map([[26, 2]]), { variantIds: new Set(["cs"]), recipeId: 26, recipeName: "Philly Cheesesteak 2.0" });
    expect(ids.get("cs")).toEqual({ key: "r26:pack", name: "Philly Cheesesteak 2.0 · 2-pack" });
    expect(ids.get("cs")!.key).toBe(ids.get("26")!.key);
  });
  it("scans with the special's barcode; in step with Shopify = nothing to flag", () => {
    expect(clubSpecialScan("5065018206399", "r26:pack", "5065018206399", known)).toEqual({ barcode: "5065018206399", alsoAccepts: [], changing: false, unexpected: false });
  });
  it("changeover: Shopify already has the INCOMING special's code — expected, and accepted too", () => {
    const s = clubSpecialScan("5065018206399", "r26:pack", "5065018206467", known);
    expect(s).toEqual({ barcode: "5065018206399", alsoAccepts: [{ code: "5065018206467", identityKey: "r25:pack", name: "The Benji · 2-pack" }], changing: true, unexpected: false });
  });
  it("a code that is no recipe's pack is never accepted (a bag, or unknown)", () => {
    expect(clubSpecialScan("5065018206399", "r26:pack", "5065018206146", known)).toMatchObject({ alsoAccepts: [], changing: false, unexpected: true });
    expect(clubSpecialScan("5065018206399", "r26:pack", "5065018209994", known)).toMatchObject({ alsoAccepts: [], unexpected: true });
  });
  it("no special set: nothing to scan with", () => {
    expect(clubSpecialScan(null, null, null, known)).toMatchObject({ barcode: null, alsoAccepts: [] });
  });
  it("the scanner ticks the Club Special line with either special during a changeover, and refuses anything else", () => {
    const club: ScanLine = { key: "cs", barcode: "5065018206399", identityKey: "r26:pack", name: "Calzone Club Special", sku: null, title: "Calzone Club Special", remaining: 1,
      alsoAccepts: [{ code: "5065018206467", identityKey: "r25:pack", name: "The Benji · 2-pack" }] };
    expect(decideScan("5065018206399", [club], known)).toEqual({ kind: "tick", key: "cs" });
    expect(decideScan("5065018206467", [club], known)).toEqual({ kind: "tick", key: "cs" });
    expect(decideScan("5065018206146", [club], known)).toEqual({ kind: "wrong-item", product: "BBQ Pulled Pork · 8-pack bag" });
  });
  it("Club Special next to the incoming special's own 2-pack: same product, so no 'ambiguous'", () => {
    const club: ScanLine = { key: "cs", barcode: "5065018206399", identityKey: "r26:pack", name: "Calzone Club Special", sku: null, title: null, remaining: 1,
      alsoAccepts: [{ code: "5065018206467", identityKey: "r25:pack", name: "The Benji · 2-pack" }] };
    const benji: ScanLine = { key: "b", barcode: "5065018206467", identityKey: "r25:pack", name: "The Benji · 2-pack", sku: null, title: null, remaining: 1 };
    expect(decideScan("5065018206467", [club, benji], known)).toEqual({ kind: "tick", key: "cs" });
  });
});

describe("F2F copies — the same pack, marked once", () => {
  const packs: PackListing[] = [
    { variantId: "11", recipeId: 2, name: "Chicken & Chorizo · 2 Pack", productName: "Chicken and Chorizo · 2-pack", barcode: "5065018206009" },
    { variantId: "12", recipeId: 2, name: "Chicken & Chorizo (old) · 2 Pack", productName: "Chicken and Chorizo · 2-pack", barcode: "5065018206009" },
    { variantId: "21", recipeId: 3, name: "BBQ Pulled Pork · 2 Pack", productName: "BBQ Pulled Pork · 2-pack", barcode: "5065018206016" },
    { variantId: "31", recipeId: 4, name: "A", productName: "A · 2-pack", barcode: "5065018206054" },
    { variantId: "32", recipeId: 5, name: "B", productName: "B · 2-pack", barcode: "5065018206054" },
  ];
  const c = (variantId: string, productTitle: string, barcode: string | null, extra: Partial<CopyCandidate> = {}): CopyCandidate =>
    ({ variantId, name: productTitle, productTitle, current: true, linked: false, sameProductAs: null, barcode, ...extra });

  it("links each current F2F copy to the recipe pack with the same barcode", () => {
    const r = suggestF2fLinks([c("f1", "F2F - Chicken & Chorizo", "5065018206009"), c("f2", "F2F - BBQ Pulled Pork", "5065018206016")], packs);
    expect(r.map(x => [x.variantId, x.sameAs, x.sameAsName])).toEqual([["f2", "21", "BBQ Pulled Pork · 2-pack"], ["f1", "11", "Chicken and Chorizo · 2-pack"]]);
  });
  it("leaves alone: non-F2F titles, retired, already marked, linked, no/unknown barcode, a code shared by two recipes", () => {
    expect(suggestF2fLinks([
      c("x1", "Yangnyeom Strips + Rice", "5065018206009"),
      c("x2", "F2F - Chicken & Chorizo", "5065018206009", { current: false }),
      c("x3", "F2F - Chicken & Chorizo", "5065018206009", { sameProductAs: "11" }),
      c("x4", "F2F - Chicken & Chorizo", "5065018206009", { linked: true }),
      c("x5", "F2F - Mystery", null),
      c("x6", "F2F - Mystery", "5065018209994"),
      c("x7", "F2F - Ambiguous", "5065018206054"),
      c("x8", "Chicken no Chorizo (F2F)", "5065018206009"),
    ], packs)).toEqual([]);
  });
});
