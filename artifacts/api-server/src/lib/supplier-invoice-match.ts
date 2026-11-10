/**
 * Which supplier an invoice is from, by the name read off it (Graeme, 10 Nov
 * 2026: "Northamptonshire Food Services is NFS Meats"), so the Finance Inbox
 * can show that supplier's payment terms. Objective I. Pure.
 *
 * A name typed on the supplier as "on their invoices" matches exactly
 * (spacing, case and punctuation ignored). Otherwise every word of the
 * supplier's name, or of one of those names, must be on the invoice —
 * "The Best Butcher" matches "T.H.E. Best Butchers Ltd" — and the supplier
 * with the most words matched wins. Company endings (Ltd, Limited, UK…)
 * and "the" don't count as words.
 */

export type PaymentTerms = "paid_when_ordered" | "on_account";

export interface SupplierForMatch {
  id: number;
  name: string;
  paymentTerms: PaymentTerms;
  invoiceNames: string[];
}

export interface SupplierMatch {
  supplierId: number;
  supplierName: string;
  paymentTerms: PaymentTerms;
}

const IGNORED = new Set(["the", "ltd", "limited", "plc", "llp", "uk", "gb", "co", "and", "of"]);

/** "T.H.E. Best Butchers Ltd" → ["best", "butcher"]. */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !IGNORED.has(w))
    // Plural and singular are the same word.
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchSupplierForInvoice(invoiceName: string | null | undefined, suppliers: readonly SupplierForMatch[]): SupplierMatch | null {
  if (!invoiceName?.trim()) return null;
  const toMatch = (s: SupplierForMatch): SupplierMatch => ({ supplierId: s.id, supplierName: s.name.trim(), paymentTerms: s.paymentTerms });

  const exact = squash(invoiceName);
  const linked = suppliers.find((s) => s.invoiceNames.some((n) => squash(n) === exact && exact.length > 0));
  if (linked) return toMatch(linked);

  const onInvoice = new Set(nameWords(invoiceName));
  let best: { s: SupplierForMatch; words: number } | null = null;
  for (const s of suppliers) {
    for (const candidate of [s.name, ...s.invoiceNames]) {
      const words = nameWords(candidate);
      if (words.length === 0) continue;
      // A one-word name has to be a real word, not "a" or "tc".
      if (words.length === 1 && words[0].length < 3) continue;
      if (!words.every((w) => onInvoice.has(w))) continue;
      if (!best || words.length > best.words) best = { s, words: words.length };
    }
  }
  return best ? toMatch(best.s) : null;
}
