import { createHash } from "crypto";

// One-time reset (Graeme, 3 Nov 2026): everything on Outstanding
// Transactions was old test entries — clear it and replace it with the
// current Outstanding Transactions sheet (his screenshot of 3 Nov). Sheet
// columns: supplier · card/ref · date · value · team member · status
// dropdown · category · date emailed · note. Status, category, emailed date
// and note are kept together in the line's note; every row starts 'open'
// (each still needs its invoice). Only typo fixed: "Anthropioc" → Anthropic.

export interface SheetRow {
  supplier: string;
  ref: string; // card last4, "BP", or "" when blank on the sheet
  date: string; // ISO
  value: string; // negative for refunds
  teamMember: string;
  sheetStatus?: string;
  category?: string;
  emailedOn?: string; // DD/MM/YYYY as on the sheet
  note?: string;
}

const G = "Graeme";
const PREV = "Posted as previous need invoice";
const NP = "Not posted";
const EMAILED = "Emailed to accounts email address";

export const SHEET_ROWS_2026_11: SheetRow[] = [
  { supplier: "Discount Stickers", ref: "3465", date: "2026-06-05", value: "311.99", teamMember: G, note: "Posted to marketing need invoice" },
  { supplier: "Apple", ref: "3465", date: "2026-06-17", value: "10.99", teamMember: G, note: PREV },
  { supplier: "Slack", ref: "3465", date: "2026-06-19", value: "8.40", teamMember: G, note: PREV },
  { supplier: "FR Warren - Bristol Plastics", ref: "BP", date: "2026-07-02", value: "425.40", teamMember: G, sheetStatus: "Waiting for supplier", note: "Graeme is chasing and has copied Kate in to chase up this week - 21.07.26" },
  { supplier: "Railway", ref: "9275", date: "2026-07-02", value: "15.14", teamMember: G, category: "Dues and subs", note: "KC posted to Dues & Subs - no VAT need invoice" },
  { supplier: "Apple", ref: "3465", date: "2026-07-16", value: "10.99", teamMember: G, note: PREV },
  { supplier: "Screwfix", ref: "3465", date: "2026-08-02", value: "15.98", teamMember: G, note: "Posted to repairs & maintenance with VAT split" },
  { supplier: "Apple", ref: "3465", date: "2026-08-16", value: "10.99", teamMember: G, category: "Dues and subs", note: PREV },
  { supplier: "Aluxo", ref: "3465", date: "2026-08-18", value: "79.49", teamMember: G, category: "Factory equipment", note: "Posted to Factory Equip - non capital VAT split" },
  { supplier: "Capo", ref: "3465", date: "2026-08-20", value: "100.00", teamMember: G, category: "Staff uniform", note: "Posted MISC supplier without VAT - still need invoice" },
  { supplier: "Google Ads", ref: "3465", date: "2026-09-01", value: "185.44", teamMember: G, sheetStatus: EMAILED, emailedOn: "09/10/2026", note: NP },
  { supplier: "Google Ads", ref: "3465", date: "2026-09-01", value: "185.44", teamMember: G, sheetStatus: EMAILED, emailedOn: "09/10/2026", note: NP },
  { supplier: "Google Ads", ref: "3465", date: "2026-09-01", value: "185.44", teamMember: G, sheetStatus: EMAILED, emailedOn: "09/10/2026", note: NP },
  { supplier: "Natural Paving", ref: "3465", date: "2026-09-06", value: "171.32", teamMember: G, note: NP },
  { supplier: "Tool Station", ref: "3465", date: "2026-09-10", value: "15.92", teamMember: G, note: NP },
  { supplier: "Apple", ref: "9275", date: "2026-09-13", value: "8.99", teamMember: G, note: PREV },
  { supplier: "Vonage", ref: "9275", date: "2026-09-13", value: "21.00", teamMember: G, note: NP },
  { supplier: "Capcut", ref: "3465", date: "2026-09-15", value: "13.00", teamMember: G, note: NP },
  { supplier: "Tool Station", ref: "3465", date: "2026-09-17", value: "18.97", teamMember: G, note: NP },
  { supplier: "Starlink", ref: "3465", date: "2026-09-18", value: "107.50", teamMember: G, note: NP },
  { supplier: "Google Ads", ref: "3465", date: "2026-09-22", value: "500.00", teamMember: G, emailedOn: "09/10/2026", note: NP },
  { supplier: "Anthropic", ref: "9275", date: "2026-09-24", value: "15.00", teamMember: G, note: PREV },
  { supplier: "Cakehead", ref: "3465", date: "2026-09-25", value: "160.50", teamMember: G, note: "Posted to food need invoice" },
  { supplier: "MS*HLP31", ref: "7859", date: "2026-09-25", value: "43.00", teamMember: "Jane", note: NP },
  { supplier: "Costco online", ref: "3465", date: "2026-09-26", value: "299.96", teamMember: G, note: NP },
  { supplier: "Costco online", ref: "3465", date: "2026-09-26", value: "199.99", teamMember: G, note: NP },
  { supplier: "Hpi insta ink", ref: "3465", date: "2026-09-27", value: "6.49", teamMember: G, note: PREV },
  { supplier: "one.com", ref: "3465", date: "2026-09-29", value: "7.19", teamMember: G, note: PREV },
  { supplier: "one.com", ref: "3465", date: "2026-09-29", value: "7.19", teamMember: G, note: PREV },
  { supplier: "Google Ads", ref: "3465", date: "2026-09-30", value: "500.00", teamMember: G, emailedOn: "09/10/2026", note: PREV },
  { supplier: "Google Ads", ref: "3465", date: "2026-10-02", value: "93.17", teamMember: G, note: PREV },
  { supplier: "Indeed", ref: "3465", date: "2026-10-02", value: "65.27", teamMember: G, note: PREV },
  { supplier: "The Range", ref: "1244", date: "2026-10-04", value: "16.99", teamMember: "Lauren", note: NP },
  { supplier: "Wickes", ref: "1244", date: "2026-10-04", value: "49.05", teamMember: "Lauren", note: NP },
  { supplier: "Fussy", ref: "3465", date: "2026-10-07", value: "37.99", teamMember: G, sheetStatus: "DLA", note: NP },
  { supplier: "ToolStation", ref: "3465", date: "2026-10-08", value: "2.09", teamMember: G },
  { supplier: "Lounge Guest Gatwick", ref: "", date: "2026-10-09", value: "30.00", teamMember: G },
  { supplier: "Apple", ref: "9275", date: "2026-10-13", value: "8.99", teamMember: G, note: PREV },
  { supplier: "Capcut", ref: "3465", date: "2026-10-15", value: "21.99", teamMember: G },
  { supplier: "Seedlegals", ref: "3465", date: "2026-10-16", value: "58.50", teamMember: G, note: PREV },
  { supplier: "Google Ads", ref: "3465", date: "2026-10-17", value: "500.00", teamMember: G },
  { supplier: "Starlink", ref: "3465", date: "2026-10-18", value: "107.51", teamMember: G },
  { supplier: "Slack", ref: "3465", date: "2026-10-20", value: "8.40", teamMember: G },
  { supplier: "Anthropic", ref: "9275", date: "2026-10-24", value: "15.00", teamMember: G },
  { supplier: "Todoist refund", ref: "3465", date: "2026-10-24", value: "-721.40", teamMember: G },
  { supplier: "Kite packaging", ref: "3465", date: "2026-10-24", value: "63.61", teamMember: G },
  { supplier: "Google Ads", ref: "3465", date: "2026-10-24", value: "500.00", teamMember: G },
  { supplier: "Hpi Insta ink", ref: "3465", date: "2026-10-26", value: "6.49", teamMember: G },
  { supplier: "Anthropic", ref: "9275", date: "2026-10-28", value: "150.00", teamMember: G },
  { supplier: "one.com", ref: "3465", date: "2026-10-28", value: "7.19", teamMember: G },
  { supplier: "one.com", ref: "3465", date: "2026-10-28", value: "7.19", teamMember: G },
  { supplier: "Adobe", ref: "9275", date: "2026-10-28", value: "55.41", teamMember: G },
  { supplier: "Hammersley Brothers", ref: "3465", date: "2026-10-24", value: "1300.00", teamMember: G },
];

/** The line's note: sheet status, category, emailed date and note, in that
 *  order, so nothing on the sheet is lost. Null when the sheet row is bare. */
export function sheetRowNote(row: SheetRow): string | null {
  const parts = [
    row.sheetStatus && row.emailedOn ? `${row.sheetStatus} ${row.emailedOn}` : row.sheetStatus,
    !row.sheetStatus && row.emailedOn ? `Emailed ${row.emailedOn}` : undefined,
    row.category,
    row.note,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? parts.join(" · ") : null;
}

/** The sheet says it's already posted in QuickBooks ("Posted as previous…",
 *  "KC posted…", "posted to repairs…") — but not "Not posted". */
export function sheetRowPosted(row: SheetRow): boolean {
  const note = row.note ?? "";
  return /\bposted\b/i.test(note) && !/^not posted/i.test(note.trim());
}

/** Row position is part of the key so the sheet's exact twins (three Google
 *  Ads 185.44 on 1 Sep, the one.com pairs) each get their own line. */
export function sheetRowDedupeHash(row: SheetRow, index: number): string {
  const key = ["backlog_2026_11", row.date, row.value, row.supplier.toUpperCase(), row.ref, String(index)].join("|");
  return createHash("sha256").update(key).digest("hex");
}
