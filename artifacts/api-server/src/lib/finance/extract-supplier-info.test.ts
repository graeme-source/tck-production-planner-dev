import { describe, it, expect } from "vitest";
import { extractSupplierInfo, extractOrderReference } from "./extract-supplier-info";

describe("extractOrderReference", () => {
  it("reads keyworded order numbers in their common shapes", () => {
    expect(extractOrderReference("Thanks! Order #A1234 is confirmed")).toBe("A1234");
    expect(extractOrderReference("Your order number: 556677 has shipped")).toBe("556677");
    expect(extractOrderReference("Confirmation no. 9-887 attached")).toBe("9-887");
    expect(extractOrderReference("", "Order confirmation #WEB-10442")).toBe("WEB-10442");
  });

  it("bare numbers are not order ids", () => {
    expect(extractOrderReference("Paid £45.60 on 12/09/2026, card 4581")).toBeNull();
  });

  it("pure-alpha 'references' are prose, not ids", () => {
    expect(extractOrderReference("re: order confirmation attached")).toBeNull();
  });

  it("two different candidates mean ambiguity — return nothing", () => {
    expect(extractOrderReference("Order #123 relates to invoice #999")).toBeNull();
  });

  it("the same id mentioned twice is still one candidate", () => {
    expect(extractOrderReference("Order #A1 confirmed. Ref: A1 for queries.")).toBe("A1");
  });
});

describe("extractSupplierInfo", () => {
  const aluxoEmail = {
    text: "Thank you for your order!\nOrder number: ALX-2214\nQuestions? Contact sales@aluxo.co.uk or visit our store.",
    fromAddress: "no-reply@orders.aluxo.co.uk",
    fromName: "Aluxo",
    subject: "Your Aluxo order confirmation",
  };

  it("the Aluxo case: order ref, human email, root-domain website, sender name", () => {
    expect(extractSupplierInfo(aluxoEmail)).toEqual({
      orderReference: "ALX-2214",
      supplierEmail: "sales@aluxo.co.uk",
      supplierWebsite: "https://aluxo.co.uk",
      supplierName: "Aluxo",
    });
  });

  it("falls back to the no-reply sender when the body has no address", () => {
    const r = extractSupplierInfo({ text: "Order #55 confirmed", fromAddress: "no-reply@shop.example.com", fromName: null });
    expect(r.supplierEmail).toBe("no-reply@shop.example.com");
    expect(r.supplierWebsite).toBe("https://example.com");
    expect(r.supplierName).toBe("Example");
  });

  it("never suggests contacting ourselves", () => {
    const r = extractSupplierInfo({ text: "Copy to accounts@thecalzonekitchen.co.uk", fromAddress: "accounts@thecalzonekitchen.co.uk" });
    expect(r.supplierEmail).toBeNull();
    expect(r.supplierWebsite).toBeNull();
  });

  it("free-mail domains never become the supplier website", () => {
    const r = extractSupplierInfo({ text: "", fromAddress: "bobstools@gmail.com", fromName: "Bob's Tools" });
    expect(r.supplierEmail).toBe("bobstools@gmail.com");
    expect(r.supplierWebsite).toBeNull();
    expect(r.supplierName).toBe("Bob's Tools");
  });

  it("empty in, nulls out", () => {
    expect(extractSupplierInfo({ text: "" })).toEqual({
      orderReference: null, supplierEmail: null, supplierWebsite: null, supplierName: null,
    });
  });
});
