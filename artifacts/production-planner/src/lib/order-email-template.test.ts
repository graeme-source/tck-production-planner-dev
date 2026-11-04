import { describe, expect, it } from "vitest";
import { DEFAULT_ORDER_EMAIL_TEMPLATE, fillOrderEmailBody, fillOrderEmailText, parseOrderEmailTemplate } from "./order-email-template";
import { buildOrderMessage, orderEmailSubject, type OrderLineForText } from "./order-line-text";

const line = (over: Partial<OrderLineForText> = {}): OrderLineForText => ({
  ingredientName: "Plain Flour", supplierPartNumber: "F123", unit: "kg", packWeight: 16, costPerPack: 12.5, editedPacks: 2, ...over,
});

describe("the default wording", () => {
  it("is exactly what the Orders page has always sent", () => {
    expect(buildOrderMessage("Brakes", [line()], "Tue 10 Nov")).toBe([
      "Hi Brakes,", "", "Please could we order the following for delivery on Tue 10 Nov:", "",
      "- 32 kg × Plain Flour [F123]", "", "Many thanks,", "The Calzone Kitchen",
    ].join("\n"));
    expect(orderEmailSubject("Brakes", "Tue 10 Nov")).toBe("Order from The Calzone Kitchen — delivery Tue 10 Nov");
  });
});

describe("an edited template", () => {
  const template = { ...DEFAULT_ORDER_EMAIL_TEMPLATE, body: "Hello {contact},\nAccount: {accountNumber}\nFor {deliveryDate}\n{items}\nThanks" };

  it("fills in the contact and account number", () => {
    expect(buildOrderMessage("Brakes", [line()], "Tue", { template, contactName: "James", accountNumber: "A1" }))
      .toBe("Hello James,\nAccount: A1\nFor Tue\n- 32 kg × Plain Flour [F123]\nThanks");
  });

  it("leaves out a line with nothing to put in it, and greets the supplier if there's no contact", () => {
    expect(buildOrderMessage("Brakes", [line()], "Tue", { template })).toBe("Hello Brakes,\nFor Tue\n- 32 kg × Plain Flour [F123]\nThanks");
  });

  it("adds or removes detail on each item", () => {
    const t = { ...template, body: "{items}", showPartNumber: false, showPackSize: true, showPrice: true };
    expect(buildOrderMessage("Brakes", [line()], "Tue", { template: t })).toBe("- 32 kg × Plain Flour (16 kg) at £12.50 per pack");
  });

  it("never loses the items, even if they're taken out of the wording", () => {
    expect(fillOrderEmailBody({ ...template, body: "Thanks" }, { items: "- 1 x Salt" })).toBe("Thanks\n\n- 1 x Salt");
  });

  it("leaves words in curly brackets it doesn't know", () => {
    expect(fillOrderEmailText("See {notes}", {})).toBe("See {notes}");
  });
});

describe("reading the saved template", () => {
  it("falls back to the default for nothing, nonsense or blanks", () => {
    expect(parseOrderEmailTemplate(null)).toEqual(DEFAULT_ORDER_EMAIL_TEMPLATE);
    expect(parseOrderEmailTemplate("not json")).toEqual(DEFAULT_ORDER_EMAIL_TEMPLATE);
    expect(parseOrderEmailTemplate(JSON.stringify({ subject: " ", body: "" }))).toEqual(DEFAULT_ORDER_EMAIL_TEMPLATE);
  });
  it("keeps what was saved", () => {
    expect(parseOrderEmailTemplate(JSON.stringify({ subject: "Order", showPrice: true }))).toMatchObject({ subject: "Order", showPrice: true, showPartNumber: true });
  });
});
