import { describe, expect, it } from "vitest";
import {
  checkShelfLife, normaliseMinShelfLife, shelfLifeDaysOnDelivery, shelfLifeReportEmail,
  shelfLifeWarningText, shortDayLabel, longDayLabel, londonDeliveryDay,
  shelfLifeReportFor, shelfLifeToldText,
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

describe("shelfLifeReportEmail", () => {
  const input = {
    supplierName: "Brakes",
    recipientName: "Pat Example",
    orderNumber: 1234,
    deliveryDate: "2026-10-16",
    productName: "Diced Chicken Breast",
    quantityText: "20 kg",
    useByDate: "2026-10-17",
    days: 1,
    minDays: 3,
    decision: "accepted" as const,
    receivedByName: "Sam",
  };

  it("carries every fact the supplier needs", () => {
    const e = shelfLifeReportEmail(input);
    expect(e.subject).toBe("Short shelf life on delivery — Diced Chicken Breast — Fri 16 Oct (our order #1234)");
    for (const s of [
      "Dear Pat,", "Supplier: Brakes", "Our order number: #1234", "Delivery date: Fri 16 Oct 2026",
      "Product: Diced Chicken Breast", "Quantity: 20 kg", "Use-by date received: Sat 17 Oct 2026",
      "Shelf life on arrival: 1 day", "Minimum shelf life agreed: 3 days", "What we did: Accepted (to be used or frozen)",
      "Checked in by: Sam", "The Calzone Kitchen",
    ]) {
      expect(e.text).toContain(s);
    }
    expect(e.html).toContain("Diced Chicken Breast");
    expect(e.html).toContain("The Calzone Kitchen");
  });

  it("says when we rejected it", () => {
    const e = shelfLifeReportEmail({ ...input, decision: "rejected" });
    expect(e.text).toContain("What we did: Rejected");
    expect(e.text).toContain("We rejected it, so it has not been received into our stock.");
    expect(e.text).not.toContain("freeze");
  });

  it("greets politely without a name, and never leaks HTML", () => {
    const e = shelfLifeReportEmail({ ...input, recipientName: null, productName: "Fish & <Chips>" });
    expect(e.text.startsWith("Hello,")).toBe(true);
    expect(e.html).toContain("Fish &amp; &lt;Chips&gt;");
    expect(e.html).not.toContain("<Chips>");
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

describe("shelfLifeToldText", () => {
  const o = {
    lineId: 1, ingredientName: "Diced Chicken", supplierName: "Brakes", decision: "accepted" as const,
    emailStatus: "sent" as const, recipientName: "Pat Example", alreadyReported: false,
  };

  it("names who was emailed — never the address", () => {
    expect(shelfLifeToldText(o)).toEqual({ ok: true, text: "Emailed Pat Example at Brakes automatically about the Diced Chicken." });
    expect(shelfLifeToldText({ ...o, recipientName: null }).text).toBe("Emailed Brakes automatically about the Diced Chicken.");
  });

  it("says plainly when nobody was told", () => {
    expect(shelfLifeToldText({ ...o, emailStatus: "no_address" }).ok).toBe(false);
    expect(shelfLifeToldText({ ...o, emailStatus: "failed" }).text).toMatch(/^Couldn't email Pat Example at Brakes/);
    expect(shelfLifeToldText({ ...o, emailStatus: "skipped" }).ok).toBe(false);
  });

  it("an earlier save already told them", () => {
    expect(shelfLifeToldText({ ...o, alreadyReported: true }).text).toBe("Brakes were already told about the Diced Chicken.");
  });
});
