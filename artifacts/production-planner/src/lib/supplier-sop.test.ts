// Regression (Fix queue #390): an SOP can only sit on one supplier's Orders
// card if it attaches to that supplier by id, not to the whole Orders page.
import { describe, expect, it } from "vitest";
import { supplierSopAttachTarget } from "./supplier-sop";

describe("supplierSopAttachTarget", () => {
  it("attaches to the one supplier, keyed by its id", () => {
    expect(supplierSopAttachTarget({ id: 12, name: "Brakes" })).toEqual({ targetType: "supplier", a: 12, label: "Brakes" });
  });
});
