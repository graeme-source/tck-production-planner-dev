import { describe, it, expect } from "vitest";
import { statusForDocuments } from "./line-documents";

describe("statusForDocuments — only a VAT invoice leaves Outstanding", () => {
  it("moves an outstanding transaction to the Inbox when a VAT invoice is attached", () => {
    expect(statusForDocuments("open", ["invoice"])).toBe("matched");
    expect(statusForDocuments("identified", ["order_confirmation", "invoice"])).toBe("matched");
  });
  it("keeps it in Outstanding with an order confirmation — the VAT invoice is still needed", () => {
    expect(statusForDocuments("open", ["order_confirmation"])).toBe("identified");
    expect(statusForDocuments("open", ["receipt"])).toBe("identified");
  });
  it("sends it back to Outstanding when its only 'invoice' is relabelled an order confirmation", () => {
    expect(statusForDocuments("matched", ["order_confirmation"])).toBe("identified");
    expect(statusForDocuments("matched", [])).toBe("open");
  });
  it("leaves alone what's already right, and never moves done or not-needed", () => {
    expect(statusForDocuments("matched", ["invoice"])).toBeNull();
    expect(statusForDocuments("identified", ["order_confirmation"])).toBeNull();
    expect(statusForDocuments("done", ["order_confirmation"])).toBeNull();
    expect(statusForDocuments("not_needed", [])).toBeNull();
  });
});
