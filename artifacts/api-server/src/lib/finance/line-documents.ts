// Where a card transaction sits once documents are on it (Graeme, 19 Nov
// 2026): only a VAT invoice — the thing that lets us reclaim the VAT — moves
// it to the Inbox ('matched'). An order confirmation or receipt keeps it in
// Outstanding ('identified': we know what it was, still chasing the VAT
// invoice). Pure; the routes apply it after adding or relabelling a document.

const MOVABLE = new Set(["open", "identified", "matched"]);

/**
 * The status a transaction should have given the kinds of the (current,
 * not superseded) documents on it, or null to leave it as it is. Done and
 * not-needed transactions are never moved.
 */
export function statusForDocuments(current: string, kinds: string[]): string | null {
  if (!MOVABLE.has(current)) return null;
  const next = kinds.includes("invoice") ? "matched" : kinds.length > 0 ? "identified" : current === "matched" ? "open" : current;
  return next === current ? null : next;
}
