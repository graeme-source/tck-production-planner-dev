import { describe, expect, it } from "vitest";
import { goesToInbox } from "./inbox-rules";

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
