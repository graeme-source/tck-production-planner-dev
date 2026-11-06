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

/** One list: anything with a likely transaction first. */
export function inboxEntries<T>(queue: Queue<T> | undefined): T[] {
  return queue ? [...queue.check, ...queue.waiting] : [];
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
