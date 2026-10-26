// Pure mapping for open QuickBooks supplier bills (accounts payable) — the
// raw Bill entities the AP ageing summary is built from, turned into rows a
// cash-flow page can place on the day each bill falls due. No db, no fetch:
// qbo-open-bills.ts does the I/O.

export interface OpenBill {
  id: string;
  vendorId: string | null;
  vendorName: string;
  docNumber: string | null;
  txnDate: string;
  dueDate: string | null;
  balance: number;
  currency: string;
}

// QBO omits CurrencyRef when multicurrency is off, so the home currency is
// the honest default for this (UK) company.
const HOME_CURRENCY = "GBP";

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** QBO dates are "YYYY-MM-DD" but tolerate a full timestamp too. */
function ymd(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function ref(v: unknown): { value: string | null; name: string | null } {
  if (!v || typeof v !== "object") return { value: null, name: null };
  const r = v as Record<string, unknown>;
  return { value: str(r["value"]), name: str(r["name"]) };
}

/**
 * Map raw QBO Bill entities (one or more pages concatenated) to open bills.
 * Skips anything with Balance <= 0 (paid, or a credit) and anything without
 * an Id or TxnDate. Duplicate Ids — possible when pages overlap because a
 * bill changed mid-fetch — keep the last copy seen. Sorted by due date
 * (no due date sorts by bill date), then supplier.
 */
export function openBillsFromQbo(raw: unknown[]): OpenBill[] {
  const byId = new Map<string, OpenBill>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const id = str(b["Id"]);
    const txnDate = ymd(b["TxnDate"]);
    const balance = num(b["Balance"]);
    if (!id || !txnDate || balance === null || balance <= 0) continue;
    const vendor = ref(b["VendorRef"]);
    const currency = ref(b["CurrencyRef"]);
    byId.set(id, {
      id,
      vendorId: vendor.value,
      vendorName: vendor.name ?? "Unknown supplier",
      docNumber: str(b["DocNumber"]),
      txnDate,
      dueDate: ymd(b["DueDate"]),
      // Balance is in the bill's own currency, not home currency.
      balance: Math.round(balance * 100) / 100,
      currency: currency.value ?? HOME_CURRENCY,
    });
  }
  return [...byId.values()].sort(compareDue);
}

// A bill with no DueDate is treated as due on its bill date (QBO's own
// "Due on receipt" behaviour), so it never silently drops off the calendar.
function effectiveDue(b: OpenBill): string {
  return b.dueDate ?? b.txnDate;
}

function compareDue(a: OpenBill, b: OpenBill): number {
  return effectiveDue(a).localeCompare(effectiveDue(b))
    || a.vendorName.localeCompare(b.vendorName)
    || a.id.localeCompare(b.id);
}

/** Bills due on or before `date` (YYYY-MM-DD), most overdue first. */
export function billsDueBy(bills: OpenBill[], date: string): OpenBill[] {
  return bills.filter(b => effectiveDue(b) <= date).sort(compareDue);
}
