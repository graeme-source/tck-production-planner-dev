import { describe, expect, it } from "vitest";
import { estimateNetPay } from "./net-pay";

describe("estimateNetPay (2026/27, 1257L, month 1)", () => {
  it("zero pay → all zeros", () => {
    const r = estimateNetPay(0);
    expect([r.gross, r.tax, r.ni, r.pension, r.net]).toEqual([0, 0, 0, 0, 0]);
    expect(r.assumptions.length).toBeGreaterThan(0);
  });

  it("£1,000: under the personal allowance and NI threshold", () => {
    // pension 5% × (1000 − 520) = 24.00
    expect(estimateNetPay(1000)).toMatchObject({ gross: 1000, tax: 0, ni: 0, pension: 24, net: 976 });
  });

  it("£2,000: basic rate", () => {
    // tax (24,000 − 12,570) × 20% / 12 = 190.50; NI (2000 − 1048) × 8% = 76.16; pension 5% × 1480 = 74
    expect(estimateNetPay(2000)).toMatchObject({ tax: 190.5, ni: 76.16, pension: 74, net: 1659.34 });
  });

  it("£4,500: into higher rate and over the NI upper limit", () => {
    // tax (37,700 × 20% + 3,730 × 40%) / 12 = 752.67
    // NI (4189 − 1048) × 8% + (4500 − 4189) × 2% = 251.28 + 6.22 = 257.50
    // pension 5% × (4189 − 520) = 183.45
    expect(estimateNetPay(4500)).toMatchObject({ tax: 752.67, ni: 257.5, pension: 183.45, net: 3306.38 });
  });

  it("£10,000: personal allowance tapered above £100k", () => {
    // allowance 12,570 − 10,000 = 2,570; taxable 117,430
    // (7,540 + 79,730 × 40%) / 12 = 3,286.00
    expect(estimateNetPay(10000).tax).toBe(3286);
  });

  it("pension % is optional and can be zero", () => {
    expect(estimateNetPay(2000, { pensionPct: 0 })).toMatchObject({ pension: 0, net: 1733.34 });
    expect(estimateNetPay(2000, { pensionPct: 3 }).pension).toBe(44.4);
  });

  it("negative or non-finite gross is treated as zero", () => {
    expect(estimateNetPay(-50).net).toBe(0);
    expect(estimateNetPay(Number.NaN).net).toBe(0);
  });
});
