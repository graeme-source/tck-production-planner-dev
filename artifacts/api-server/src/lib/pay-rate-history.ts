/**
 * When did someone last get a pay rise? (Graeme, 26 Nov 2026.) Planday's
 * pay-rate API gives today's rates but no dates, so this reads the rate on
 * each paid shift: the last rise is the first day their CURRENT rate was
 * paid, provided a different rate was paid before it. Someone in two
 * employee groups on two rates, alternating, has no rise until a rate
 * appears that wasn't paid before. Pure, tested. Objective H.
 */
export interface PaidShift { date: string; rate: number; type: string }

export interface PayHistory {
  /** The rate on their latest paid shift; null with no shifts. */
  currentRate: number | null;
  /** First day the current rate was paid after a different one. */
  lastChangeOn: string | null;
  /** The rate they were on before it (the one paid most in the 60 days before). */
  previousRate: number | null;
  /** Each day a rate was paid for the first time, after another: date, from, to. */
  changes: Array<{ date: string; from: number; to: number }>;
}

const round = (n: number) => Math.round(n * 100) / 100;
const isHourly = (t: string) => /hour/i.test(t);

export function payHistory(shifts: readonly PaidShift[]): PayHistory {
  const paid = shifts
    .filter(s => isHourly(s.type) && Number.isFinite(s.rate) && s.rate > 0)
    .map(s => ({ date: s.date.slice(0, 10), rate: round(s.rate) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (paid.length === 0) return { currentRate: null, lastChangeOn: null, previousRate: null, changes: [] };

  const seen = new Set<number>();
  const changes: PayHistory["changes"] = [];
  let last = paid[0].rate;
  for (const s of paid) {
    if (!seen.has(s.rate) && seen.size > 0) changes.push({ date: s.date, from: last, to: s.rate });
    seen.add(s.rate);
    last = s.rate;
  }
  const currentRate = paid[paid.length - 1].rate;
  const firstOfCurrent = paid.find(s => s.rate === currentRate)!.date;
  const before = paid.filter(s => s.date < firstOfCurrent && s.rate !== currentRate);
  if (before.length === 0) return { currentRate, lastChangeOn: null, previousRate: null, changes };
  const windowStart = new Date(Date.parse(`${firstOfCurrent}T12:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
  const recent = before.filter(s => s.date >= windowStart);
  const pool = recent.length ? recent : before;
  const counts = new Map<number, number>();
  for (const s of pool) counts.set(s.rate, (counts.get(s.rate) ?? 0) + 1);
  const previousRate = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  return { currentRate, lastChangeOn: firstOfCurrent, previousRate, changes };
}
