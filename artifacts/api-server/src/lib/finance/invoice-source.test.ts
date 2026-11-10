import { describe, expect, it } from "vitest";
import { invoiceSourceText } from "./invoice-source";

const base = { source: "upload", uploaderName: "Gillian", via: null, uploadId: null, uploadFileName: null };

describe("invoiceSourceText", () => {
  it("names who dropped it on the Finance page, with the London time", () => {
    // Invoice 12017, live: uploaded 9 Nov 2026 13:18 UTC (GMT, so 13:18 in London).
    expect(invoiceSourceText({ ...base, via: "outstanding_find_transaction", createdAt: "2026-11-09T13:18:50Z" }))
      .toBe("Uploaded by Gillian on the Finance page · 9 Nov, 13:18");
  });

  it("says which zip a library upload came in", () => {
    expect(invoiceSourceText({ ...base, uploaderName: "Graeme Carter", uploadId: 2, uploadFileName: "TCK 2026 Supplier Invoices.zip", createdAt: "2026-11-03T12:04:46Z" }))
      .toBe("Uploaded by Graeme Carter to the Invoices library (TCK 2026 Supplier Invoices.zip) · 3 Nov, 12:04");
  });

  it("shows summer times in BST", () => {
    expect(invoiceSourceText({ ...base, uploadId: 5, uploadFileName: "one.pdf", createdAt: "2026-07-01T09:30:00Z" }))
      .toBe("Uploaded by Gillian to the Invoices library · 1 Jul, 10:30");
  });

  it("covers files that came from a transaction, and unknown uploaders", () => {
    expect(invoiceSourceText({ ...base, source: "transaction", uploaderName: null, createdAt: "2026-11-01T08:00:00Z" }))
      .toBe("Added by someone the app didn't record to a card transaction · 1 Nov, 08:00");
  });
});
