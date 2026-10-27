/**
 * Month-end adjustments → what the payroll PDF and email show. PURE (no
 * I/O), so the wording is tested. Objective I.
 */
import type { MonthEndHistoryPdf, MonthEndPdf } from "./pdf";
import {
  groupByFinancialYear, labourWindow, monthLabel, shortDay,
  type DeferredIncome, type FinancialYearGroup, type HistoryRow, type MonthEndLabour,
} from "./month-end";

export type DeferredSummary = Omit<DeferredIncome, "lines"> & { lineCount: number };

export interface MonthEndSummary {
  monthEnd: string;
  label: string;
  payPeriod: { from: string; to: string; label: string };
  deferred: DeferredSummary | null;
  deferredError: string | null;
  labour: MonthEndLabour | null;
  labourError: string | null;
  final: boolean;
  computedAt: string;
  fromStore: boolean;
}

/** A pay period's month end, the one before it (the opening balances) and
 *  the movement between them. */
export interface MonthEndSection {
  current: MonthEndSummary;
  previous: MonthEndSummary | null;
  movement: { deferredIncVat: number | null; deferredExVat: number | null; labourPay: number | null; employer: number | null };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const delta = (closing: number | null | undefined, opening: number | null | undefined) =>
  closing != null && opening != null ? r2(closing - opening) : null;

/** A month end without its order list (that's the CSV). */
export function summariseMonthEnd<T extends { deferred: DeferredIncome | null }>(r: T): Omit<T, "deferred"> & { deferred: DeferredSummary | null } {
  if (!r.deferred) return { ...r, deferred: null };
  const { lines, ...deferred } = r.deferred;
  return { ...r, deferred: { ...deferred, lineCount: lines.length } };
}

export function buildSection(current: MonthEndSummary, previous: MonthEndSummary | null): MonthEndSection {
  return {
    current,
    previous,
    movement: {
      deferredIncVat: delta(current.deferred?.incVat, previous?.deferred?.incVat),
      deferredExVat: delta(current.deferred?.exVat, previous?.deferred?.exVat),
      labourPay: delta(current.labour?.pay, previous?.labour?.pay),
      employer: delta(current.labour?.employer?.total, previous?.labour?.employer?.total),
    },
  };
}

/** "25–30 Sep 2026" */
export function labourWindowLabel(monthEnd: string): string {
  const w = labourWindow(monthEnd);
  return `${Number(w.from.slice(8))}–${shortDay(w.to)}`;
}

const nextMonth = (monthEnd: string) => {
  const d = new Date(`${monthEnd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return monthLabel(d.toISOString().slice(0, 10)).split(" ")[0];
};

export function monthEndPdf(sec: MonthEndSection): MonthEndPdf {
  const c = sec.current;
  const p = sec.previous;
  const d = c.deferred;
  const l = c.labour;
  const deferredNotes = d ? [
    ...(d.laterCancelled.orders > 0 ? [`Includes ${d.laterCancelled.orders} order${d.laterCancelled.orders === 1 ? "" : "s"} (£${d.laterCancelled.incVat.toFixed(2)}) cancelled or refunded after the month end — the refund lands next month, against the release.`] : []),
    ...d.warnings,
  ] : [];
  return {
    title: `Month-end adjustments for ${c.label}`,
    deferred: d ? {
      heading: `Deferred income at ${shortDay(c.monthEnd)}`,
      incVat: d.incVat,
      exVat: Math.abs(d.vat) >= 0.005 ? d.exVat : null,
      orders: d.orders,
      definition: `Orders paid by 23:59 on ${shortDay(c.monthEnd)} (London time) but not dispatched by then; orders cancelled or refunded in full by then are left out, as are gift cards and memberships. It is ${c.label}'s money for food sent in ${nextMonth(c.monthEnd)}.`,
      opening: p?.deferred ? { label: `deferred income at ${shortDay(p.monthEnd)}`, incVat: p.deferred.incVat } : null,
      movement: sec.movement.deferredIncVat,
      trust: d.trust.summary,
      notes: deferredNotes,
    } : null,
    deferredError: c.deferredError,
    labour: l ? {
      heading: `Labour ${labourWindowLabel(c.monthEnd)}, paid in this pay period`,
      pay: l.pay,
      hours: l.hours,
      holidayPay: l.holidayPay,
      holidayHours: l.holidayHours,
      opening: p?.labour ? { label: `labour ${labourWindowLabel(p.monthEnd)}`, pay: p.labour.pay } : null,
      movement: sec.movement.labourPay,
      employer: l.employer ? { total: l.employer.total, ni: l.employer.ni, pension: l.employer.pension, note: l.employer.note } : null,
      notes: l.warnings,
    } : null,
    labourError: c.labourError,
  };
}

export function historyPdf(rows: readonly HistoryRow[], years: readonly FinancialYearGroup[] = groupByFinancialYear(rows)): MonthEndHistoryPdf {
  const opening = rows.find(r => r.isOpening);
  return {
    opening: opening ? { label: opening.label, deferred: opening.deferredIncVat.closing, labour: opening.labourPay.closing } : null,
    years: years.map(y => ({
      year: y.year, span: y.span, complete: y.complete, deferred: y.deferredIncVat, labour: y.labourPay,
      rows: y.rows.map(r => ({ label: r.label, deferred: r.deferredIncVat, labour: r.labourPay, trustworthy: r.trustworthy, error: r.error })),
    })),
  };
}

const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The lines the payroll email adds about the month end. */
export function monthEndEmailLines(sec: MonthEndSection | null, withHistory: boolean): string[] {
  if (!sec) return [];
  const c = sec.current;
  const parts: string[] = [];
  if (c.deferred) parts.push(`deferred income at ${shortDay(c.monthEnd)} ${money(c.deferred.incVat)} (${c.deferred.orders} orders paid but not yet dispatched)`);
  if (c.labour) parts.push(`labour ${labourWindowLabel(c.monthEnd)} ${money(c.labour.pay)} (paid in this period, belongs to ${c.label})`);
  const lines = parts.length ? [`Month-end adjustments for ${c.label}: ${parts.join("; ")} — details in the PDF.`] : [];
  if (withHistory) lines.push("The PDF has an appendix with every month end since 31 Mar 2025, and the same history is attached as a spreadsheet (CSV).");
  return lines;
}
