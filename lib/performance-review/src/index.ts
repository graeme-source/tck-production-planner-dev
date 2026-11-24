/**
 * Performance pay review report — its shape and the analysis rules (Graeme,
 * 24 Nov 2026: "an automatic report that I can load up for any given person
 * at any given time" for the six-monthly performance pay reviews). Shared by
 * the server (which builds it) and the People page (which shows it), and
 * frozen as JSON when attached to a meeting. Pure.
 *
 * Rules that matter:
 *  - Only what the system actually records is reported. Where nothing is
 *    recorded, the report says "nothing recorded" — never "none" — because
 *    verbal conversations aren't in the system (Graeme: a report that "clearly
 *    said no disciplinarys" can be used against us later).
 *  - A figure is per person only where the data names the person (signed in
 *    at the station). Shared-crew totals are never passed off as one person's.
 */

export const REPORT_VERSION = 1;

/** The improvement score everyone aims for: one improvement every shift. */
export const IMPROVEMENT_TARGET_PCT = 100;

/** Active minutes a day needs before it gives a rate. */
export const MIN_RATE_MINUTES = 30;

/** One rate (building batches/hr, wrapping packs/hr, packing orders/hr). */
export interface RateStat {
  unit: string;
  /** Days with enough work to give a rate. */
  days: number;
  /** Their whole-period rate: total work ÷ total active time. */
  overall: number | null;
  /** Typical day, and their usual slow and fast day — the 10th and 90th
   *  percentile once there are 5+ days (one odd day, e.g. a batch logged
   *  in one go, doesn't set the range), else the plain lowest and highest. */
  median: number | null;
  min: number | null;
  max: number | null;
  total: number;
  activeMinutes: number;
  /** Everyone else on the same work over the same period. */
  teamOverall: number | null;
  standard: number | null;
  stretch: number | null;
  perDay: Array<{ date: string; amount: number; minutes: number; rate: number | null }>;
  /** How it's measured, in a sentence (and any caveat). */
  how: string;
}

export interface PerformanceReport {
  version: number;
  /** Sections left out of a saved copy (the screen hides them). */
  hiddenSections?: string[];
  person: { userId: number; name: string; jobTitle: string | null; plandayLinked: boolean };
  period: { from: string; to: string; lastReviewDate: string | null };
  generatedAt: string;

  improvements: {
    completed: number;
    credits: number;
    /** Improvement score over the period: credits ÷ days worked, as a % —
     *  the same rule as the daily score. Null when shifts aren't known. */
    scorePct?: number | null;
    daysWorked?: number | null;
    /** The team's score over the same period (all credits ÷ all days worked). */
    teamScorePct?: number | null;
    /**
     * Their CURRENT score — the last 30 days, exactly as the improvements
     * leaderboard shows it (same function: services/improvement-score.ts).
     * This is the headline (Graeme, 24 Nov 2026): a strong recent month
     * shouldn't be buried under a slow start to the period.
     */
    current?: {
      from: string;
      to: string;
      scorePct: number | null;
      credits: number;
      improvements: number;
      shifts: number | null;
      /** Average of the team's own current scores (leaderboard people with shifts). */
      teamAveragePct: number | null;
    } | null;
    /** Average completed improvements per active team member, same period. */
    teamAverage: number | null;
    shiftsKnown: boolean;
    monthly: Array<{ month: string; completed: number; credits: number; shifts: number | null; scorePct: number | null }>;
    list: Array<{ id: number; title: string; date: string; credits: number }>;
  };

  training: {
    stations: Array<{
      station: string;
      worksThere: boolean;
      sopCount: number;
      trained: number;
      refresher: number;
      untrained: number;
      missing: Array<{ sopId: number; title: string; status: "refresher" | "untrained" }>;
    }>;
    matrices: Array<{ matrixId: number; name: string; items: number; trained: number; missing: string[] }>;
  };

  lean: {
    weeksAssigned: number;
    weeksCompleted: number;
    completed: Array<{ weekStart: string; title: string | null; quiz: string | null }>;
    missed: Array<{ weekStart: string; title: string | null }>;
    selfPaced: number;
  };

  speed: { building: RateStat | null; wrapping: RateStat | null; packing: RateStat | null };

  /**
   * Checklists at the stations they were rostered on (Graeme, 24 Nov 2026):
   * an item left unticked — rather than ticked, or marked "can't do" with a
   * reason, which is the instruction — counts against everyone on that
   * station that day. Optional only so older saved reports still open.
   */
  checklists?: {
    known: boolean;
    /** (day, station) pairs they were rostered on a station with a checklist. */
    stationDays: number;
    /** Items left unticked on those days, and on how many days. */
    missed: number;
    missedDays: number;
    /** What they did themselves: ticked, and marked can't-do with a reason. */
    ticked: number;
    cantDo: number;
    byStation: Array<{ station: string; days: number; missed: number }>;
    missedList: Array<{ date: string; station: string; title: string; category: string }>;
  };

  attendance: {
    known: boolean;
    shiftsWorked: number;
    sickDays: number;
    sickInstances: number;
    lates: number;
    otherAbsence: number;
    attendancePct: number | null;
    /** Absence days behind attendancePct (so taking a spell out can recompute it). */
    absentDays?: number;
    sickSpells: Array<{ start: string; end: string; days: number }>;
    lateDates: string[];
    /** How late, per late day, from Planday's punch clock: clocked in vs the
     *  rostered start (Graeme, 24 Nov 2026). Optional — older saved reports
     *  don't have it, and it's empty when Planday can't be reached. */
    lateDetails?: Array<{ date: string; minutesLate: number | null; clockedIn: string | null; rostered: string | null }>;
  };

  records: {
    /** Disciplinary entries on the record in the period (stage when set). */
    disciplinary: RecordItem[];
    attendanceOrTimekeeping: RecordItem[];
    praise: RecordItem[];
    returnToWorkForms: number;
  };

  contributions: {
    factoryReports: number;
    appReports: number;
    sopsWritten: number;
    todos: { assigned: number; done: number; onTime: number; late: number; open: number };
  };

  /**
   * The notes on their record for the period (Graeme, 24 Nov 2026: "bring in
   * all of the notes that have happened since the last performance review").
   * Built per viewer with the record's own reading rule — private notes are
   * their author's alone — and a saved copy keeps only the ones already
   * shared with the person (forSavedCopy). Optional: older saved reports
   * don't have it.
   */
  notes?: {
    /** Their last performance appraisal before the end of the period. */
    lastReview: { entryId: number; date: string; title: string } | null;
    /** The objectives and agreements set at that appraisal, to go through. */
    fromLastReview: ReportNote[];
    /** Everything else written in the period (or on a meeting in it), newest first. */
    list: ReportNote[];
  };
}

/** One note from their employment record. */
export interface ReportNote {
  id: number;
  /** The meeting or entry it belongs to; null for a loose note. */
  entryId: number | null;
  entryTitle: string | null;
  entryDate: string | null;
  /** note | feedback | objective | agreement */
  kind: string;
  title: string | null;
  body: string;
  /** The day it was written. */
  date: string;
  /** Shared with them — on their own record. Only these go into a saved copy. */
  shared: boolean;
  /** Private, but the author let named HR colleagues read it. */
  sharedWithHr: boolean;
  author: string | null;
  dueDate: string | null;
  done: boolean;
}

export const NOTE_KIND_LABELS: Record<string, string> = { note: "Note", feedback: "Feedback", objective: "Objective", agreement: "What was agreed" };

export interface RecordItem { entryId: number; date: string; title: string; detail: string | null }

/** Sections that can be left out of a shared report as a whole. */
export const REPORT_SECTIONS = ["improvements", "training", "lean", "speed_building", "speed_wrapping", "speed_packing", "checklists", "attendance", "records", "contributions", "notes"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** What's been unticked: whole sections, and single items by key (itemKey). */
export interface Exclusions { sections: string[]; items: string[] }

export interface Suggestion {
  tone: "strength" | "focus";
  area: "improvements" | "training" | "lean" | "speed" | "checklists" | "attendance" | "records" | "contributions";
  headline: string;
  detail: string;
}

// ── Small maths ─────────────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Median of some numbers; null when there are none. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Linear-interpolated percentile (0–1) of some numbers. */
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0]!;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

/** A person's days of work → their rate summary. A day needs half an hour
 *  of active time to set a rate — a few minutes of taps isn't a pace, and
 *  gave silly highs and lows. */
export function rateStat(args: {
  unit: string;
  how: string;
  days: Array<{ date: string; amount: number; minutes: number }>;
  teamOverall: number | null;
  standard: number | null;
  stretch: number | null;
}): RateStat | null {
  const days = args.days.filter(d => d.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length === 0) return null;
  const perDay = days.map(d => ({ ...d, rate: d.minutes >= MIN_RATE_MINUTES ? round1(d.amount / (d.minutes / 60)) : null }));
  const rates = perDay.map(d => d.rate).filter((r): r is number => r != null);
  const total = days.reduce((s, d) => s + d.amount, 0);
  const activeMinutes = days.reduce((s, d) => s + d.minutes, 0);
  const counted = perDay.filter(d => d.rate != null);
  const cTotal = counted.reduce((s, d) => s + d.amount, 0);
  const cMin = counted.reduce((s, d) => s + d.minutes, 0);
  const med = median(rates);
  return {
    unit: args.unit,
    how: args.how,
    days: rates.length,
    overall: cMin > 0 ? round1(cTotal / (cMin / 60)) : null,
    median: med == null ? null : round1(med),
    min: rates.length ? round1(percentile(rates, rates.length >= 5 ? 0.1 : 0)) : null,
    max: rates.length ? round1(percentile(rates, rates.length >= 5 ? 0.9 : 1)) : null,
    total: round1(total),
    activeMinutes: Math.round(activeMinutes),
    teamOverall: args.teamOverall == null ? null : round1(args.teamOverall),
    standard: args.standard,
    stretch: args.stretch,
    perDay,
  };
}

/** Worked shifts ÷ (worked + absence shifts), whole %. Holiday isn't absence. */
export function attendancePct(worked: number, absent: number): number | null {
  const all = worked + absent;
  return all > 0 ? Math.round((worked / all) * 100) : null;
}

/** "Since 24 May" style default: the last review if within a year, else 6 months back. */
export function defaultPeriod(today: string, lastReviewDate: string | null): { from: string; to: string } {
  const sixBack = shiftMonths(today, -6);
  const yearBack = shiftMonths(today, -12);
  const from = lastReviewDate && lastReviewDate >= yearBack && lastReviewDate < today ? lastReviewDate : sixBack;
  return { from, to: today };
}

export function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

// ── Suggestions ─────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the data says to talk about: strengths to recognise and areas to set
 * objectives on. Rules, not guesses — every line points at a figure in the
 * report, so it can be checked. Attendance and records are worded neutrally
 * (they're conversations, not verdicts) and never claim something didn't
 * happen.
 */
export function suggestions(r: PerformanceReport): Suggestion[] {
  const out: Suggestion[] = [];

  // Improvements — the aim is a score of 100%: one improvement for every
  // shift worked (Graeme, 24 Nov 2026). Judged on the CURRENT score (last
  // 30 days, as on the leaderboard); the period score if that's missing;
  // otherwise on the count against the team.
  const imp = r.improvements;
  const cur = imp.current?.scorePct != null ? imp.current : null;
  const score = cur ? cur.scorePct! : imp.scorePct ?? null;
  if (score != null) {
    const when = cur ? "current score (last 30 days)" : "score over the period";
    const extra = cur && imp.scorePct != null ? ` Over the whole period: ${imp.scorePct}%.` : "";
    if (score >= IMPROVEMENT_TARGET_PCT) {
      out.push({ tone: "strength", area: "improvements", headline: `Improvement ${when}: ${score}% — at or above the 100% aim`, detail: `${cur ? `${plural(cur.improvements, "improvement")} in the last 30 days.` : `${plural(imp.completed, "improvement")} this period.`}${extra}` });
    } else {
      out.push({ tone: "focus", area: "improvements", headline: `Improvement ${when}: ${score}% — the aim is 100%`, detail: `${cur ? `${plural(cur.improvements, "improvement")} over ${plural(cur.shifts ?? 0, "shift")} in the last 30 days${cur.teamAveragePct != null ? ` (team average ${cur.teamAveragePct}%)` : ""}.` : `${plural(imp.completed, "improvement")} this period.`}${extra} Objective: one improvement every shift — leave every station better than you found it.` });
    }
  } else if (imp.teamAverage != null && imp.teamAverage > 0 && imp.completed < imp.teamAverage) {
    out.push({ tone: "focus", area: "improvements", headline: imp.completed === 0 ? "No improvements completed this period" : `Fewer improvements than most — ${imp.completed}`, detail: `The team averaged ${round1(imp.teamAverage)}. Objective: one improvement every shift — leave every station better than you found it.` });
  }

  // Training
  const gaps = r.training.stations.filter(s => s.worksThere && s.untrained + s.refresher > 0);
  if (gaps.length > 0) {
    const n = gaps.reduce((s, g) => s + g.untrained + g.refresher, 0);
    out.push({ tone: "focus", area: "training", headline: `${plural(n, "SOP")} to train or refresh where they work`, detail: `At ${gaps.map(g => g.station).join(", ")}. Objective idea: be signed off on every SOP at their own stations by the next review.` });
  } else if (r.training.stations.some(s => s.worksThere && s.sopCount > 0)) {
    out.push({ tone: "strength", area: "training", headline: "Trained on every SOP at their stations", detail: "No untrained or out-of-date SOPs where they work." });
  }
  const matrixGaps = r.training.matrices.filter(m => m.missing.length > 0);
  if (matrixGaps.length > 0) {
    out.push({ tone: "focus", area: "training", headline: `Training matrix items still to do`, detail: matrixGaps.map(m => `${m.name}: ${m.missing.length} left`).join("; ") + "." });
  }

  // Lean curriculum
  const l = r.lean;
  if (l.weeksAssigned > 0) {
    const pct = Math.round((l.weeksCompleted / l.weeksAssigned) * 100);
    if (pct >= 90) out.push({ tone: "strength", area: "lean", headline: `Lean curriculum: ${l.weeksCompleted} of ${l.weeksAssigned} weeks done`, detail: "Keeping up with the weekly lessons." });
    else out.push({ tone: "focus", area: "lean", headline: `Lean curriculum: ${l.weeksCompleted} of ${l.weeksAssigned} weeks done (${pct}%)`, detail: `${plural(l.missed.length, "week")} missed. Objective idea: complete every weekly lesson review by Friday${l.missed.length > 0 ? ", and catch up the missed weeks self-paced" : ""}.` });
  }

  // Speed
  for (const [key, label] of [["building", "Building"], ["wrapping", "Wrapping"], ["packing", "Packing"]] as const) {
    const s = r.speed[key];
    if (!s || s.overall == null || s.days < 3) continue;
    const vs = s.standard ?? s.teamOverall;
    if (vs == null || vs <= 0) continue;
    const ratio = s.overall / vs;
    const against = s.standard != null ? `the standard of ${s.standard}` : `the team's ${s.teamOverall}`;
    if (ratio >= 1.05) out.push({ tone: "strength", area: "speed", headline: `${label}: ${s.overall} ${s.unit}`, detail: `Above ${against} over ${plural(s.days, "day")}.` });
    else if (ratio < 0.9) out.push({ tone: "focus", area: "speed", headline: `${label}: ${s.overall} ${s.unit}`, detail: `Below ${against} over ${plural(s.days, "day")} (range ${s.min}–${s.max}). Objective idea: reach ${vs} ${s.unit}, checked on the station KPI strip.` });

  }

  // Checklists — unticked items on days they were on the station.
  const cl = r.checklists;
  if (cl && cl.known && cl.stationDays > 0) {
    if (cl.missed > 0) {
      out.push({ tone: "focus", area: "checklists", headline: `Checklist items left unticked — ${plural(cl.missed, "item")} on ${plural(cl.missedDays, "day")}`, detail: `On days they were on the station. The rule: tick every item, or mark it "can't do" with a reason — never leave it blank. Objective idea: no blank checklist items by the next review.` });
    } else if (cl.stationDays >= 10) {
      out.push({ tone: "strength", area: "checklists", headline: "Checklists complete", detail: `No items left unticked across ${plural(cl.stationDays, "station day")}.` });
    }
  }

  // Attendance — neutral wording; these are conversations.
  const a = r.attendance;
  if (a.known) {
    if (a.sickInstances >= 3 || a.lates >= 4) {
      out.push({ tone: "focus", area: "attendance", headline: "Attendance to talk about", detail: `${plural(a.sickInstances, "sickness absence")} (${plural(a.sickDays, "day")}) and ${plural(a.lates, "late")} recorded in Planday this period.` });
    } else if (a.attendancePct != null && a.attendancePct >= 98 && a.lates === 0 && a.shiftsWorked >= 20) {
      out.push({ tone: "strength", area: "attendance", headline: `Reliable attendance — ${a.attendancePct}%`, detail: "No lates recorded in Planday this period." });
    }
  }

  // Records — only what's recorded.
  if (r.records.praise.length > 0) {
    out.push({ tone: "strength", area: "records", headline: `${plural(r.records.praise.length, "praise entry", "praise entries")} on their record`, detail: r.records.praise.map(p => p.title).join("; ") + "." });
  }

  // Contributions
  const c = r.contributions;
  if (c.factoryReports + c.appReports >= 3) {
    out.push({ tone: "strength", area: "contributions", headline: `Raises problems — ${plural(c.factoryReports + c.appReports, "report")}`, detail: "Spotting and reporting problems is exactly the behaviour we want." });
  }
  if (c.sopsWritten > 0) {
    out.push({ tone: "strength", area: "contributions", headline: `Wrote ${plural(c.sopsWritten, "SOP")}`, detail: "Capturing the standard for everyone." });
  }
  if (c.todos.assigned >= 5) {
    const onTimePct = c.todos.done > 0 ? Math.round((c.todos.onTime / c.todos.done) * 100) : 0;
    if (c.todos.open > 3 || (c.todos.done >= 5 && onTimePct < 60)) {
      out.push({ tone: "focus", area: "contributions", headline: "To-dos slipping", detail: `${c.todos.open} still open; ${onTimePct}% of finished ones done by their due date.` });
    }
  }

  return out;
}

// ── Checklists ──────────────────────────────────────────────────────────

/**
 * Items left unticked at the stations someone was rostered on, day by day.
 * A rostered station covers its own checklist and the shared one it reads
 * (`resolve`: building_2 → building_1, prep_meat → prep) — never the other
 * way, so Building 2's own items don't count against a Building 1 builder.
 * Shared responsibility: an unticked item counts for everyone on that
 * station that day.
 */
export function attributeChecklistMisses(args: {
  known: boolean;
  from: string;
  to: string;
  stationDays: ReadonlyMap<string, ReadonlySet<string>>;
  templateStations: ReadonlySet<string>;
  resolve: (station: string) => string;
  missing: ReadonlyArray<{ planDate: string; stationType: string; title: string; category: string }>;
  ticked: number;
  cantDo: number;
}): NonNullable<PerformanceReport["checklists"]> {
  const { from, to, resolve } = args;
  const covers = (station: string) => [...new Set([station, resolve(station)])].filter(st => args.templateStations.has(st));
  const onDay = new Map<string, Set<string>>();
  for (const [day, set] of args.stationDays) {
    if (day < from || day > to) continue;
    const cs = new Set<string>();
    for (const st of set) for (const t of covers(st)) cs.add(t);
    if (cs.size > 0) onDay.set(day, cs);
  }
  const byStation = new Map<string, { station: string; days: number; missed: number }>();
  const seen = new Set<string>();
  for (const [day, set] of onDay) for (const t of set) {
    const name = resolve(t);
    if (seen.has(`${day}|${name}`)) continue;
    seen.add(`${day}|${name}`);
    const b = byStation.get(name) ?? { station: name, days: 0, missed: 0 };
    b.days++;
    byStation.set(name, b);
  }
  const missedList: Array<{ date: string; station: string; title: string; category: string }> = [];
  const missedDays = new Set<string>();
  for (const m of args.missing) {
    if (!onDay.get(m.planDate)?.has(m.stationType)) continue;
    const name = resolve(m.stationType);
    missedList.push({ date: m.planDate, station: name, title: m.title, category: m.category });
    missedDays.add(m.planDate);
    byStation.get(name)!.missed++;
  }
  missedList.sort((a, b) => b.date.localeCompare(a.date) || a.station.localeCompare(b.station));
  return {
    known: args.known && onDay.size > 0,
    stationDays: seen.size,
    missed: missedList.length,
    missedDays: missedDays.size,
    ticked: args.ticked,
    cantDo: args.cantDo,
    byStation: [...byStation.values()].sort((a, b) => b.missed - a.missed || b.days - a.days),
    missedList: missedList.slice(0, 200),
  };
}

// ── Lateness ────────────────────────────────────────────────────────────

/** "2026-11-02T07:04:00" (Planday's local date-time) → minutes since midnight
 *  plus the date, compared as written — both times are in the same zone. */
function localParts(dt: string | null | undefined): { date: string; minutes: number; hhmm: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(dt ?? "");
  if (!m) return null;
  return { date: m[1]!, minutes: Number(m[2]) * 60 + Number(m[3]), hhmm: `${m[2]}:${m[3]}` };
}

/** How late one punch-in was against its rostered start; 0 when on time or
 *  early; null when either time is missing. */
export function minutesLate(punch: { startDateTime?: string | null; shiftStartDateTime?: string | null }): { minutes: number | null; clockedIn: string | null; rostered: string | null } {
  const inAt = localParts(punch.startDateTime);
  const due = localParts(punch.shiftStartDateTime);
  if (!inAt || !due) return { minutes: null, clockedIn: inAt?.hhmm ?? null, rostered: due?.hhmm ?? null };
  const dayGap = inAt.date === due.date ? 0 : (Date.parse(`${inAt.date}T00:00:00Z`) - Date.parse(`${due.date}T00:00:00Z`)) / 60000;
  return { minutes: Math.max(0, Math.round(dayGap + inAt.minutes - due.minutes)), clockedIn: inAt.hhmm, rostered: due.hhmm };
}

/** A Planday local time ("2026-11-19T08:49", London) as epoch ms. */
export function londonLocalToMs(local: string): number {
  const guess = Date.parse(`${local.slice(0, 16)}:00Z`);
  if (Number.isNaN(guess)) return NaN;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(guess));
  const v = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"));
  return guess - (asUtc - guess);
}

/**
 * The start time the shift was ROSTERED for when they clocked in (Graeme,
 * 24 Nov 2026): approving a late shift moves its start to the punch-in (7:05,
 * because that's what's paid), so the shift's current start says they were
 * on time. Planday's shift history keeps every edit as text — "Start time
 * changed from 07:00 to 07:05." — so the start as it stood at punch-in is the
 * "from" of the first start-time change made AFTER they clocked in. Changes
 * made before (an agreed later start that morning, a rota change last week)
 * are what they were due to work. No change after → the current start.
 * Checked against live shifts 24 Nov 2026. Returns "HH:MM" or null.
 */
export function rosteredStartFromHistory(
  history: ReadonlyArray<{ modifiedAt: string; changes?: readonly string[] | null }>,
  /** Their punch-in, Planday local time ("2026-11-19T08:49"). */
  punchInLocal: string,
  currentStart: string | null,
): string | null {
  const re = /Start time changed from (\d{1,2}:\d{2}) to (\d{1,2}:\d{2})/i;
  const punchedAt = londonLocalToMs(punchInLocal);
  if (Number.isNaN(punchedAt)) return currentStart;
  const after = [...history]
    .filter(h => Date.parse(h.modifiedAt) > punchedAt)
    .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));
  for (const h of after) {
    for (const c of h.changes ?? []) {
      const m = re.exec(c);
      if (m) return m[1]!.padStart(5, "0");
    }
  }
  return currentStart;
}

/** Minutes between a punch-in "HH:MM" and the rostered "HH:MM" (0 when on time or early). */
export function minutesLateAgainst(clockedIn: string | null, rostered: string | null): number | null {
  const mins = (t: string | null) => (t && /^\d{1,2}:\d{2}$/.test(t) ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]) : null);
  const a = mins(clockedIn), b = mins(rostered);
  return a == null || b == null ? null : Math.max(0, a - b);
}

// ── Leaving things out (Graeme, 24 Nov 2026) ────────────────────────────
// "The option to not include certain items that I feel were inaccurate …
// untick them from inclusion whilst I'm going through it with them."

/** The key a single item is unticked by. */
export const itemKey = {
  checklist: (m: { date: string; station: string; title: string }) => `cl:${m.date}|${m.station}|${m.title}`,
  late: (date: string) => `late:${date}`,
  sick: (start: string) => `sick:${start}`,
  leanWeek: (weekStart: string) => `lean:${weekStart}`,
  sop: (station: string, sopId: number) => `sop:${station}:${sopId}`,
  record: (entryId: number) => `rec:${entryId}`,
  note: (noteId: number) => `note:${noteId}`,
};

/**
 * The report with what's been unticked taken out and the figures redone:
 * a checklist miss, a late or a sickness spell comes off the counts; a
 * missed Lean week comes off the weeks set; an SOP shown as untrained counts
 * as trained (it's unticked because they are); a record entry is dropped.
 * Whole sections are listed in hiddenSections. Pure — the screen shows it
 * live and the server applies the same thing to the saved copy.
 */
export function applyExclusions(report: PerformanceReport, ex: Exclusions | null | undefined): PerformanceReport {
  if (!ex || (ex.sections.length === 0 && ex.items.length === 0)) return report;
  const out: PerformanceReport = JSON.parse(JSON.stringify(report));
  const drop = new Set(ex.items);
  out.hiddenSections = [...new Set([...(report.hiddenSections ?? []), ...ex.sections.filter(x => (REPORT_SECTIONS as readonly string[]).includes(x))])];

  // Checklists
  if (out.checklists) {
    const c = out.checklists;
    const kept = c.missedList.filter(m => !drop.has(itemKey.checklist(m)));
    if (kept.length !== c.missedList.length) {
      c.missedList = kept;
      c.missed = kept.length;
      c.missedDays = new Set(kept.map(m => m.date)).size;
      for (const b of c.byStation) b.missed = kept.filter(m => m.station === b.station).length;
    }
  }

  // Attendance: lates and sickness spells
  const a = out.attendance;
  if (a.lateDates.some(d => drop.has(itemKey.late(d)))) {
    a.lateDates = a.lateDates.filter(d => !drop.has(itemKey.late(d)));
    if (a.lateDetails) a.lateDetails = a.lateDetails.filter(l => !drop.has(itemKey.late(l.date)));
    a.lates = a.lateDates.length;
  }
  const goneSpells = a.sickSpells.filter(sp => drop.has(itemKey.sick(sp.start)));
  if (goneSpells.length > 0) {
    a.sickSpells = a.sickSpells.filter(sp => !drop.has(itemKey.sick(sp.start)));
    const goneDays = goneSpells.reduce((n, sp) => n + sp.days, 0);
    a.sickDays = Math.max(0, a.sickDays - goneDays);
    a.sickInstances = Math.max(0, a.sickInstances - goneSpells.length);
    if (a.absentDays != null) {
      a.absentDays = Math.max(0, a.absentDays - goneDays);
      a.attendancePct = attendancePct(a.shiftsWorked, a.absentDays);
    }
  }

  // Lean: a missed week taken out isn't counted as set
  const goneWeeks = out.lean.missed.filter(w => drop.has(itemKey.leanWeek(w.weekStart)));
  if (goneWeeks.length > 0) {
    out.lean.missed = out.lean.missed.filter(w => !drop.has(itemKey.leanWeek(w.weekStart)));
    out.lean.weeksAssigned = Math.max(out.lean.weeksCompleted, out.lean.weeksAssigned - goneWeeks.length);
  }

  // Training: an SOP unticked as "not trained" counts as trained
  for (const st of out.training.stations) {
    const gone = st.missing.filter(m => drop.has(itemKey.sop(st.station, m.sopId)));
    if (gone.length === 0) continue;
    st.missing = st.missing.filter(m => !drop.has(itemKey.sop(st.station, m.sopId)));
    for (const g of gone) { st[g.status] = Math.max(0, st[g.status] - 1); st.trained++; }
  }

  // Records
  const keep = (xs: RecordItem[]) => xs.filter(i => !drop.has(itemKey.record(i.entryId)));
  out.records.disciplinary = keep(out.records.disciplinary);
  out.records.attendanceOrTimekeeping = keep(out.records.attendanceOrTimekeeping);
  out.records.praise = keep(out.records.praise);

  // Notes
  if (out.notes) {
    out.notes.fromLastReview = out.notes.fromLastReview.filter(n => !drop.has(itemKey.note(n.id)));
    out.notes.list = out.notes.list.filter(n => !drop.has(itemKey.note(n.id)));
  }
  return out;
}

/**
 * What a saved copy may hold of the notes: only those already shared with
 * the person. A saved copy can be opened by anyone with People access and,
 * once shared, by the person — so a private note (its author's alone) must
 * never be frozen into one. Notes on the meeting the copy is attached to are
 * left out too: the copy shows that meeting's write-up live, under its own
 * sharing, so it isn't there twice. Pure.
 */
export function forSavedCopy(report: PerformanceReport, attachedEntryId: number | null): PerformanceReport {
  if (!report.notes) return report;
  const keep = (n: ReportNote) => n.shared && (attachedEntryId == null || n.entryId !== attachedEntryId);
  return {
    ...report,
    notes: {
      ...report.notes,
      fromLastReview: report.notes.fromLastReview.filter(keep).map(n => ({ ...n, sharedWithHr: false })),
      list: report.notes.list.filter(keep).map(n => ({ ...n, sharedWithHr: false })),
    },
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-29" → "29 Oct 2026" */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

/** A note's own title, or null when it only repeats its kind ("What was agreed"). */
export function noteTitle(n: Pick<ReportNote, "kind" | "title">): string | null {
  const t = n.title?.trim();
  return t && t.toLowerCase() !== (NOTE_KIND_LABELS[n.kind] ?? "").toLowerCase() ? t : null;
}

/** A note as plain text, for copying into prep notes. */
export function noteAsText(n: ReportNote): string {
  const where = n.entryTitle ? ` — ${n.entryTitle}` : "";
  const title = noteTitle(n);
  const head = `${NOTE_KIND_LABELS[n.kind] ?? "Note"} (${dayLabel(n.date)}${where})${title ? `: ${title}` : ""}`;
  return `${head}\n${n.body.trim()}`;
}
