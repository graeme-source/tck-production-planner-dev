// Pure rules for the QuickBooks posted match and the mailbox login check —
// no database, so they're unit-tested on their own.

/** What a QuickBooks match writes onto a line: the link and the Posted tick,
 *  nothing else. Status, note and done-ness are left alone (Graeme,
 *  2026-11-03: "never close a line down if it's posted on QuickBooks").
 *  An earlier hand tick keeps its date. */
export function postedLinkFields(line: { postedDetectedAt: Date | null }, qboTxnId: number, now: Date) {
  return { qboTxnId, postedDetectedAt: line.postedDetectedAt ?? now, updatedAt: now };
}

/** Plain-English reason an IMAP login failed. imapflow throws a bare
 *  "Command failed" on a refused login, with authenticationFailed set. */
export function describeImapLoginError(err: unknown): string {
  const e = (err ?? {}) as { authenticationFailed?: boolean; code?: string; message?: string; responseText?: string };
  if (e.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials|login failed/i.test(`${e.responseText ?? ""} ${e.message ?? ""}`)) {
    return "one.com refused the email address or password";
  }
  if (e.code === "ETIMEDOUT" || e.code === "ECONNREFUSED" || e.code === "ECONNRESET" || e.code === "ENOTFOUND" || /timed? ?out/i.test(e.message ?? "")) {
    return "Couldn't reach one.com from the server (it may be blocking us) — the password wasn't checked";
  }
  return `Login failed: ${e.responseText || e.message || "unknown error"}`;
}


/** Done, by definition (Graeme, 2026-11-03): posted in QuickBooks AND a VAT
 *  invoice attached. A line that's both closes itself; a line already
 *  closed (done or not needed) is left alone. */
export function isReadyToClose(line: { status: string; postedDetectedAt: Date | null }, hasVatInvoice: boolean): boolean {
  return (line.status === "open" || line.status === "identified" || line.status === "matched")
    && line.postedDetectedAt != null && hasVatInvoice;
}


/** Headers for serving a stored finance file. Files come from anywhere, so
 *  the response is sandboxed — EXCEPT a genuine PDF (by its bytes, not its
 *  claimed type): Chrome and Edge refuse to show a PDF under a sandbox and
 *  offer a download instead (a colleague couldn't preview invoices, Graeme
 *  2026-11-03). nosniff means a non-PDF can never be shown as one. */
export function storedFileHeaders(mime: string, bytes: Uint8Array, fileName: string, download: boolean): Record<string, string> {
  const isRealPdf = mime === "application/pdf" && bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // "%PDF-"
  const headers: Record<string, string> = {
    "Content-Type": mime || "application/octet-stream",
    "Content-Length": String(bytes.length),
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${(fileName || "document").replace(/["\r\n]/g, "")}"`,
    "X-Content-Type-Options": "nosniff",
  };
  if (!isRealPdf) headers["Content-Security-Policy"] = "sandbox";
  return headers;
}
