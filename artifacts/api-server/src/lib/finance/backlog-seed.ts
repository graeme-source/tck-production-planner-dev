import { createHash } from "crypto";

// One-time seed: the complete "Outstanding Transactions" Google Sheet backlog
// as supplied by Graeme (screenshot, 27 Aug 2026 — the sheet's full open
// list; see docs/vat-reconciliation/seed-backlog.csv). Statuses map the
// sheet's green notes: "Posted as previous — need invoice" etc. all mean the
// bookkeeper still needs the document, so every seeded line starts 'open'
// with the note preserved.
//
// The seed runs once, guarded by fin_lines being empty of 'backlog_seed'
// rows — never re-inserts, never overwrites later edits.

export interface BacklogRow {
  supplier: string;
  ref: string; // card last4, or DD / BP
  date: string; // ISO
  value: string;
  teamMember: string;
  note: string;
}

export const BACKLOG_ROWS: BacklogRow[] = [
  { supplier: "Indoors Outdoors", ref: "3465", date: "2026-04-12", value: "68.00", teamMember: "Graeme", note: "Posted to factory equipment but need invoice" },
  { supplier: "Costco", ref: "3465", date: "2026-05-07", value: "229.99", teamMember: "Graeme", note: "" },
  { supplier: "Indeed", ref: "3465", date: "2026-06-02", value: "124.55", teamMember: "Graeme", note: "Posted as previous invoice needed" },
  { supplier: "Gigaclear", ref: "DD", date: "2026-06-03", value: "120.00", teamMember: "Graeme", note: "Posted as previous invoice needed" },
  { supplier: "Discount Stickers", ref: "3465", date: "2026-06-05", value: "311.99", teamMember: "Graeme", note: "Posted to marketing need invoice" },
  { supplier: "Apple", ref: "3465", date: "2026-06-15", value: "8.99", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Apple", ref: "3465", date: "2026-06-17", value: "10.99", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Slack", ref: "3465", date: "2026-06-19", value: "8.40", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Hammersley Brothers", ref: "3465", date: "2026-06-21", value: "1300.00", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "RS Components", ref: "3465", date: "2026-06-11", value: "282.00", teamMember: "Graeme", note: "Factory equipment - KC posted with VAT split - please provide invoice" },
  { supplier: "RS Components", ref: "3465", date: "2026-06-11", value: "139.72", teamMember: "Graeme", note: "Factory equipment - KC posted with VAT split - please provide invoice" },
  { supplier: "one.com", ref: "3465", date: "2026-06-29", value: "7.19", teamMember: "Graeme", note: "x2 invoices for 7.19 - posted as previous invoice needed" },
  { supplier: "Gigaclear", ref: "DD", date: "2026-07-03", value: "120.00", teamMember: "Graeme", note: "Posted as previous invoice needed" },
  { supplier: "FR Warren - Bristol Plastics", ref: "BP", date: "2026-07-02", value: "425.40", teamMember: "Graeme", note: "Graeme chasing; Kate copied in to chase this week (21/07/26)" },
  { supplier: "Railway", ref: "9275", date: "2026-07-02", value: "15.14", teamMember: "Graeme", note: "KC posted to Dues & Subs - no VAT - need invoice" },
  { supplier: "Indeed", ref: "3465", date: "2026-07-02", value: "34.11", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Aluxo", ref: "3465", date: "2026-07-06", value: "315.59", teamMember: "Graeme", note: "Factory equipment - KC posted with VAT split - please provide invoice; waiting for supplier" },
  { supplier: "Apple", ref: "9275", date: "2026-07-13", value: "8.99", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Apple", ref: "3465", date: "2026-07-16", value: "10.99", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Costco", ref: "3465", date: "2026-07-15", value: "429.99", teamMember: "Graeme", note: "Factory equipment - KC posted with VAT split - please provide invoice; waiting for supplier" },
  { supplier: "HP Instant Ink", ref: "3456", date: "2026-07-26", value: "20.99", teamMember: "Graeme", note: "Posted as previous but need invoice" },
  { supplier: "one.com", ref: "3465", date: "2026-07-23", value: "288.90", teamMember: "Graeme", note: "Dues & subs - KC posted with VAT split - please provide invoice" },
  { supplier: "SP Carpet Warehouse", ref: "3465", date: "2026-07-23", value: "105.88", teamMember: "Graeme", note: "Not posted" },
  { supplier: "one.com", ref: "3465", date: "2026-07-28", value: "7.19", teamMember: "Graeme", note: "Posted as previous invoice needed" },
  { supplier: "one.com", ref: "3465", date: "2026-07-28", value: "7.19", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Screwfix", ref: "3465", date: "2026-08-02", value: "15.98", teamMember: "Graeme", note: "Not posted" },
  { supplier: "Rotherley.com", ref: "3465", date: "2026-08-12", value: "29.51", teamMember: "Graeme", note: "Not posted" },
  { supplier: "Deliciously Guilt", ref: "3465", date: "2026-08-13", value: "34.98", teamMember: "Graeme", note: "Not posted" },
  { supplier: "Apple", ref: "9275", date: "2026-08-13", value: "8.99", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Seedlegals", ref: "3465", date: "2026-08-16", value: "58.50", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Apple", ref: "3465", date: "2026-08-16", value: "10.99", teamMember: "Graeme", note: "Posted as previous need invoice" },
  { supplier: "Bunzl", ref: "7859", date: "2026-08-18", value: "58.03", teamMember: "Jane", note: "Not posted" },
  { supplier: "Aluxo", ref: "3465", date: "2026-08-18", value: "79.49", teamMember: "Graeme", note: "Not posted" },
  { supplier: "Starlink", ref: "3465", date: "2026-08-18", value: "107.50", teamMember: "Graeme", note: "Posted as previous need invoice" },
];

// Distinguishes the two identical one.com 7.19 rows (and any future exact
// twins) by including the row's position for backlog rows only — the sheet
// is a fixed historical artefact, so index-stability is guaranteed.
export function backlogDedupeHash(row: BacklogRow, index: number): string {
  const key = ["backlog_seed", row.date, row.value, row.supplier.toUpperCase(), row.ref, String(index)].join("|");
  return createHash("sha256").update(key).digest("hex");
}
