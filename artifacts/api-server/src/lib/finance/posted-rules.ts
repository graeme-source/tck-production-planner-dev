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
