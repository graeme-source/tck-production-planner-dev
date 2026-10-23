import { describe, it, expect } from "vitest";
import { supplierCallStrip } from "./supplier-call-strip";

// #332: Front Door delivery cards show who to ring and our account number.
describe("supplierCallStrip", () => {
  it("shows the phone and account number", () => {
    expect(supplierCallStrip({ phone: "01827 303770", accountNumber: "1867332" }))
      .toEqual({ phone: "01827 303770", accountNumber: "1867332" });
  });
  it("falls back to the ordering line when there's no main number", () => {
    expect(supplierCallStrip({ phone: " ", orderingPhone: "0800 123", accountNumber: null }))
      .toEqual({ phone: "0800 123", accountNumber: null });
  });
  it("shows the account number alone when there's no phone", () => {
    expect(supplierCallStrip({ accountNumber: " 123456 " })).toEqual({ phone: null, accountNumber: "123456" });
  });
  it("is hidden when there's nothing to show", () => {
    expect(supplierCallStrip({ phone: null, orderingPhone: "", accountNumber: "  " })).toBeNull();
    expect(supplierCallStrip(undefined)).toBeNull();
  });
});
