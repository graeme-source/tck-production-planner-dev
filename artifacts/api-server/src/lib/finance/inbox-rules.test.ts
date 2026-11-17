import { describe, expect, it } from "vitest";
import { goesToInbox, matchedByFromEvents } from "./inbox-rules";

describe("Finance Inbox — which uploads wait to be posted", () => {
  it("a PDF or photo dropped on its own waits in the Inbox", () => {
    expect(goesToInbox("Puffin PSI111314.pdf", false)).toBe(true);
    expect(goesToInbox("IMG_2041.jpg", false)).toBe(true);
  });
  it("a zip's files are history: library only", () => {
    expect(goesToInbox("Invoices 2024.zip/Brakes/123.pdf", false)).toBe(false);
    expect(goesToInbox("old.ZIP/a.pdf", false)).toBe(false);
    expect(goesToInbox("whatever.pdf", true)).toBe(false);
  });
  it("a file merely named like a zip isn't one", () => {
    expect(goesToInbox("zip-ties invoice.pdf", false)).toBe(true);
  });
});


describe("Finance Inbox — how a transaction got its invoice", () => {
  it("keeps the latest matching event per transaction, with who and how", () => {
    const r = matchedByFromEvents([
      { entityId: 7, action: "document_added", userName: "Graeme Carter", createdAt: "2026-11-10T09:00:00Z" },
      { entityId: 7, action: "chased", userName: "Graeme Carter", createdAt: "2026-11-12T09:00:00Z" },
      { entityId: 7, action: "invoice_matched_automatically", userName: null, createdAt: "2026-11-11T09:00:00Z" },
      { entityId: 9, action: "marked_no_vat_dla", userName: "Graeme Carter", createdAt: "2026-11-15T10:00:00Z" },
    ]);
    expect(r[7]).toEqual({ name: null, at: "2026-11-11T09:00:00.000Z", how: "automatically" });
    expect(r[9]).toEqual({ name: "Graeme Carter", at: "2026-11-15T10:00:00.000Z", how: "no_vat" });
  });
  it("ignores transactions with no matching event", () => {
    expect(matchedByFromEvents([{ entityId: 3, action: "note_saved", userName: "Gillian", createdAt: "2026-11-15T10:00:00Z" }])).toEqual({});
  });
});
