/**
 * Statutory Sick Pay — an ESTIMATE for the accountant to check (Graeme,
 * 2026-10-27: "we've got the breakdown of what the sick pay should be in the
 * first instance, rather than having to do a calculation ourselves").
 * Pure: no database, no Planday. Objective I.
 *
 * The rules since 6 April 2026 (Employment Rights Act 2025):
 *   - paid from the FIRST qualifying day off sick — no waiting days, and a
 *     single day's sickness is enough;
 *   - no lower earnings limit;
 *   - weekly SSP = the lower of the flat rate (£123.25 for 2026/27) and 80%
 *     of average weekly earnings (AWE);
 *   - a day's SSP = weekly SSP ÷ the qualifying days in that week;
 *   - spells of sickness 56 days or less apart LINK into one: AWE is taken
 *     once, at the start of the first spell, and the 28-week maximum runs
 *     across all of them;
 *   - a linked run that began before 6 April 2026 keeps the old rules
 *     (waiting days, 4-day spells) — not estimated here.
 *
 * Where this simplifies, so the accountant checks it:
 *   - every recorded sick day counts as a qualifying day (Planday sickness
 *     is booked on days the person would have worked), up to the person's
 *     qualifying days in any one week (Sunday–Saturday);
 *   - qualifying days a week = the contract's days a week, else the days
 *     actually worked a week over the 8 weeks before;
 *   - AWE = pay EARNED in the 8 weeks before the run began (HMRC uses pay
 *     PAID in that period — close for weekly pay, can differ for monthly);
 *     someone employed less than 8 weeks is averaged over the weeks worked.
 */

/** Flat weekly rate by tax year, newest last. Add each April's rate here. */
export const SSP_RATES: ReadonlyArray<{ from: string; weekly: number }> = [
  { from: "2026-04-06", weekly: 123.25 },
];
export const SSP_NEW_RULES_FROM = "2026-04-06";
/** Spells this many days apart or fewer (start minus last day) link. */
const LINK_GAP_DAYS = 57;
const MAX_WEEKS = 28;

const DAY_MS = 86_400_000;
const toDays = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const fromDays = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDaysIso = (iso: string, n: number) => fromDays(toDays(iso) + n);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** "20/10/2026" for the notes. */
const uk = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function sspWeeklyRate(date: string): number | null {
  let rate: number | null = null;
  for (const r of SSP_RATES) if (r.from <= date) rate = r.weekly;
  return rate;
}

/** The first day of the linked run of sickness that `date` belongs to. */
export function linkedRunStart(sickDates: readonly string[], date: string): string {
  const sorted = [...new Set(sickDates)].filter(d => d <= date).sort();
  let start = date;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : date;
    if (toDays(next) - toDays(sorted[i]) > LINK_GAP_DAYS) break;
    start = sorted[i];
  }
  return start;
}

/** Sunday of the SSP week (Sunday–Saturday) a date falls in. */
function weekOf(date: string): number {
  const d = toDays(date);
  const dow = new Date(d * DAY_MS).getUTCDay(); // 0 = Sunday
  return d - dow;
}

export interface SspPersonInput {
  /** Sick days inside the pay period. */
  sickDates: string[];
  /** Sick days before the period (as far back as was looked). */
  earlierSickDates: string[];
  /** How far back sickness was looked for. */
  lookbackFrom: string;
  /** Pay per shift, for AWE; any range covering the 8 weeks before. */
  pay: Array<{ date: string; pay: number }>;
  contractDaysPerWeek: number | null;
}

export interface SspDay { date: string; amount: number | null }

export interface SspEstimate {
  days: SspDay[];
  /** Σ the days with an amount. */
  total: number;
  /** Per run (normally one): what it was worked out from. */
  awe: number | null;
  weeklySsp: number | null;
  qualifyingDaysPerWeek: number | null;
  /** Why something couldn't be estimated, or needs checking. */
  notes: string[];
}

export function estimateSsp(p: SspPersonInput): SspEstimate {
  const notes: string[] = [];
  const all = [...new Set([...p.earlierSickDates, ...p.sickDates])].sort();
  const inPeriod = [...new Set(p.sickDates)].sort();
  const days: SspDay[] = [];
  let lastRun: { awe: number | null; weekly: number | null; qdays: number | null } = { awe: null, weekly: null, qdays: null };

  // Group the period's days by the run they belong to.
  const runs = new Map<string, string[]>();
  for (const d of inPeriod) {
    const start = linkedRunStart(all, d);
    runs.set(start, [...(runs.get(start) ?? []), d]);
  }

  for (const [start, runDays] of runs) {
    const runAll = all.filter(d => d >= start && d <= runDays[runDays.length - 1]);
    if (start < SSP_NEW_RULES_FROM) {
      notes.push(`Sickness running since ${uk(start)} began before 6 April 2026, so the old SSP rules apply — work it out by hand.`);
      for (const d of runDays) days.push({ date: d, amount: null });
      continue;
    }
    if (toDays(start) - toDays(p.lookbackFrom) <= LINK_GAP_DAYS) {
      notes.push(`This sickness may link back to sickness before ${uk(p.lookbackFrom)} — check the 28-week limit.`);
    }

    // AWE over the 8 weeks before the run began.
    const winFrom = addDaysIso(start, -56);
    const inWindow = p.pay.filter(x => x.date >= winFrom && x.date < start);
    const earned = inWindow.reduce((n, x) => n + x.pay, 0);
    const firstPaid = [...p.pay].map(x => x.date).sort()[0];
    let weeks = 8;
    if (firstPaid && firstPaid > winFrom && firstPaid < start) weeks = Math.max(1, (toDays(start) - toDays(firstPaid)) / 7);
    const awe = inWindow.length > 0 ? earned / weeks : null;

    const workedDays = new Set(inWindow.map(x => x.date)).size;
    const qdays = p.contractDaysPerWeek != null
      ? Math.min(7, Math.max(1, Math.round(p.contractDaysPerWeek)))
      : workedDays > 0 ? Math.min(7, Math.max(1, Math.round(workedDays / weeks))) : null;

    if (awe == null) notes.push(`No pay in the 8 weeks before ${uk(start)}, so average earnings can't be worked out — work it out by hand.`);
    if (qdays == null) notes.push("No usual working days to divide the weekly rate by — work it out by hand.");
    if (awe == null || qdays == null) {
      for (const d of runDays) days.push({ date: d, amount: null });
      lastRun = { awe, weekly: null, qdays };
      continue;
    }

    // Walk the whole run in order: earlier days use up the 28 weeks and the
    // week's qualifying days too; only the period's days are paid here.
    const maxDays = MAX_WEEKS * qdays;
    let used = 0;
    const perWeek = new Map<number, number>();
    const runWeekly = Math.min(sspWeeklyRate(start) ?? 0, 0.8 * awe);
    const periodSet = new Set(runDays);
    let capped = false;
    for (const d of runAll) {
      const wk = weekOf(d);
      const n = perWeek.get(wk) ?? 0;
      const qualifying = n < qdays;
      if (qualifying) perWeek.set(wk, n + 1);
      const paid = qualifying && used < maxDays;
      if (qualifying && !paid) capped = true;
      if (paid) used++;
      if (!periodSet.has(d)) continue;
      const weekly = Math.min(sspWeeklyRate(d) ?? 0, 0.8 * awe);
      days.push({ date: d, amount: paid ? round2(weekly / qdays) : 0 });
    }
    if (capped) notes.push("Reached the 28-week SSP limit — no more SSP is due for this sickness.");
    lastRun = { awe: round2(awe), weekly: round2(runWeekly), qdays };
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return {
    days,
    total: round2(days.reduce((n, d) => n + (d.amount ?? 0), 0)),
    awe: lastRun.awe,
    weeklySsp: lastRun.weekly,
    qualifyingDaysPerWeek: lastRun.qdays,
    notes,
  };
}
