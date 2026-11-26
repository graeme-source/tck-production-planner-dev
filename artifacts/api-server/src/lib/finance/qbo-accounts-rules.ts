// Shaping QuickBooks accounts for the category picker (pure, tested).
// Objective I.

export interface QboAccountRow {
  Id?: string;
  Name?: string;
  FullyQualifiedName?: string;
  AccountType?: string;
  Classification?: string;
  Active?: boolean;
}

export interface QboPickerAccount {
  id: string;
  /** The account's own name — what the category is called. */
  name: string;
  /** "Parent:Child" for a sub-account, so two of the same name can be told apart. */
  parent: string | null;
  /** "Expense", "Cost of Goods Sold"… in words. */
  type: string;
}

/** "CostofGoodsSold" → "Cost of Goods Sold". */
function words(type: string): string {
  if (type === "CostofGoodsSold") return "Cost of Goods Sold";
  return type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

// Spending accounts first — they're what invoices and card payments are.
const ORDER: Record<string, number> = { Expense: 0, "Cost of Goods Sold": 1, "Other Expense": 2 };

export function qboAccountsForPicker(rows: ReadonlyArray<QboAccountRow>): QboPickerAccount[] {
  const out: QboPickerAccount[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.Name ?? "";
    if (!r.Id || !name.trim() || r.Active === false || seen.has(r.Id)) continue;
    seen.add(r.Id);
    const full = r.FullyQualifiedName ?? name;
    const parent = full.includes(":") ? full.slice(0, full.lastIndexOf(":")) : null;
    out.push({ id: r.Id, name, parent, type: words(r.AccountType ?? r.Classification ?? "") });
  }
  return out.sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9) || a.name.localeCompare(b.name));
}
