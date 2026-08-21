import { describe, it, expect } from "vitest";
import {
  nextAvailableDeliveryDate, dayNameFor, toZapietDate, rescheduleTags,
  withDeliveryDate, friendlyDate, rescheduleEmailText, firstNameOf,
} from "./order-reschedule";

describe("nextAvailableDeliveryDate", () => {
  it("rolls a failed Saturday to the Tuesday — the case this was built for", () => {
    // Sat 2026-08-22 → skip Sun 23, Mon 24 → Tue 2026-08-25.
    expect(nextAvailableDeliveryDate("2026-08-22")).toBe("2026-08-25");
  });

  it("moves a mid-week failure to the next day", () => {
    expect(nextAvailableDeliveryDate("2026-08-19")).toBe("2026-08-20"); // Wed → Thu
    expect(nextAvailableDeliveryDate("2026-08-20")).toBe("2026-08-21"); // Thu → Fri
    expect(nextAvailableDeliveryDate("2026-08-21")).toBe("2026-08-22"); // Fri → Sat
  });

  it("never lands on a Sunday or Monday", () => {
    for (const start of ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"]) {
      expect(["Sunday", "Monday"]).not.toContain(dayNameFor(nextAvailableDeliveryDate(start)));
    }
  });

  it("crosses a month boundary", () => {
    expect(nextAvailableDeliveryDate("2026-08-29")).toBe("2026-09-01"); // Sat → Tue
  });

  it("crosses a year boundary", () => {
    expect(nextAvailableDeliveryDate("2026-12-31")).toBe("2027-01-01"); // Thu → Fri
  });
});

describe("date formats", () => {
  it("uses slashes for Zapiet and dashes for tags", () => {
    expect(toZapietDate("2026-08-25")).toBe("2026/08/25");
  });

  it("names the weekday correctly across a BST boundary", () => {
    expect(dayNameFor("2026-08-22")).toBe("Saturday");
    expect(dayNameFor("2026-08-25")).toBe("Tuesday");
    expect(dayNameFor("2026-10-25")).toBe("Sunday");  // clocks change
    expect(dayNameFor("2026-03-29")).toBe("Sunday");  // clocks change
  });

  it("writes a friendly date for the customer", () => {
    expect(friendlyDate("2026-08-25")).toBe("Tuesday 25 August");
  });
});

describe("rescheduleTags", () => {
  const TAGS = "2026-08-22, dispatch, new-customer, Saturday, scotland, Small Box";

  it("swaps the date tag and the weekday tag, leaving unrelated tags alone", () => {
    const r = rescheduleTags(TAGS, "2026-08-22", "2026-08-25");
    expect(r.removed).toEqual(expect.arrayContaining(["2026-08-22", "Saturday"]));
    expect(r.added).toEqual(expect.arrayContaining(["2026-08-25", "Tuesday"]));
    const after = r.after.split(", ");
    expect(after).toContain("2026-08-25");
    expect(after).toContain("Tuesday");
    expect(after).not.toContain("2026-08-22");
    expect(after).not.toContain("Saturday");
    // Untouched:
    expect(after).toContain("new-customer");
    expect(after).toContain("scotland");
    expect(after).toContain("Small Box");
  });

  it("ADDS the delayed tag so the order is findable later", () => {
    const r = rescheduleTags(TAGS, "2026-08-22", "2026-08-25");
    expect(r.added).toContain("delayed");
    expect(r.after.split(", ")).toContain("delayed");
  });

  it("does not add delayed twice if it is already there", () => {
    const once = rescheduleTags(TAGS, "2026-08-22", "2026-08-25").after;
    const twice = rescheduleTags(once, "2026-08-25", "2026-08-26");
    expect(twice.after.split(", ").filter(t => t === "delayed")).toHaveLength(1);
  });

  it("REMOVES the apc-no-service mark — it moves to a day APC does serve", () => {
    const r = rescheduleTags("2026-08-22, dispatch, Saturday, apc-no-service", "2026-08-22", "2026-08-25");
    expect(r.after.split(", ")).not.toContain("apc-no-service");
    expect(r.removed).toContain("apc-no-service");
  });

  it("REMOVES the dispatch tag — the order goes back to the backlog", () => {
    // Re-tagged on the Monday by the normal morning process; leaving it on
    // would drop the order into a dispatch wave it is no longer part of.
    const r = rescheduleTags(TAGS, "2026-08-22", "2026-08-25");
    expect(r.after.split(", ")).not.toContain("dispatch");
    expect(r.removed).toContain("dispatch");
  });

  it("removes the dispatch tag whatever its case", () => {
    const r = rescheduleTags("2026-08-22, Dispatch, Small Box", "2026-08-22", "2026-08-25");
    expect(r.after.toLowerCase()).not.toContain("dispatch");
  });

  it("does not invent a weekday tag when the order never had one", () => {
    const r = rescheduleTags("2026-08-22, dispatch, Small Box", "2026-08-22", "2026-08-25");
    expect(r.after.split(", ")).not.toContain("Tuesday");
    // The new date and the delayed mark — but no weekday tag conjured up.
    expect(r.added).toEqual(["2026-08-25", "delayed"]);
  });

  it("is idempotent — running it twice does not duplicate tags", () => {
    const once = rescheduleTags(TAGS, "2026-08-22", "2026-08-25").after;
    const twice = rescheduleTags(once, "2026-08-22", "2026-08-25").after;
    expect(twice).toBe(once);
  });

  it("matches the weekday tag case-insensitively", () => {
    const r = rescheduleTags("2026-08-22, saturday, dispatch", "2026-08-22", "2026-08-25");
    expect(r.after.split(", ")).not.toContain("saturday");
    expect(r.after.split(", ")).toContain("Tuesday");
  });

  it("leaves the weekday tag alone when the weekday does not change", () => {
    // Sat 22 Aug → Sat 29 Aug: same day name, so nothing to swap.
    const r = rescheduleTags(TAGS, "2026-08-22", "2026-08-29");
    expect(r.after.split(", ")).toContain("Saturday");
    expect(r.removed).toEqual(expect.arrayContaining(["2026-08-22", "dispatch"]));
  });
});

describe("withDeliveryDate", () => {
  const ATTRS = [
    { name: "vslyCT", value: "vslyCT_abc?key=123" },
    { name: "vslySUBS", value: "0" },
    { name: "Delivery-Location-Id", value: "270812" },
    { name: "Delivery-Date", value: "2026/08/22" },
    { name: "Checkout-Method", value: "delivery" },
  ];

  it("changes only Delivery-Date", () => {
    const r = withDeliveryDate(ATTRS, "2026-08-25");
    expect(r.previous).toBe("2026/08/22");
    expect(r.changed).toBe(true);
    expect(r.attributes.find(a => a.name === "Delivery-Date")!.value).toBe("2026/08/25");
  });

  it("PRESERVES every other attribute — Shopify replaces the array wholesale", () => {
    const r = withDeliveryDate(ATTRS, "2026-08-25");
    expect(r.attributes).toHaveLength(ATTRS.length);
    for (const name of ["vslyCT", "vslySUBS", "Delivery-Location-Id", "Checkout-Method"]) {
      const before = ATTRS.find(a => a.name === name)!;
      expect(r.attributes.find(a => a.name === name)).toEqual(before);
    }
  });

  it("keeps attribute order stable", () => {
    expect(withDeliveryDate(ATTRS, "2026-08-25").attributes.map(a => a.name))
      .toEqual(ATTRS.map(a => a.name));
  });

  it("adds Delivery-Date when the order has none", () => {
    const r = withDeliveryDate([{ name: "Checkout-Method", value: "delivery" }], "2026-08-25");
    expect(r.previous).toBeNull();
    expect(r.changed).toBe(true);
    expect(r.attributes).toHaveLength(2);
  });

  it("handles a null attribute list", () => {
    expect(withDeliveryDate(null, "2026-08-25").attributes)
      .toEqual([{ name: "Delivery-Date", value: "2026/08/25" }]);
  });

  it("reports no change when the date already matches", () => {
    expect(withDeliveryDate(ATTRS, "2026-08-22").changed).toBe(false);
  });
});

describe("rescheduleEmailText", () => {
  const email = rescheduleEmailText({
    customerFirstName: "Dillon", senderFirstName: "Kyra", newTagDate: "2026-08-25",
  });

  it("greets the customer and signs off as the sender", () => {
    expect(email.startsWith("Hi Dillon")).toBe(true);
    expect(email.trimEnd().endsWith("Kyra")).toBe(true);
  });

  it("states the new delivery date in words", () => {
    expect(email).toContain("next available delivery date which is Tuesday 25 August");
  });

  it("leaves no placeholder unsubstituted", () => {
    expect(email).not.toMatch(/\(.*Name.*\)/i);
  });
});

describe("firstNameOf", () => {
  it("takes the first name only", () => {
    expect(firstNameOf("Kyra-Lucy Carroll", "TCK")).toBe("Kyra-Lucy");
    expect(firstNameOf("Graeme Carter", "TCK")).toBe("Graeme");
  });
  it("falls back when there is no name", () => {
    expect(firstNameOf(null, "TCK")).toBe("TCK");
    expect(firstNameOf("   ", "TCK")).toBe("TCK");
  });
});
