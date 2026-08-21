import { describe, it, expect } from "vitest";
import { declaredParcelWeightKg, LIGHT_SERVICE_MAX_KG, HEAVY_SERVICE_MAX_KG } from "./parcel-weight";

// Codes as configured on live (app_settings), 2026-08-21.
const LIGHT = ["LW16", "WL16"] as const;   // small: weekday, weekend
const HEAVY = ["ND16", "WD16"] as const;   // large: weekday, weekend
const HEAVY_WEEKEND = "WD16";

describe("declaredParcelWeightKg", () => {
  it("caps a light service at 5kg", () => {
    expect(declaredParcelWeightKg(6000, "WL16", LIGHT)).toBe(5);
    expect(declaredParcelWeightKg(8000, "WL16", LIGHT)).toBe(5);
    expect(declaredParcelWeightKg(6000, "LW16", LIGHT)).toBe(5);
  });

  it("leaves anything at or under the ceiling alone", () => {
    expect(declaredParcelWeightKg(5000, "WL16", LIGHT)).toBe(5);
    expect(declaredParcelWeightKg(4200, "WL16", LIGHT)).toBe(4.2);
    expect(declaredParcelWeightKg(2000, "WL16", LIGHT)).toBe(2);
  });

  it("caps the heavy services at 10kg", () => {
    expect(declaredParcelWeightKg(12000, HEAVY_WEEKEND, LIGHT, HEAVY)).toBe(10);
    expect(declaredParcelWeightKg(15000, "ND16", LIGHT, HEAVY)).toBe(10);
  });

  it("leaves heavy parcels at or under 10kg untouched", () => {
    // Every large box seen to date — the cap must be a no-op for these.
    expect(declaredParcelWeightKg(7200, HEAVY_WEEKEND, LIGHT, HEAVY)).toBe(7.2);
    expect(declaredParcelWeightKg(8400, HEAVY_WEEKEND, LIGHT, HEAVY)).toBe(8.4);
    expect(declaredParcelWeightKg(10000, HEAVY_WEEKEND, LIGHT, HEAVY)).toBe(10);
  });

  it("keeps the two ceilings independent", () => {
    // Same parcel, different service: 6kg is over the light limit but well
    // under the heavy one.
    expect(declaredParcelWeightKg(6000, "WL16", LIGHT, HEAVY)).toBe(5);
    expect(declaredParcelWeightKg(6000, "WD16", LIGHT, HEAVY)).toBe(6);
  });

  it("floors at 0.1kg — APC rejects a zero-weight parcel", () => {
    expect(declaredParcelWeightKg(0, "WL16", LIGHT, HEAVY)).toBe(0.1);
    expect(declaredParcelWeightKg(null, "WL16", LIGHT, HEAVY)).toBe(0.5); // 500g default
    expect(declaredParcelWeightKg(undefined, HEAVY_WEEKEND, LIGHT, HEAVY)).toBe(0.5);
  });

  it("follows the configured codes, not hard-coded names", () => {
    // If someone swaps a code in settings, the cap must move with it.
    expect(declaredParcelWeightKg(9000, "XX99", ["XX99"], HEAVY)).toBe(LIGHT_SERVICE_MAX_KG);
    expect(declaredParcelWeightKg(9000, "WL16", ["XX99"], HEAVY)).toBe(9);
    expect(declaredParcelWeightKg(12000, "YY88", LIGHT, ["YY88"])).toBe(HEAVY_SERVICE_MAX_KG);
  });

  it("ignores empty codes so an unset setting can't swallow everything", () => {
    // getAppSetting returns "" for a missing key; "" must not match a real
    // service code and silently cap every parcel.
    expect(declaredParcelWeightKg(9000, "", ["", "WL16"], HEAVY)).toBe(9);
    expect(declaredParcelWeightKg(12000, "", LIGHT, ["", "WD16"])).toBe(12);
  });

  it("sends an unrecognised service code through uncapped", () => {
    expect(declaredParcelWeightKg(12000, "ZZ00", LIGHT, HEAVY)).toBe(12);
  });

  // The regression this file exists for: the 2026-08-22 batch, where 13 of 44
  // orders were rejected as "NO Services available" purely on declared weight.
  it("would have let the 2026-08-22 failures through", () => {
    const failedNominals = [6000, 6000, 6000, 5200, 6000, 6000, 6000, 6000, 5400, 6000, 6000, 8000, 6000];
    for (const g of failedNominals) {
      expect(declaredParcelWeightKg(g, "WL16", LIGHT, HEAVY)).toBeLessThanOrEqual(LIGHT_SERVICE_MAX_KG);
    }
  });
});
