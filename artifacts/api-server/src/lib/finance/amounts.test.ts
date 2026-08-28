import { describe, it, expect } from "vitest";
import { extractAmounts } from "./amounts";

describe("extractAmounts", () => {
  it("finds plain, symbol and thousand-separated amounts", () => {
    const t = "Total: £1,682.50. Subtotal 1402.08, VAT $280.42, ref 20260827";
    expect(extractAmounts(t)).toEqual(["1682.50", "1402.08", "280.42"]);
  });

  it("dedupes and skips zero/implausible values", () => {
    expect(extractAmounts("0.00 and 15.98 and 15.98 and 999999.99")).toEqual(["15.98"]);
  });

  it("returns empty for amount-free text", () => {
    expect(extractAmounts("Your order has been dispatched")).toEqual([]);
  });
});
