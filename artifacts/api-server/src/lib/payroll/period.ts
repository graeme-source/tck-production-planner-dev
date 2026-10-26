/**
 * TCK pay periods — pure, no I/O (Objective I: payroll is people's pay).
 *
 * TCK runs payroll from the 25th of the previous month to the 24th of the
 * current month, both days included: 2026-09-25 .. 2026-10-24 is October's
 * payroll. Dates are plain "YYYY-MM-DD" strings (London calendar days);
 * no time zones are involved.
 */

export interface PayPeriod { from: string; to: string; label: string }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function iso(y: number, m: number, d: number): string {
  // m is 0-based and may overflow either way; Date.UTC normalises it.
  const dt = new Date(Date.UTC(y, m, d));
  return dt.toISOString().slice(0, 10);
}

function parse(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) throw new Error(`Not a date: "${date}"`);
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** "25 Sep – 24 Oct 2026"; the year shows twice only when the period spans
 *  New Year ("25 Dec 2026 – 24 Jan 2027"). */
export function payPeriodLabel(from: string, to: string): string {
  const a = parse(from);
  const b = parse(to);
  const left = `${a.d} ${MONTHS[a.m]}${a.y !== b.y ? ` ${a.y}` : ""}`;
  return `${left} – ${b.d} ${MONTHS[b.m]} ${b.y}`;
}

/** The pay period containing `date`. */
export function payPeriodFor(date: string): PayPeriod {
  const { y, m, d } = parse(date);
  // On or after the 25th: this month's 25th to next month's 24th.
  // Before the 25th: last month's 25th to this month's 24th.
  const startMonth = d >= 25 ? m : m - 1;
  const from = iso(y, startMonth, 25);
  const to = iso(y, startMonth + 1, 24);
  return { from, to, label: payPeriodLabel(from, to) };
}

/**
 * The `n` pay periods BEFORE the one containing `today`, newest first —
 * the finished periods a payroll report can be run for. (The period in
 * progress is `payPeriodFor(today)`.)
 */
export function previousPayPeriods(today: string, n: number): PayPeriod[] {
  const out: PayPeriod[] = [];
  let cursor = payPeriodFor(today).from;
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    const { y, m, d } = parse(cursor);
    const p = payPeriodFor(iso(y, m, d - 1));
    out.push(p);
    cursor = p.from;
  }
  return out;
}
