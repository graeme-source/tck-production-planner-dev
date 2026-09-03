/** Keeping the batch-booking report honest while it is edited in place.
 *
 *  The report used to be a dead record of one moment: run the batch, read the
 *  outcome, close it. Now a failed row can be retried or rescheduled without
 *  leaving the dialog, so the rows change under the operator — and the three
 *  counters at the top have to change with them.
 *
 *  This lives outside the component because the rule is easy to get subtly
 *  wrong and the damage is silent: a reschedule already flipped a row to
 *  "rescheduled" while the red "1 failed" tile stayed up (Graeme, 2026-09-03),
 *  so the screen disagreed with itself and the operator had no way to tell
 *  which half was lying.
 */

export type ReportStatus = "booked" | "skipped" | "failed";

export interface ReportRow {
  orderId: number;
  status: ReportStatus;
  recordError?: string;
}

export interface ReportCounts {
  booked: number;
  skipped: number;
  failed: number;
  recordErrors: number;
}

/** The counters, always derived from the rows — never adjusted by hand. Every
 *  count on screen has to come from here, or the two can drift apart. */
export function countRows(rows: readonly ReportRow[]): ReportCounts {
  return {
    booked: rows.filter(r => r.status === "booked").length,
    skipped: rows.filter(r => r.status === "skipped").length,
    failed: rows.filter(r => r.status === "failed").length,
    recordErrors: rows.filter(r => r.recordError).length,
  };
}

/** Fold fresh outcomes into the report.
 *
 *  Replaces in place and keeps the original order: a retried row must show its
 *  NEW state where it already sat, never a second row beside the old one — two
 *  rows for one order is how an operator ends up acting on the same failure
 *  twice. An outcome for an order that isn't in the report is ignored rather
 *  than appended, for the same reason. */
export function mergeRows<T extends ReportRow>(
  prev: readonly T[],
  replacements: readonly T[],
): T[] {
  if (replacements.length === 0) return [...prev];
  const byId = new Map(replacements.map(r => [r.orderId, r]));
  return prev.map(row => byId.get(row.orderId) ?? row);
}

/** Change one row in place — for outcomes decided here rather than by the
 *  server, such as an order rescheduled off this dispatch day. */
export function replaceRow<T extends ReportRow>(
  prev: readonly T[],
  orderId: number,
  change: Partial<T>,
): T[] {
  return prev.map(row => (row.orderId === orderId ? { ...row, ...change } : row));
}
