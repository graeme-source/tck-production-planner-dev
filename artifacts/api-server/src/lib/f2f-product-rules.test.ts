import { describe, expect, it } from "vitest";
import {
  F2F_STANDARD_TAGS, f2fCreateBlockers, f2fProductType, f2fStripReason, f2fTagsFromMain, f2fTitle,
  isF2fOf, manualCollections, pickF2fLinkVariant, pickMainProduct, zeroOnHandChanges,
} from "./f2f-product-rules";

describe("f2fTagsFromMain", () => {
  it("always gives the standard F2F set, first, in its own spelling", () => {
    expect(f2fTagsFromMain([]).tags).toEqual(["Clearance", "F2F", "show", "Wonkyzone", "no-wholesale"]);
    expect(f2fTagsFromMain(["f2f", "CLEARANCE", "Show", "wonkyzone", "No-Wholesale"]).tags).toEqual([...F2F_STANDARD_TAGS]);
  });

  it("strips Meals so it never lands in the Meals collection", () => {
    const p = f2fTagsFromMain(["Meals", "BBQ"]);
    expect(p.tags).not.toContain("Meals");
    expect(p.stripped.map(s => s.tag)).toEqual(["Meals"]);
    expect(f2fTagsFromMain(["meals"]).tags.map(t => t.toLowerCase())).not.toContain("meals");
  });

  it("strips calzones / Calzones (the Calzones collection)", () => {
    const p = f2fTagsFromMain(["calzones", "Calzones", "Calzone"]);
    expect(p.kept).toEqual([]);
    expect(p.stripped).toHaveLength(3);
  });

  it("strips wholesale-g and adds no-wholesale", () => {
    const p = f2fTagsFromMain(["wholesale-g"]);
    expect(p.tags).not.toContain("wholesale-g");
    expect(p.tags).toContain("no-wholesale");
    expect(f2fTagsFromMain(["wholesale-trade"]).kept).toEqual([]);
  });

  it("strips 6 Week and other N-week rotation tags", () => {
    for (const t of ["6 Week", "6 week", "6-Week", "12 Weeks", "6week"]) expect(f2fStripReason(t)).not.toBeNull();
  });

  it("strips test-box tags", () => {
    for (const t of ["Winter Warmers Test Box", "Mexican test box", "test-box", "TestBox"]) expect(f2fStripReason(t)).not.toBeNull();
  });

  it("strips Carnivore Club and other clubs, zero-price and Draft", () => {
    for (const t of ["Carnivore Club", "carnivore club", "Veggie Club", "zero-price", "Zero Price", "Draft", "draft-hidden"]) {
      expect(f2fStripReason(t)).not.toBeNull();
    }
  });

  it("keeps the main's category tags (BBQ, macaroni-cheese, fried-chicken) and 'fixed'", () => {
    const p = f2fTagsFromMain(["Meals", "6 Week", "BBQ", "macaroni-cheese", "fried-chicken", "fixed", "wholesale-g", "Calzones"]);
    expect(p.kept).toEqual(["BBQ", "macaroni-cheese", "fried-chicken", "fixed"]);
    expect(p.tags).toEqual(["Clearance", "F2F", "show", "Wonkyzone", "no-wholesale", "BBQ", "macaroni-cheese", "fried-chicken", "fixed"]);
  });

  it("de-duplicates ignoring case and drops blank tags", () => {
    const p = f2fTagsFromMain(["BBQ", "bbq", " ", ""]);
    expect(p.kept).toEqual(["BBQ"]);
  });

  it("a real main product's tags", () => {
    const p = f2fTagsFromMain(["6 Week", "calzones", "Carnivore Club", "Meals", "wholesale-g", "BBQ", "Winter Warmers Test Box", "zero-price", "Draft"]);
    expect(p.tags).toEqual(["Clearance", "F2F", "show", "Wonkyzone", "no-wholesale", "BBQ"]);
    expect(p.stripped).toHaveLength(8);
  });
});

describe("f2fProductType", () => {
  it("never Calzones (Dynamic Calzones is TYPE EQUALS Calzones)", () => {
    expect(f2fProductType("Calzones")).toBe("");
    expect(f2fProductType(" calzones ")).toBe("");
    expect(f2fProductType("Calzone")).toBe("");
  });
  it("keeps any other type, and blank stays blank", () => {
    expect(f2fProductType("Macaroni Cheese")).toBe("Macaroni Cheese");
    expect(f2fProductType("")).toBe("");
    expect(f2fProductType(null)).toBe("");
  });
});

describe("f2fTitle", () => {
  it("prefixes the main title", () => {
    expect(f2fTitle("12-Hour Birchstead Beef & Mushroom in Red Wine Gravy")).toBe("F2F - 12-Hour Birchstead Beef & Mushroom in Red Wine Gravy");
    expect(f2fTitle("  Garlic Cheese Calzones (v) ")).toBe("F2F - Garlic Cheese Calzones (v)");
  });
  it("refuses an F2F main or a blank one", () => {
    expect(f2fTitle("F2F - Philly")).toBeNull();
    expect(f2fTitle("")).toBeNull();
  });
});

describe("isF2fOf", () => {
  it("matches the F2F copy whatever the dash or spacing", () => {
    expect(isF2fOf("F2F - Garlic Cheese Calzones (v)", "Garlic Cheese Calzones (v)")).toBe(true);
    expect(isF2fOf("f2f – garlic cheese calzones v", "Garlic Cheese Calzones (v)")).toBe(true);
    expect(isF2fOf("F2F - Philly", "Garlic Cheese Calzones (v)")).toBe(false);
    expect(isF2fOf("Garlic Cheese Calzones (v)", "Garlic Cheese Calzones (v)")).toBe(false);
  });
});

describe("pickMainProduct", () => {
  const a = { productId: "1", title: "Philly", status: "ACTIVE", mappedVariantIds: ["11"] };
  const b = { productId: "2", title: "Philly 8 Pack", status: "ACTIVE", mappedVariantIds: ["21", "22"] };
  const f = { productId: "3", title: "F2F - Philly", status: "ACTIVE", mappedVariantIds: ["31", "32", "33"] };
  it("most linked variants wins; F2F products never count", () => {
    expect(pickMainProduct([a, b, f])?.productId).toBe("2");
    expect(pickMainProduct([f])).toBeNull();
  });
  it("first linked wins a tie", () => {
    expect(pickMainProduct([a, { ...b, mappedVariantIds: ["21"] }])?.productId).toBe("1");
  });
  it("a requested product only if it is one of the recipe's", () => {
    expect(pickMainProduct([a, b], "1")?.productId).toBe("1");
    expect(pickMainProduct([a, b], "99")).toBeNull();
    expect(pickMainProduct([a, f], "3")).toBeNull();
  });
});

describe("pickF2fLinkVariant", () => {
  const vs = [{ id: "1", title: "8 Pack" }, { id: "2", title: "2 Pack" }];
  it("matches the recipe's linked variant title", () => expect(pickF2fLinkVariant(vs, "2 pack")?.id).toBe("2"));
  it("falls back to the first", () => {
    expect(pickF2fLinkVariant(vs, "Serves 2")?.id).toBe("1");
    expect(pickF2fLinkVariant(vs, null)?.id).toBe("1");
  });
  it("none for no variants", () => expect(pickF2fLinkVariant([], "2 Pack")).toBeNull());
});

describe("f2fCreateBlockers", () => {
  const ok = { alreadyLinked: null, main: { title: "Philly", variantCount: 1 }, existingF2f: [], missingScopes: [], writesBlocked: false };
  it("nothing blocks a normal create", () => expect(f2fCreateBlockers(ok)).toEqual([]));
  it("already linked", () => expect(f2fCreateBlockers({ ...ok, alreadyLinked: { title: "F2F - Philly" } })[0]).toMatch(/already has/));
  it("no main product", () => expect(f2fCreateBlockers({ ...ok, main: null })[0]).toMatch(/isn't linked/));
  it("an F2F product already in Shopify — link it instead", () => {
    expect(f2fCreateBlockers({ ...ok, existingF2f: [{ productId: "9", title: "F2F - Philly" }] })[0]).toMatch(/link it/);
  });
  it("missing scopes block, unless writes are off anyway", () => {
    expect(f2fCreateBlockers({ ...ok, missingScopes: ["write_inventory"] })[0]).toMatch(/write_inventory/);
    expect(f2fCreateBlockers({ ...ok, missingScopes: ["write_inventory"], writesBlocked: true })).toEqual([]);
  });
});

describe("manualCollections / zeroOnHandChanges", () => {
  it("only collections without a rule set are manual", () => {
    expect(manualCollections([{ id: "1", ruleSet: null }, { id: "2", ruleSet: { rules: [] } }]).map(c => c.id)).toEqual(["1"]);
  });
  it("takes each non-zero on-hand back to 0", () => {
    expect(zeroOnHandChanges([{ locationId: "L1", onHand: 5 }, { locationId: "L2", onHand: 0 }, { locationId: "L3", onHand: -2 }, { locationId: "L4", onHand: null }]))
      .toEqual([{ locationId: "L1", delta: -5 }, { locationId: "L3", delta: 2 }]);
  });
});
