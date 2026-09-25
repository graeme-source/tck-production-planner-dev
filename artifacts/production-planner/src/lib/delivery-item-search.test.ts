import { describe, it, expect } from "vitest";
import {
  compactCode,
  editDistanceWithin,
  inferDeliverySupplier,
  normaliseSearchText,
  searchDeliveryItems,
  type DeliveryCatalogueItem,
} from "./delivery-item-search";

let nextId = 1;
function item(p: Partial<DeliveryCatalogueItem> & { name: string }): DeliveryCatalogueItem {
  return {
    id: nextId++,
    category: null,
    unit: "kg",
    packWeight: 1,
    costPerPack: 1,
    stockInPacks: false,
    brand: null,
    supplierPartNumber: null,
    supplierId: null,
    supplierName: null,
    secondarySupplierId: null,
    secondarySupplierName: null,
    ...p,
  };
}

const MOZZ = item({ name: "Mozzarella Grated", brand: "Galbani", supplierPartNumber: "A 35006", supplierId: 1, supplierName: "Brakes Food Service" });
const BASIL = item({ name: "Basil", brand: "Sysco Classic", supplierPartNumber: "B-1200", supplierId: 1, supplierName: "Brakes Food Service", secondarySupplierId: 9, secondarySupplierName: "Waterdene" });
const BOX = item({ name: "Calzone box 12 inch", category: "packaging", unit: "pieces", supplierPartNumber: "12x5 Portions", supplierId: 4, supplierName: "Kite Packaging" });
const TRAY = item({ name: "Foil tray", category: "packaging", unit: "pieces", supplierPartNumber: "12x5 Portions", supplierId: 4, supplierName: "Kite Packaging" });
const CHICKEN = item({ name: "Chicken thigh boneless", supplierPartNumber: "CT-9", supplierId: 2, supplierName: "Johal Poultry" });
const ALL = [MOZZ, BASIL, BOX, TRAY, CHICKEN];

const ids = (hits: ReturnType<typeof searchDeliveryItems>) => hits.map(h => h.item.id);

describe("normalising", () => {
  it("lower-cases, strips accents and punctuation", () => {
    expect(normaliseSearchText("  Crème-Fraîche (1L) ")).toBe("creme fraiche 1l");
  });
  it("compacts codes so spacing and dashes don't matter", () => {
    expect(compactCode("A 35006")).toBe("a35006");
    expect(compactCode("b-1200")).toBe("b1200");
  });
  it("bounded edit distance", () => {
    expect(editDistanceWithin("mozarella", "mozzarella", 2)).toBe(1);
    expect(editDistanceWithin("basil", "chicken", 1)).toBe(2);
  });
});

describe("searchDeliveryItems", () => {
  it("finds by name", () => {
    expect(ids(searchDeliveryItems(ALL, "basil"))).toEqual([BASIL.id]);
  });

  it("forgives a typo", () => {
    expect(ids(searchDeliveryItems(ALL, "mozarella"))[0]).toBe(MOZZ.id);
    expect(ids(searchDeliveryItems(ALL, "chiken"))[0]).toBe(CHICKEN.id);
  });

  it("finds by supplier name, first or second supplier", () => {
    expect(ids(searchDeliveryItems(ALL, "brakes")).sort()).toEqual([MOZZ.id, BASIL.id].sort());
    expect(ids(searchDeliveryItems(ALL, "waterdene"))).toEqual([BASIL.id]);
  });

  it("finds by brand", () => {
    expect(ids(searchDeliveryItems(ALL, "galbani"))).toEqual([MOZZ.id]);
  });

  it("finds by item number however it's typed", () => {
    for (const q of ["A 35006", "a35006", "A35006", "35006"]) {
      const hits = searchDeliveryItems(ALL, q);
      expect(ids(hits)[0], q).toBe(MOZZ.id);
      expect(hits[0].matchedOn).toContain("partNumber");
    }
    expect(ids(searchDeliveryItems(ALL, "b1200"))).toEqual([BASIL.id]);
  });

  it("returns EVERY item sharing a part number — they aren't unique", () => {
    expect(ids(searchDeliveryItems(ALL, "12x5 portions")).sort()).toEqual([BOX.id, TRAY.id].sort());
  });

  it("needs every word to match, in any order", () => {
    expect(ids(searchDeliveryItems(ALL, "grated mozzarella"))).toEqual([MOZZ.id]);
    expect(ids(searchDeliveryItems(ALL, "brakes basil"))).toEqual([BASIL.id]);
    expect(searchDeliveryItems(ALL, "basil tray")).toEqual([]);
  });

  it("puts a name that starts with the search above one that merely contains it", () => {
    const a = item({ name: "Tray liner" });
    const b = item({ name: "Foil tray" });
    expect(ids(searchDeliveryItems([b, a], "tray"))[0]).toBe(a.id);
  });

  it("narrows to the chosen supplier (including items where they're the second supplier)", () => {
    expect(ids(searchDeliveryItems(ALL, "", { supplierId: 9 }))).toEqual([BASIL.id]);
    expect(ids(searchDeliveryItems(ALL, "tray", { supplierId: 1 }))).toEqual([]);
    expect(ids(searchDeliveryItems(ALL, "", { supplierId: 4 }))).toEqual([BOX.id, TRAY.id]);
  });

  it("shows nothing for an empty box with no supplier chosen", () => {
    expect(searchDeliveryItems(ALL, "   ")).toEqual([]);
  });
});

describe("inferDeliverySupplier", () => {
  it("prefers the supplier the person picked", () => {
    expect(inferDeliverySupplier(9, BASIL)).toBe(9);
  });
  it("falls back to the first item's usual supplier, then its second", () => {
    expect(inferDeliverySupplier(null, BASIL)).toBe(1);
    expect(inferDeliverySupplier(null, item({ name: "x", secondarySupplierId: 5 }))).toBe(5);
  });
  it("returns null when nobody knows — the UI then asks", () => {
    expect(inferDeliverySupplier(null, item({ name: "x" }))).toBeNull();
    expect(inferDeliverySupplier(null, null)).toBeNull();
  });
});
