/**
 * The Inbox on Finance → Outstanding invoices (Graeme, 6 Nov 2026): invoices
 * dropped in that haven't got a transaction. It works like sending them to the
 * accounts email address: the bookkeeper finds the transaction in QuickBooks,
 * posts it, and marks it posted.
 */

type InboxInvoice = {
  supplierName: string | null;
  invoiceNumber: string | null;
  fileName: string;
  notes: string | null;
  totalAmount: string | null;
  gbpRate?: number | null;
};

type Queue<T> = { check: T[]; waiting: T[] };

/** One list, newest at the top like an email inbox (Graeme, 27 Nov 2026) —
 *  by when each invoice landed in the Inbox. A likely transaction still shows
 *  on its card; it no longer jumps the queue. */
export function inboxEntries<T extends { invoice: { id: number; awaitingTransactionAt?: string | null } }>(queue: Queue<T> | undefined): T[] {
  if (!queue) return [];
  const at = (e: T) => (e.invoice.awaitingTransactionAt ? Date.parse(e.invoice.awaitingTransactionAt) : 0) || 0;
  return [...queue.check, ...queue.waiting].sort((a, b) => at(b) - at(a) || b.invoice.id - a.invoice.id);
}

/** The value in pounds, at the invoice's own day's rate when it isn't. */
export function inboxTotal(entries: Array<{ invoice: InboxInvoice }>): number {
  return entries.reduce((sum, { invoice }) => sum + Number(invoice.totalAmount ?? 0) * (invoice.gbpRate ?? 1), 0);
}

export function matchesInboxSearch(invoice: InboxInvoice, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [invoice.supplierName, invoice.invoiceNumber, invoice.fileName, invoice.notes, invoice.totalAmount]
    .some((v) => v != null && v.toLowerCase().includes(q));
}

/** The whole Inbox as one list, newest first (Graeme, 27 Nov 2026: matched
 *  transactions shouldn't sit in a group of their own). A matched transaction
 *  counts from when it was put in the Inbox, an invoice from when it landed. */
export type InboxItem<L, I> = { kind: "matched"; at: number; line: L } | { kind: "invoice"; at: number; entry: I };

export function mergeInbox<L extends { id: number }, I extends { invoice: { id: number } }>(
  matched: readonly L[], invoices: readonly I[],
  matchedAt: (l: L) => string | null | undefined, invoiceAt: (e: I) => string | null | undefined,
): Array<InboxItem<L, I>> {
  const ms = (s: string | null | undefined) => (s ? Date.parse(s) : 0) || 0;
  const items: Array<InboxItem<L, I>> = [
    ...matched.map(line => ({ kind: "matched" as const, at: ms(matchedAt(line)), line })),
    ...invoices.map(entry => ({ kind: "invoice" as const, at: ms(invoiceAt(entry)), entry })),
  ];
  return items.sort((a, b) => b.at - a.at);
}
