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
