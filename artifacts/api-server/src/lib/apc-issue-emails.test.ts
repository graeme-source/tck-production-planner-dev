import { describe, it, expect } from "vitest";
import { cantDeliverEmail, permanentSaturdayEmailText, rescheduleEmailFor } from "./apc-issue-emails";
import { rescheduleEmailText, nextAvailableDeliveryDate, deliveryDateChoices, isSaturdayDate } from "./order-reschedule";

const who = { customerFirstName: "Jane", senderFirstName: "Grant" };

describe("cantDeliverEmail (scenario a)", () => {
  const e = cantDeliverEmail({ ...who, orderName: "#1234" });
  it("says we can't service the postcode and will refund in full", () => {
    expect(e.body).toContain("we're not able to service your postcode");
    expect(e.body).toContain("We'll refund your order in full");
    expect(e.subject).toContain("#1234");
  });
  it("never promises a new date", () => {
    expect(e.body).not.toMatch(/next available delivery date|reschedul/i);
  });
  it("HTML carries the same words, escaped", () => {
    const x = cantDeliverEmail({ customerFirstName: "<b>", senderFirstName: "G", orderName: "#1" });
    expect(x.html).toContain("&lt;b&gt;");
    expect(x.html).toContain("refund your order in full");
  });
});

describe("permanent-Saturday email (scenario b)", () => {
  const body = permanentSaturdayEmailText({ ...who, newTagDate: "2026-10-13" });
  it("says no Saturdays at all, asks them not to choose Saturday, mentions subscriptions, gives the new date", () => {
    expect(body).toContain("can't deliver to you on a Saturday at all");
    expect(body).toContain("Please don't use Saturday as a delivery date going forwards");
    expect(body).toContain("If you have a subscription, please update your delivery date to a weekday");
    expect(body).toContain("Tuesday 13 October");
  });
});

describe("rescheduleEmailFor", () => {
  it("temporary keeps Graeme's original wording exactly (scenario c)", () => {
    const e = rescheduleEmailFor("temporary_saturday", { ...who, newTagDate: "2026-10-13", orderName: "#1" });
    expect(e.body).toBe(rescheduleEmailText({ ...who, newTagDate: "2026-10-13" }));
    expect(e.subject).toBe("Your Calzone Kitchen order #1 — new delivery date");
  });
  it("permanent uses the no-Saturdays wording", () => {
    const e = rescheduleEmailFor("permanent_saturday", { ...who, newTagDate: "2026-10-13", orderName: "#1" });
    expect(e.body).toContain("on a Saturday at all");
  });
});

describe("weekday-only rescheduling", () => {
  it("a failed Saturday still rolls to Tuesday", () => {
    expect(nextAvailableDeliveryDate("2026-10-10", { weekdaysOnly: true })).toBe("2026-10-13");
  });
  it("from a Friday, weekdays-only skips Saturday to Tuesday; otherwise Saturday is next", () => {
    expect(nextAvailableDeliveryDate("2026-10-09")).toBe("2026-10-10");
    expect(nextAvailableDeliveryDate("2026-10-09", { weekdaysOnly: true })).toBe("2026-10-13");
  });
  it("the quick-pick dates never include a Saturday when weekdays only", () => {
    const d = deliveryDateChoices("2026-10-10", 6, true);
    expect(d).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-20", "2026-10-21"]);
    expect(d.some(isSaturdayDate)).toBe(false);
    expect(deliveryDateChoices("2026-10-10", 5)).toContain("2026-10-17");
  });
});

describe("rescheduledWithLinkEmail (11 Nov 2026)", () => {
  const base = { customerFirstName: "Matt", senderFirstName: "Graeme", orderName: "#139320", saturdayDelivery: "2026-11-14", newDelivery: "2026-11-18" };
  it("says it HAS moved, and gives the link as a button", async () => {
    const { rescheduledWithLinkEmail } = await import("./apc-issue-emails");
    const e = rescheduledWithLinkEmail({ ...base, link: "https://thecalzonekitchen.co.uk/pages/contact-us?chat=open&tckl=abc" });
    expect(e.body).toMatch(/we've moved your order #139320 to Wednesday 18 November/);
    expect(e.body).toMatch(/you don't need to do anything/);
    expect(e.html).toMatch(/<a href="https:\/\/thecalzonekitchen\.co\.uk\/pages\/contact-us\?chat=open&amp;tckl=abc"[^>]*>Choose a delivery day<\/a>/);
    expect(e.subject).toMatch(/moved to Wednesday 18 November/);
  });
  it("without a link, asks them to reply", async () => {
    const { rescheduledWithLinkEmail } = await import("./apc-issue-emails");
    const e = rescheduledWithLinkEmail({ ...base, link: null });
    expect(e.body).toMatch(/reply to this email/);
    expect(e.html).not.toMatch(/<a /);
  });
});
