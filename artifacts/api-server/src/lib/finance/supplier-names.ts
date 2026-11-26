// Supplier names to offer when adding a transaction (Graeme, 26 Nov 2026).
// One per supplier: the spelling seen most often ("Klaviyo Inc" over
// "Klaviyo, Inc."), most-used suppliers first. Pure, tested. Objective I.
import { normaliseMerchant } from "./merchant-normalise";

export function supplierNameChoices(rows: ReadonlyArray<{ name: string; count: number }>): Array<{ name: string; count: number }> {
  const bySupplier = new Map<string, { total: number; spellings: Map<string, number> }>();
  for (const r of rows) {
    const name = r.name?.trim();
    if (!name) continue;
    const key = normaliseMerchant(name).replace(/[^A-Z0-9]/g, "");
    if (!key) continue;
    const s = bySupplier.get(key) ?? { total: 0, spellings: new Map<string, number>() };
    s.total += r.count;
    s.spellings.set(name, (s.spellings.get(name) ?? 0) + r.count);
    bySupplier.set(key, s);
  }
  return [...bySupplier.values()]
    .map((s) => ({ name: [...s.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], count: s.total }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
