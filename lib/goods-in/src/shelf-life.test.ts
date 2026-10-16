import { describe, expect, it } from "vitest";
import {
  checkShelfLife, normaliseMinShelfLife, shelfLifeDaysOnDelivery,
  shelfLifeWarningText, shortDayLabel, longDayLabel, londonDeliveryDay,
  shelfLifeReportFor,
} from "./shelf-life";

describe("shelfLifeDaysOnDelivery", () => {
  it("counts whole calendar days from delivery to use-by", () => {
    expect(shelfLifeDaysOnDelivery("2026-10-16", "2026-10-17")).toBe(1);
    expect(shelfLifeDaysOnDelivery("2026-10-16", "2026-10-19")).toBe(3);
    expect(shelfLifeDaysOnDelivery("2026-10-16", "2026-10-16")).toBe(0);
    expect(shelfLifeDaysOnDelivery("2026-10-16", "2026-10-15")).toBe(-1);
  });

  it("is not thrown by the clocks going back (25 Oct 2026)", () => {
    expect(shelfLifeDaysOnDelivery("2026-10-24", "2026-10-27")).toBe(3);
    expect(shelfLifeDaysOnDelivery("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("reads timestamps by their date part, and refuses junk", () => {
    expect(shelfLifeDaysOnDelivery("2026-10-16T09:00:00Z", "2026-10-18")).toBe(2);
    expect(shelfLifeDaysOnDelivery("2026-10-16", "")).toBeNull();
    expect(shelfLifeDaysOnDelivery("nope", "2026-10-18")).toBeNull();
  });
});

describe("londonDeliveryDay", () => {
  it("uses the London day, not UTC", () => {
    // 23:30 UTC on 16 Oct is 00:30 on 17 Oct in London (BST).
    expect(londonDeliveryDay(new Date("2026-10-16T23:30:00Z"))).toBe("2026-10-17");
    expect(londonDeliveryDay(new Date("2026-10-16T06:00:00Z"))).toBe("2026-10-16");
    // Winter (GMT): 23:30 UTC is still the same day.
    expect(londonDeliveryDay(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });
});

describe("normaliseMinShelfLife", () => {
  it("treats empty, zero and negative as no minimum", () => {
    expect(normaliseMinShelfLife(null)).toBeNull();
    expect(normaliseMinShelfLife(undefined)).toBeNull();
    expect(normaliseMinShelfLife("")).toBeNull();
    expect(normaliseMinShelfLife(0)).toBeNull();
    expect(normaliseMinShelfLife(-2)).toBeNull();
    expect(normaliseMinShelfLife("3")).toBe(3);
    expect(normaliseMinShelfLife(3)).toBe(3);
  });
});

describe("checkShelfLife — Graeme's example: received Fri 16 Oct, minimum 3", () => {
  const base = { deliveryDate: "2026-10-16", minDays: 3 };

  it("17 Oct is short by 2", () => {
    const c = checkShelfLife({ ...base, useByDate: "2026-10-17" })!;
    expect(c.short).toBe(true);
    expect(c.days).toBe(1);
    expect(c.daysShort).toBe(2);
    expect(c.earliestOkUseBy).toBe("2026-10-19");
  });

  it("18 Oct is short", () => {
    expect(checkShelfLife({ ...base, useByDate: "2026-10-18" })!.short).toBe(true);
  });

  it("19 Oct is fine, and later is fine", () => {
    expect(checkShelfLife({ ...base, useByDate: "2026-10-19" })!.short).toBe(false);
    expect(checkShelfLife({ ...base, useByDate: "2026-10-25" })!.short).toBe(false);
    expect(checkShelfLife({ ...base, useByDate: "2026-10-19" })!.daysShort).toBe(0);
  });

  it("nothing to check without a minimum or a use-by", () => {
    expect(checkShelfLife({ deliveryDate: "2026-10-16", useByDate: "2026-10-17", minDays: null })).toBeNull();
    expect(checkShelfLife({ ...base, useByDate: "" })).toBeNull();
    expect(checkShelfLife({ ...base, useByDate: null })).toBeNull();
  });

  it("crosses a month end", () => {
    const c = checkShelfLife({ deliveryDate: "2026-10-30", useByDate: "2026-11-01", minDays: 3 })!;
    expect(c.days).toBe(2);
    expect(c.short).toBe(true);
    expect(c.earliestOkUseBy).toBe("2026-11-02");
  });
});

describe("day labels", () => {
  it("formats like the rest of goods-in", () => {
    expect(shortDayLabel("2026-10-19")).toBe("Mon 19 Oct");
    expect(longDayLabel("2026-10-16")).toBe("Fri 16 Oct 2026");
  });
});

describe("shelfLifeWarningText", () => {
  it("reads as Graeme wrote it", () => {
    const c = checkShelfLife({ deliveryDate: "2026-10-16", useByDate: "2026-10-17", minDays: 3 })!;
    expect(shelfLifeWarningText(c, "Brakes")).toBe(
      "Only 1 day's shelf life — Brakes promise at least 3 days (use-by should be Mon 19 Oct or later)",
    );
  });

  it("plural, same-day and past use-bys", () => {
    const two = checkShelfLife({ deliveryDate: "2026-10-16", useByDate: "2026-10-18", minDays: 3 })!;
    expect(shelfLifeWarningText(two, "Brakes")).toMatch(/^Only 2 days' shelf life/);
    const today = checkShelfLife({ deliveryDate: "2026-10-16", useByDate: "2026-10-16", minDays: 3 })!;
    expect(shelfLifeWarningText(today, "Brakes")).toMatch(/^Goes out of date today/);
    const past = checkShelfLife({ deliveryDate: "2026-10-16", useByDate: "2026-10-15", minDays: 1 })!;
    expect(shelfLifeWarningText(past, null)).toMatch(/^Already out of date — The supplier promise at least 1 day/);
  });
});

describe("shelfLifeReportFor — decided from what was saved", () => {
  const base = { deliveryDate: "2026-10-16", minDays: 3 };

  it("a received short-dated line is accepted", () => {
    const r = shelfLifeReportFor({ ...base, quantityReceived: 20, useByDate: "2026-10-17" })!;
    expect(r.decision).toBe("accepted");
    expect(r.check.days).toBe(1);
    expect(r.useByDate).toBe("2026-10-17");
  });

  it("a received line with enough shelf life reports nothing", () => {
    expect(shelfLifeReportFor({ ...base, quantityReceived: 20, useByDate: "2026-10-19" })).toBeNull();
  });

  it("received counts as accepted even if the screen also said rejected", () => {
    const r = shelfLifeReportFor({ ...base, quantityReceived: 5, useByDate: "2026-10-17", rejected: { useByDate: "2026-10-17" } })!;
    expect(r.decision).toBe("accepted");
  });

  it("a rejected line (received 0) with a short use-by is rejected", () => {
    const r = shelfLifeReportFor({ ...base, quantityReceived: 0, useByDate: null, rejected: { useByDate: "2026-10-18" } })!;
    expect(r.decision).toBe("rejected");
    expect(r.useByDate).toBe("2026-10-18");
  });

  it("a plain not-received line, or a 'rejection' that wasn't short, reports nothing", () => {
    expect(shelfLifeReportFor({ ...base, quantityReceived: 0 })).toBeNull();
    expect(shelfLifeReportFor({ ...base, quantityReceived: 0, rejected: { useByDate: "2026-10-20" } })).toBeNull();
  });

  it("no minimum, no report", () => {
    expect(shelfLifeReportFor({ deliveryDate: "2026-10-16", minDays: null, quantityReceived: 20, useByDate: "2026-10-17" })).toBeNull();
  });
});
