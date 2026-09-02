import { describe, it, expect } from "vitest";
import { productionDateFromJulianBatch, addCalendarDays, batchDispatchVerdict } from "./julian-batch";

describe("productionDateFromJulianBatch", () => {
  it("decodes YYDDD", () => {
    expect(productionDateFromJulianBatch(26217)).toBe("2026-08-05");
    expect(productionDateFromJulianBatch(26244)).toBe("2026-09-01");
  });
  it("rejects the unknown-batch sentinel and nonsense", () => {
    expect(productionDateFromJulianBatch(0)).toBeNull();
    expect(productionDateFromJulianBatch(26999)).toBeNull();
    expect(productionDateFromJulianBatch(123456)).toBeNull();
  });
});

describe("batchDispatchVerdict", () => {
  // Graeme's worked example (2026-09-02): dispatching today the 2nd,
  // overnight delivery on the 3rd. A calzone (3 days at customer) needs a
  // use-by of the 6th or later; mac cheese (2 days) needs the 5th or later.
  const CALZONE_EARLIEST = "2026-09-06";
  const MAC_EARLIEST = "2026-09-05";

  it("passes a calzone batch whose use-by lands exactly on the limit", () => {
    // Made 1 Sep (26244), 5-day shelf life → use-by 6 Sep = the limit.
    expect(batchDispatchVerdict(26244, 5, CALZONE_EARLIEST)).toEqual({ useByDate: "2026-09-06", ok: true });
  });

  it("fails a calzone batch one day too old", () => {
    // Made 31 Aug (26243), 5-day shelf life → use-by 5 Sep < 6 Sep.
    expect(batchDispatchVerdict(26243, 5, CALZONE_EARLIEST)).toEqual({ useByDate: "2026-09-05", ok: false });
  });

  it("mac cheese gets one more day of leeway", () => {
    // Same made-31-Aug batch, 5-day shelf life: use-by 5 Sep ≥ 5 Sep — OK
    // for mac cheese even though the identical dates fail a calzone.
    expect(batchDispatchVerdict(26243, 5, MAC_EARLIEST)).toEqual({ useByDate: "2026-09-05", ok: true });
  });

  it("refuses to guess when it can't verify", () => {
    expect(batchDispatchVerdict(26244, null, CALZONE_EARLIEST)).toBeNull();
    expect(batchDispatchVerdict(26244, 0, CALZONE_EARLIEST)).toBeNull();
    expect(batchDispatchVerdict(26244, 5, null)).toBeNull();
    expect(batchDispatchVerdict(0, 5, CALZONE_EARLIEST)).toBeNull();
  });
});
