/**
 * Supplier payment rules for the cash flow (Graeme, 2026-10-27): "Due dates
 * from QuickBooks aren't reliable ... AB Fruits is always, I think, on the
 * 1st of the month for everything, up until maybe the 15th ... We need to be
 * able to set rules for certain things ... override it in the cash flow."
 *
 * Pure, tested. Kept in the planner only — QuickBooks is never written to.
 * One rule per supplier; no supplier or term is hard-coded here.
 *
 * Which date a line sits on, strongest first:
 *   1. override  — dragged / picked on the cash flow page
 *   2. rule      — the supplier's payment rule, worked out from the bill date
 *   3. QuickBooks due date
 *   4. the bill date (QuickBooks had no due date)
 */

export type PaymentRule =
  /** N days after the bill date. */
  | { kind: "days_after"; days: number }
  /** On day D of the month after the bill (31 = the last day of that month). */
  | { kind: "next_month_day"; day: number }
  /** On day D of the month after the bill — or the month after that if the
   *  bill is dated after day C ("everything up to the 15th is paid on the 1st"). */
  | { kind: "next_month_day_cutoff"; day: number; cutoff: number }
  /** Use QuickBooks' due date (what happens with no rule at all). */
  | { kind: "qbo" };

export interface SupplierRule { vendorName: string; rule: PaymentRule }

/** "A.B. Fruits", "ab fruits" and "AB  Fruits " are the same supplier. */
export function vendorKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const pad = (n: number) => String(n).padStart(2, "0");
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}
/** Day `day` of the month `add` months after `ymd`'s month, clamped to that month's last day. */
function dayOfMonthAfter(ymd: string, add: number, day: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const idx = (m - 1) + add;
  const year = y + Math.floor(idx / 12);
  const month1 = (idx % 12 + 12) % 12 + 1;
  const d = Math.min(Math.max(1, day), daysInMonth(year, month1));
  return `${year}-${pad(month1)}-${pad(d)}`;
}
function addDaysYmd(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The date a rule puts a bill on, from its bill date. null for "use QuickBooks". */
export function ruleDueDate(rule: PaymentRule, billDate: string): string | null {
  switch (rule.kind) {
    case "days_after": return addDaysYmd(billDate, rule.days);
    case "next_month_day": return dayOfMonthAfter(billDate, 1, rule.day);
    case "next_month_day_cutoff": {
      const billDay = Number(billDate.slice(8, 10));
      return dayOfMonthAfter(billDate, billDay > rule.cutoff ? 2 : 1, rule.day);
    }
    case "qbo": return null;
  }
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};
const dayWords = (d: number) => (d >= 31 ? "last day" : ordinal(d));

/** The rule in plain words, for the page. */
export function describeRule(rule: PaymentRule): string {
  switch (rule.kind) {
    case "days_after": return `${rule.days} day${rule.days === 1 ? "" : "s"} after the bill date`;
    case "next_month_day": return `on the ${dayWords(rule.day)} of the month after the bill`;
    case "next_month_day_cutoff": return `bills up to the ${ordinal(rule.cutoff)} paid on the ${dayWords(rule.day)} of the next month; later ones the month after`;
    case "qbo": return "QuickBooks' due date";
  }
}

export type DateBasis = "override" | "rule" | "qbo" | "bill_date" | "none";

export interface BillDateResolution {
  /** Where the line sits before any drag — rule, else QuickBooks, else bill date. */
  natural: string | null;
  naturalBasis: Exclude<DateBasis, "override">;
  /** Where it actually sits. */
  date: string | null;
  basis: DateBasis;
  /** The date the supplier rule gives, when one applied. */
  ruleDate: string | null;
}

/** Override beats rule beats QuickBooks beats the bill date. */
export function resolveBillDate(args: {
  txnDate: string | null;
  qboDueDate: string | null;
  rule: PaymentRule | null;
  override: string | null;
}): BillDateResolution {
  const ruleDate = args.rule && args.txnDate ? ruleDueDate(args.rule, args.txnDate) : null;
  let natural: string | null; let naturalBasis: BillDateResolution["naturalBasis"];
  if (ruleDate) { natural = ruleDate; naturalBasis = "rule"; }
  else if (args.qboDueDate) { natural = args.qboDueDate; naturalBasis = "qbo"; }
  else if (args.txnDate) { natural = args.txnDate; naturalBasis = "bill_date"; }
  else { natural = null; naturalBasis = "none"; }
  if (args.override) return { natural, naturalBasis, date: args.override, basis: "override", ruleDate };
  return { natural, naturalBasis, date: natural, basis: naturalBasis, ruleDate };
}

/** Rules by supplier key. A later rule for the same supplier wins. */
export function rulesByVendor(rules: readonly SupplierRule[]): Map<string, SupplierRule> {
  const m = new Map<string, SupplierRule>();
  for (const r of rules) { const k = vendorKey(r.vendorName); if (k) m.set(k, r); }
  return m;
}

/** Rule fields as stored (cash_flow_supplier_rules) → a rule, or null if they don't make one. */
export function ruleFromRow(r: { kind: string; days: number | null; day_of_month: number | null; cutoff_day: number | null }): PaymentRule | null {
  if (r.kind === "days_after" && r.days != null && r.days >= 0) return { kind: "days_after", days: r.days };
  if (r.kind === "next_month_day" && r.day_of_month != null) return { kind: "next_month_day", day: r.day_of_month };
  if (r.kind === "next_month_day_cutoff" && r.day_of_month != null && r.cutoff_day != null) return { kind: "next_month_day_cutoff", day: r.day_of_month, cutoff: r.cutoff_day };
  if (r.kind === "qbo") return { kind: "qbo" };
  return null;
}

/** Why so much looks overdue: open bills whose QuickBooks due date is just
 *  the bill date, or that have no due date or no payment terms. */
export interface BillDiagnosis {
  total: number;
  /** Bills hit by any of the reasons below (counted once each). */
  suspect: number;
  suspectAmount: number;
  dueIsBillDate: number;
  noDueDate: number;
  noTerms: number;
  /** Bills a supplier rule now dates instead. */
  ruled: number;
  /** Suppliers with suspect bills and no rule yet, most bills first. */
  suppliers: Array<{ vendorName: string; bills: number; amount: number }>;
}

export function diagnoseBills(
  bills: ReadonlyArray<{ vendorName: string; txnDate?: string | null; dueDate: string | null; termsId?: string | null; termsName?: string | null; balance: number }>,
  rules: readonly SupplierRule[],
): BillDiagnosis {
  const ruleMap = rulesByVendor(rules);
  const out: BillDiagnosis = { total: 0, suspect: 0, suspectAmount: 0, dueIsBillDate: 0, noDueDate: 0, noTerms: 0, ruled: 0, suppliers: [] };
  const sup = new Map<string, { vendorName: string; bills: number; amount: number }>();
  for (const b of bills) {
    if (!(b.balance > 0)) continue;
    out.total++;
    const rule = ruleMap.get(vendorKey(b.vendorName));
    if (rule && rule.rule.kind !== "qbo") out.ruled++;
    const noDue = !b.dueDate;
    const same = !!b.dueDate && !!b.txnDate && b.dueDate === b.txnDate;
    const noTerms = !b.termsId && !b.termsName;
    if (noDue) out.noDueDate++;
    if (same) out.dueIsBillDate++;
    if (noTerms) out.noTerms++;
    if (noDue || same || noTerms) {
      out.suspect++;
      out.suspectAmount += b.balance;
      if (!rule || rule.rule.kind === "qbo") {
        const k = vendorKey(b.vendorName);
        const s = sup.get(k) ?? { vendorName: b.vendorName, bills: 0, amount: 0 };
        s.bills++; s.amount += b.balance;
        sup.set(k, s);
      }
    }
  }
  out.suspectAmount = Math.round(out.suspectAmount * 100) / 100;
  out.suppliers = [...sup.values()].map(s => ({ ...s, amount: Math.round(s.amount * 100) / 100 }))
    .sort((a, b) => b.bills - a.bills || b.amount - a.amount || a.vendorName.localeCompare(b.vendorName));
  return out;
}
