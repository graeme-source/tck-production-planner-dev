import { describe, expect, it } from "vitest";
import { invoiceIdFromRef, whyKeepLine, type LineHistory } from "./upload-undo-plan";

const line = (over: Partial<LineHistory> = {}): LineHistory => ({ noVatReason: null, statusNote: null, actions: [], documentSources: [], ...over });

describe("whyKeepLine", () => {
  it("lets go of what only the system touched", () => {
    expect(whyKeepLine(line())).toBeNull();
    expect(whyKeepLine(line({ actions: ["found_posted_in_quickbooks", "invoice_matched_automatically", "auto_done", "invoice_taken_off"], documentSources: ["auto_match"] }))).toBeNull();
  });
  it("keeps anything a person did", () => {
    expect(whyKeepLine(line({ noVatReason: "dla" }))).toMatch(/no VAT/);
    expect(whyKeepLine(line({ documentSources: ["manual_upload"] }))).toMatch(/document/);
    expect(whyKeepLine(line({ documentSources: ["auto_match", "imap_attachment"] }))).toMatch(/document/);
    expect(whyKeepLine(line({ statusNote: "Waiting on Kate" }))).toMatch(/note/);
    expect(whyKeepLine(line({ actions: ["chased"] }))).toMatch(/chased/);
    expect(whyKeepLine(line({ actions: ["ticked_posted"] }))).toMatch(/worked/);
  });
  it("doesn't count a blank note", () => {
    expect(whyKeepLine(line({ statusNote: "  " }))).toBeNull();
  });
});

describe("invoiceIdFromRef", () => {
  it("reads the invoice behind a document", () => {
    expect(invoiceIdFromRef("invoice:42")).toBe(42);
    expect(invoiceIdFromRef("INBOX:12345")).toBeNull();
    expect(invoiceIdFromRef(null)).toBeNull();
  });
});
