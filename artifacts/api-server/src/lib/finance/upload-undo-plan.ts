// Undoing a statement upload (Graeme, 4 Nov 2026): which of its transactions
// can go. Pure and unit-tested; upload-undo.ts does the work.

/** What the system does by itself: none of it is anyone's work to lose. */
const AUTOMATIC_ACTIONS = new Set([
  "auto_done",
  "found_posted_in_quickbooks",
  "invoice_matched_automatically",
  "invoice_taken_off",
]);

const AUTOMATIC_DOCUMENTS = new Set(["auto_match"]);

export interface LineHistory {
  noVatReason: string | null;
  statusNote: string | null;
  /** Everything that has happened to the line. */
  actions: string[];
  /** Where each of its documents came from. */
  documentSources: string[];
}

/** Why a line has to stay, in plain words, or null if it can go. */
export function whyKeepLine(line: LineHistory): string | null {
  if (line.noVatReason) return "marked as no VAT invoice";
  if (line.documentSources.some((s) => !AUTOMATIC_DOCUMENTS.has(s))) return "has a document someone added";
  if (line.statusNote?.trim()) return "has a note on it";
  if (line.actions.includes("chased")) return "has been chased";
  if (line.actions.some((a) => !AUTOMATIC_ACTIONS.has(a))) return "someone has worked on it";
  return null;
}

/** "invoice:123" → 123. */
export function invoiceIdFromRef(ref: string | null): number | null {
  const m = /^invoice:(\d+)$/.exec(ref ?? "");
  return m ? Number(m[1]) : null;
}
