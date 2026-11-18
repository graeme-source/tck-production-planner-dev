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

/** Longest "What is it?" note Quick actions keeps. */
export const QUICK_ADD_NOTE_MAX = 500;

/**
 * Quick actions → Add receipt or invoice asks "What is it?" (Graeme,
 * 18 Nov 2026: "factory food" or similar, so the accounts team know). The
 * typed words become the invoice's note in the Inbox: spaces tidied, capped,
 * nothing typed = no note.
 */
export function quickAddNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tidy = raw.replace(/\s+/g, " ").trim();
  return tidy ? tidy.slice(0, QUICK_ADD_NOTE_MAX) : null;
}

/**
 * Where a suggested transaction came from, said on the match box (Graeme,
 * 18 Nov 2026: "I don't know what I'm attaching it to"). `short` sits in
 * brackets after "I think it's this transaction"; `detail` names the file,
 * who uploaded it and when. Day is a London YYYY-MM-DD.
 */
export function transactionOrigin(t: {
  source: string;
  fileName?: string | null;
  uploadedByName?: string | null;
  uploadedDay?: string | null;
}): { short: string; detail: string | null } | null {
  const when = t.uploadedDay
    ? new Date(`${t.uploadedDay}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : null;
  const by = t.uploadedByName ? ` by ${t.uploadedByName}` : "";
  const on = when ? ` on ${when}` : "";
  if (t.source === "capital_on_tap" || t.source === "allica") {
    const bank = t.source === "allica" ? "Allica" : "Capital on Tap";
    const a = bank === "Allica" ? "An" : "A";
    const file = t.fileName ? `“${t.fileName}”` : `a CSV file`;
    const what = t.source === "allica" ? "bank transaction" : "card transaction";
    return { short: "uploaded from CSV file", detail: `${a} ${bank} ${what}, from ${file} uploaded${by}${on}.` };
  }
  if (t.source === "manual") return { short: "added by hand", detail: `Added by hand on Finance${by}${on}.` };
  if (t.source === "backlog_seed") return { short: "from the old backlog list", detail: "From the backlog of unreceipted card spend brought in on 4 Nov." };
  return null;
}
