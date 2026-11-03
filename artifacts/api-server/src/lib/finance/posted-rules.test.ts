import { describe, it, expect } from "vitest";
import { postedLinkFields, describeImapLoginError, isReadyToClose, storedFileHeaders } from "./posted-rules";
import { SHEET_ROWS_2026_11, sheetNotesByDedupeHash, sheetRowDedupeHash, sheetRowNote } from "./backlog-reset-2026-11";

// Regression (Graeme, 2026-11-03): the QuickBooks sync closed 19 freshly
// loaded lines as done and overwrote their notes. Posted must never close.
describe("QuickBooks posted match", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  it("only links and ticks Posted — never touches status, note or done", () => {
    const fields = postedLinkFields({ postedDetectedAt: null }, 42, now);
    expect(fields).toEqual({ qboTxnId: 42, postedDetectedAt: now, updatedAt: now });
    expect(fields).not.toHaveProperty("status");
    expect(fields).not.toHaveProperty("statusNote");
    expect(fields).not.toHaveProperty("doneAt");
  });
  it("keeps the date of an earlier hand tick", () => {
    const earlier = new Date("2026-11-01T09:00:00Z");
    expect(postedLinkFields({ postedDetectedAt: earlier }, 42, now).postedDetectedAt).toBe(earlier);
  });
});

describe("restoring sheet notes on reopened lines", () => {
  it("maps every sheet line's dedupe hash back to its note", () => {
    const notes = sheetNotesByDedupeHash();
    expect(notes.size).toBe(SHEET_ROWS_2026_11.length);
    SHEET_ROWS_2026_11.forEach((row, i) => expect(notes.get(sheetRowDedupeHash(row, i))).toBe(sheetRowNote(row)));
  });
});

describe("describeImapLoginError", () => {
  it("names a refused password", () => {
    expect(describeImapLoginError({ message: "Command failed", authenticationFailed: true })).toBe("one.com refused the email address or password");
    expect(describeImapLoginError({ message: "Command failed", responseText: "[AUTHENTICATIONFAILED] Invalid credentials" })).toMatch(/refused/);
  });
  it("tells an unreachable server apart from a wrong password", () => {
    expect(describeImapLoginError({ code: "ETIMEDOUT" })).toMatch(/Couldn't reach one\.com/);
  });
  it("falls back to the server's own words", () => {
    expect(describeImapLoginError({ message: "Command failed", responseText: "Too many connections" })).toBe("Login failed: Too many connections");
  });
});

describe("isReadyToClose — done = posted + VAT invoice", () => {
  const posted = new Date("2026-11-03T10:00:00Z");
  it("closes a DLA purchase once it's posted, with no invoice", () => {
    expect(isReadyToClose({ status: "matched", postedDetectedAt: posted, noVatReason: "dla" }, false)).toBe(true);
    expect(isReadyToClose({ status: "matched", postedDetectedAt: null, noVatReason: "dla" }, false)).toBe(false);
    expect(isReadyToClose({ status: "done", postedDetectedAt: posted, noVatReason: "dla" }, false)).toBe(false);
  });
  it("closes only when both are true", () => {
    expect(isReadyToClose({ status: "matched", postedDetectedAt: posted }, true)).toBe(true);
    expect(isReadyToClose({ status: "open", postedDetectedAt: posted }, false)).toBe(false);
    expect(isReadyToClose({ status: "matched", postedDetectedAt: null }, true)).toBe(false);
  });
  it("leaves closed lines alone", () => {
    expect(isReadyToClose({ status: "done", postedDetectedAt: posted }, true)).toBe(false);
    expect(isReadyToClose({ status: "not_needed", postedDetectedAt: posted }, true)).toBe(false);
  });
});

// Regression (2026-11-03): a colleague's Chrome offered a download instead of
// showing the invoice, because every file was served with CSP sandbox.
describe("storedFileHeaders", () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  it("lets a genuine PDF show in any browser", () => {
    const h = storedFileHeaders("application/pdf", enc("%PDF-1.7 ..."), "inv.pdf", false);
    expect(h["Content-Security-Policy"]).toBeUndefined();
    expect(h["Content-Disposition"]).toBe('inline; filename="inv.pdf"');
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });
  it("keeps the sandbox on anything else, including a fake PDF", () => {
    expect(storedFileHeaders("application/pdf", enc("<html><script>"), "x.pdf", false)["Content-Security-Policy"]).toBe("sandbox");
    expect(storedFileHeaders("image/png", enc("\x89PNG"), "x.png", false)["Content-Security-Policy"]).toBe("sandbox");
    expect(storedFileHeaders("text/html", enc("<html>"), "x.html", true)["Content-Disposition"]).toMatch(/^attachment/);
  });
});
