import { describe, it, expect } from "vitest";
import { buildWinnerEmail, fillPlaceholders, DEFAULT_TEMPLATES, type WinnerEmailValues } from "./emails";

const v: WinnerEmailValues = {
  firstName: "Sam", orderName: "#138100", gift: "Cinnamon Buns – 6 Pack",
  refundAmount: 54.95, code: null, amount: 75, orders: 6,
};

describe("winner emails", () => {
  it("fills every placeholder", () => {
    expect(fillPlaceholders("{first_name} {order_number} {gift} {refund_amount} {amount} {orders}", v))
      .toBe("Sam #138100 Cinnamon Buns – 6 Pack £54.95 75 6");
  });

  it("falls back gracefully and leaves typos visible", () => {
    expect(fillPlaceholders("Hi {first_name}, {giftt}", { ...v, firstName: null })).toBe("Hi there, {giftt}");
  });

  it("the refund email names the amount", () => {
    const e = buildWinnerEmail(DEFAULT_TEMPLATES.gift_refund, v, "Terms here");
    expect(e.subject).toContain("#138100");
    expect(e.text).toContain("£54.95");
    expect(e.text).toContain("Terms here");
    expect(e.html).toContain("Cinnamon Buns – 6 Pack");
  });

  it("shows the subscription code big and escapes HTML in the copy", () => {
    const e = buildWinnerEmail(DEFAULT_TEMPLATES.subscription, { ...v, orderName: "#138000", code: "LUCKYYEAR-138000-ABC123" }, "");
    expect(e.html).toContain("dashed");
    expect(e.html).toContain("LUCKYYEAR-138000-ABC123");
    const x = buildWinnerEmail({ subject: "Hi", body: "<b>bold</b>" }, v, "");
    expect(x.html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});
