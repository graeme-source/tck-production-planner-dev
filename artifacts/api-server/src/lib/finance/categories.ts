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

/** How long after sending a receipt from Quick actions its sender can still
 *  say what it is (they may not have Finance, so it's their own, fresh ones). */
export const OWN_UPLOAD_TAG_HOURS = 24;

/**
 * Quick actions: send first, then say what it is (Graeme, 18 Nov 2026: "we
 * might upload four invoices at once, and they might all be different").
 * Someone without Finance may set the category and note only on an invoice
 * they sent themselves, in the last day, that isn't posted yet.
 */
export function canTagOwnUpload(
  inv: { uploadedBy: number | null; createdAt: Date; postedAt: Date | null },
  userId: number,
  now: Date,
): boolean {
  if (inv.uploadedBy !== userId || inv.postedAt != null) return false;
  return now.getTime() - inv.createdAt.getTime() <= OWN_UPLOAD_TAG_HOURS * 3600_000;
}
