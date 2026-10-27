/**
 * Cash flow drag-and-drop, on the client (Graeme, 2026-10-27: "drag and drop
 * things around so I can push things back and decide to pay things later").
 *
 * Moving a line re-works the running balance, lowest point and totals at
 * once (an optimistic update) while the move saves; the server's forecast
 * (api-server lib/finance/cash-flow.ts) replaces it when it comes back. Pure.
 */

export type DateBasis = "override" | "rule" | "qbo" | "bill_date" | "none";

export interface CfLine {
  source: "bill" | "payout" | "item";
  ref: string;
  key: string;
  occurrence: string;
  label: string;
  amount: number;
  date: string | null;
  naturalDate: string | null;
  movedFrom?: string;
  late: boolean;
  undated?: boolean;
  bill?: {
    vendorName: string;
    txnDate: string | null;
    qboDueDate: string | null;
    termsName: string | null;
    hasTerms: boolean;
    basis: DateBasis;
    naturalBasis: Exclude<DateBasis, "override">;
    ruleDate: string | null;
    ruleText: string | null;
  };
}
export interface CfDay { date: string; opening: number; ins: CfLine[]; outs: CfLine[]; closing: number }
export interface CfForecast {
  start: string;
  openingBalance: number;
  days: CfDay[];
  lowest: { date: string; balance: number } | null;
  totalIn: number;
  totalOut: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Running balance, lowest point and totals from the lines on each day. */
export function recompute(f: CfForecast): CfForecast {
  let running = f.openingBalance;
  let lowest: CfForecast["lowest"] = null;
  let totalIn = 0, totalOut = 0;
  const days = f.days.map(d => {
    const sumIn = d.ins.reduce((s, l) => s + l.amount, 0), sumOut = d.outs.reduce((s, l) => s + l.amount, 0);
    const opening = round2(running);
    running += sumIn - sumOut;
    totalIn += sumIn; totalOut += sumOut;
    const day = { ...d, opening, closing: round2(running) };
    if (!lowest || day.closing < lowest.balance) lowest = { date: d.date, balance: day.closing };
    return day;
  });
  return { ...f, days, lowest, totalIn: round2(totalIn), totalOut: round2(totalOut) };
}

/** "3 Oct" */
export const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Where a bill's date came from, in plain words (2026-10-27):
 *   "Bill 3 Oct · QuickBooks due 3 Oct (no payment terms)"
 *   "Due 1 Nov by your AB Fruits rule; QuickBooks says 3 Oct"
 */
export function explainBill(l: CfLine): string[] {
  const b = l.bill;
  if (!b) return [];
  const terms = b.termsName ? `(${b.termsName})` : b.hasTerms ? "(payment terms set in QuickBooks)" : "(no payment terms)";
  const first = [
    b.txnDate ? `Bill ${shortDate(b.txnDate)}` : "No bill date",
    b.qboDueDate ? `QuickBooks due ${shortDate(b.qboDueDate)} ${terms}` : `no due date in QuickBooks ${terms}`,
  ].join(" · ");
  const out = [first];
  const qbSays = b.qboDueDate ? `QuickBooks says ${shortDate(b.qboDueDate)}` : "QuickBooks has no due date";
  if (b.ruleDate) out.push(`Due ${shortDate(b.ruleDate)} by your ${b.vendorName} rule; ${qbSays}`);
  else if (b.naturalBasis === "bill_date" && b.txnDate) out.push(`Placed on the bill date, ${shortDate(b.txnDate)}`);
  if (b.basis === "override" && l.date) out.push(`You moved it to ${shortDate(l.date)}${l.movedFrom ? ` from ${shortDate(l.movedFrom)}` : ""}`);
  return out;
}

/** Find a line by its key. */
export function findLine(f: CfForecast, key: string): { line: CfLine; dir: "in" | "out"; day: string } | null {
  for (const d of f.days) {
    const i = d.ins.find(l => l.key === key); if (i) return { line: i, dir: "in", day: d.date };
    const o = d.outs.find(l => l.key === key); if (o) return { line: o, dir: "out", day: d.date };
  }
  return null;
}

/**
 * Move one line to `toDate` — or back to where it naturally falls when
 * `toDate` is null ("Put back"). Before the first day it sits on the first
 * day, flagged late; after the last day it leaves the window.
 */
export function moveLine(f: CfForecast, key: string, toDate: string | null): CfForecast {
  const found = findLine(f, key);
  if (!found || f.days.length === 0) return f;
  const target = toDate ?? found.line.naturalDate;
  if (!target) return f;
  const first = f.days[0].date, last = f.days[f.days.length - 1].date;
  const back = target === found.line.naturalDate;
  const line: CfLine = {
    ...found.line,
    date: target,
    late: target < first,
    movedFrom: back ? undefined : found.line.naturalDate ?? undefined,
    ...(found.line.bill ? { bill: { ...found.line.bill, basis: back ? found.line.bill.naturalBasis : "override" } } : {}),
  };
  if (back) delete line.movedFrom;
  const place = target < first ? first : target;
  const days = f.days.map(d => {
    const strip = (ls: CfLine[]) => ls.filter(l => l.key !== key);
    let ins = strip(d.ins), outs = strip(d.outs);
    if (d.date === place && place <= last) {
      if (found.dir === "in") ins = [...ins, line]; else outs = [...outs, line];
    }
    return { ...d, ins, outs };
  });
  return recompute({ ...f, days });
}
