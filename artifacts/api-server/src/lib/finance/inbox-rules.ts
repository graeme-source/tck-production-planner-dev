// The Finance Inbox (Graeme, 17 Nov 2026): every invoice uploaded but not
// yet marked posted in QuickBooks. A zip is history (the 3–4 Nov import of
// years of invoices), so its files go to the library only.

/** Does an uploaded file wait in the Inbox? `path` is where it came from —
 *  the page unzips before sending, so a zip's files arrive as "x.zip/…". */
export function goesToInbox(path: string, sentAsZip: boolean): boolean {
  return !sentAsZip && !/\.zip\//i.test(path);
}

/**
 * The Inbox also holds every card transaction that has its invoice (or has
 * been marked "no VAT invoice") and isn't done yet (Graeme, 17 Nov 2026:
 * "The inbox is To Be Processed"). It carries how it got there: who matched
 * it from Outstanding transactions, when, and how.
 */
export type MatchedHow = "by_hand" | "automatically" | "from_email" | "no_vat";

export interface MatchedBy { name: string | null; at: string; how: MatchedHow }

/** The events that put a transaction in the Inbox, and how each one did. */
const MATCH_ACTIONS: Record<string, MatchedHow> = {
  document_added: "by_hand",
  status_matched: "by_hand",
  invoice_matched_automatically: "automatically",
  document_attached_from_email: "from_email",
  marked_no_vat_dla: "no_vat",
  marked_no_vat_other: "no_vat",
};

export function isMatchAction(action: string): boolean {
  return action in MATCH_ACTIONS;
}

/** The latest matching event per transaction. */
export function matchedByFromEvents(
  events: Array<{ entityId: number; action: string; userName: string | null; createdAt: Date | string }>,
): Record<number, MatchedBy> {
  const out: Record<number, MatchedBy> = {};
  for (const e of events) {
    const how = MATCH_ACTIONS[e.action];
    if (!how) continue;
    const at = new Date(e.createdAt).toISOString();
    const have = out[e.entityId];
    if (!have || at > have.at) out[e.entityId] = { name: e.userName, at, how };
  }
  return out;
}
