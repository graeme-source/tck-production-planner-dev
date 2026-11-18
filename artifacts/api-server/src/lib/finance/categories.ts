// "What is this item?" — the fixed categories an invoice or card transaction
// is given (Graeme, 18 Nov 2026), named exactly as their QuickBooks accounts
// so the bookkeeper posts to the account it says. The list is data
// (fin_categories, migration 0380); these are the pure rules around it.

/** A category id sent as a form field or JSON: a positive whole number, or null. */
export function parseCategoryId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A new or renamed category, as typed. Only trimmed: QuickBooks names can
 * carry odd spacing ("Food Purchases  TCK Delivered" has two) and must match
 * character for character. Returns an error message instead when unusable.
 */
export function cleanCategoryName(raw: string, existing: Array<{ id: number; name: string }>, selfId?: number): { name: string } | { error: string } {
  const name = raw.trim();
  if (!name) return { error: "Give the category a name" };
  if (name.length > 120) return { error: "That name is too long" };
  const clash = existing.find(c => c.id !== selfId && c.name.toLowerCase() === name.toLowerCase());
  if (clash) return { error: `"${clash.name}" is already a category` };
  return { name };
}
