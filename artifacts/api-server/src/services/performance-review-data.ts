/**
 * Builds one person's performance pay review report for a period (Graeme,
 * 24 Nov 2026). Each section reads the records the app already keeps; the
 * shape and the analysis rules live in @workspace/performance-review.
 *
 * Per-person only where the data names the person:
 *  - building: batch completions signed in at the building tablet (admin
 *    corrections and mac cheese left out), the run-rate break rule per day;
 *  - wrapping: wraps logged by that person (fridge_stock_changes), per day;
 *  - packing: orders whose label that person verified at the bench (APC),
 *    per day — the best per-person packing record there is;
 *  - attendance: their Planday shifts (mirror), so nothing when unlinked.
 */
import { sql } from "drizzle-orm";
import { db, visibleNotes, type ReviewViewer } from "@workspace/db";
import {
  REPORT_VERSION, MIN_RATE_MINUTES, roomSummary, attendancePct, attributeChecklistMisses, minutesLate, minutesLateAgainst, rosteredStartFromHistory, rateStat, type PerformanceReport, type RecordItem, type ReportNote,
} from "@workspace/performance-review";
import { CREDIT_PAIRS } from "../lib/improvement-credits-data";
import { improvementScorePct } from "../lib/improvement-score";
import { loadImprovementScores } from "./improvement-score";
import { londonDateString } from "../lib/london-time";
import { loadClassifiedShifts } from "../lib/rtw-detect";
import { isWorkedShift } from "../lib/absence-spells";
import { isLateName, isSickName, countSickInstances, sickRuns } from "./attendance-classify";
import { computeBatchesPerHour } from "../lib/run-rate";
import { getStandardBreakConfig } from "../lib/batches-per-hour";
import { paceFromSubs } from "./wrapping-pace";
import { reviewStatus } from "../lib/station-sop-training";
import { latestReviews, stationSopMap, stationDaysWorked } from "../routes/station-training";
import { findMissingChecklistItems } from "../routes/checklists";
import { resolveChecklistStation } from "../lib/checklist-stations";
import { APPRAISAL_DATE_SQL, IS_APPRAISAL_SQL } from "../lib/last-appraisals";

const MAC_CHEESE_CATEGORY = "Macaroni Cheese";
const toDay = (v: Date | string) => londonDateString(v instanceof Date ? v : new Date(String(v).endsWith("Z") || /[+-]\d\d:?\d\d$/.test(String(v)) ? String(v) : `${v}Z`));
const iso = (v: Date | string | null) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** The date of their last performance appraisal (held or dated), before
 *  today. What counts: lib/last-appraisals.ts (shared with the People list). */
export async function lastAppraisalDate(userId: number, today: string): Promise<string | null> {
  const r = await db.execute<{ d: string | null }>(sql`
    SELECT MAX(${APPRAISAL_DATE_SQL})::text AS d
      FROM people_record_entries e
     WHERE e.user_id = ${userId}
       AND ${APPRAISAL_DATE_SQL} < ${today}::date
       AND ${IS_APPRAISAL_SQL}
  `);
  return r.rows?.[0]?.d ?? null;
}

/** Their last performance appraisal dated before `before` (not cancelled). */
export async function lastAppraisalEntry(userId: number, before: string): Promise<{ entryId: number; date: string; title: string } | null> {
  const r = await db.execute<{ id: number; d: string; title: string }>(sql`
    SELECT e.id, ${APPRAISAL_DATE_SQL}::text AS d, e.title
      FROM people_record_entries e
     WHERE e.user_id = ${userId}
       AND ${APPRAISAL_DATE_SQL} < ${before}::date
       AND ${IS_APPRAISAL_SQL}
     ORDER BY 2 DESC, e.id DESC LIMIT 1
  `);
  const row = r.rows?.[0];
  return row ? { entryId: Number(row.id), date: iso(row.d)!, title: row.title } : null;
}

/**
 * Who is reading the report — decides which notes it carries. Without one,
 * only notes already shared with the person (fail closed).
 */
export type ReportViewer = ReviewViewer;

export async function loadPerformanceReport(userId: number, from: string, to: string, viewer?: ReportViewer): Promise<PerformanceReport> {
  const today = londonDateString(new Date());
  const [person] = (await db.execute<{ id: number; name: string; job_title: string | null; planday_employee_id: number | null }>(sql`
    SELECT id, name, job_title, planday_employee_id FROM app_users WHERE id = ${userId}
  `)).rows ?? [];
  if (!person) throw new Error("Person not found");
  const plandayId = person.planday_employee_id != null ? Number(person.planday_employee_id) : null;

  const [lastReview, shiftsByUser, breaks, kpis, buildingStd] = await Promise.all([
    lastAppraisalDate(userId, today),
    plandayId != null ? loadClassifiedShifts([userId], from, { includeInactive: true }).catch(() => new Map()) : Promise.resolve(new Map()),
    getStandardBreakConfig(),
    db.execute<{ kpi: string; standard: string | null; stretch: string | null }>(sql`SELECT kpi, standard, stretch FROM production_kpis`)
      .catch(() => ({ rows: [] as Array<{ kpi: string; standard: string | null; stretch: string | null }> })),
    db.execute<{ target: string | null }>(sql`
      SELECT target_batches_per_hour::text AS target FROM timing_standards WHERE station_type IN ('building_1','building_2')
      ORDER BY (station_type = 'building_1') DESC LIMIT 1`).catch(() => ({ rows: [] as Array<{ target: string | null }> })),
  ]);
  const myShifts = ((shiftsByUser.get(userId) ?? []) as Array<{ date: string; typeName: string | null }>).filter(s => s.date <= to);
  const kpi = (k: string) => {
    const row = (kpis.rows ?? []).find(r => r.kpi === k);
    return { standard: row?.standard != null ? Number(row.standard) : null, stretch: row?.stretch != null ? Number(row.stretch) : null };
  };

  const stationDays = plandayId != null
    ? await stationDaysWorked(plandayId, from, to).catch(() => new Map<string, Set<string>>())
    : new Map<string, Set<string>>();
  const [improvements, training, lean, speed, records, contributions, checklists, notes] = await Promise.all([
    loadImprovements(userId, from, to, myShifts, plandayId != null),
    loadTraining(userId, stationDays),
    loadLean(userId, from, to, today),
    loadSpeed(userId, from, to, breaks, kpi, buildingStd.rows?.[0]?.target != null ? Number(buildingStd.rows[0].target) : null),
    loadRecords(userId, from, to),
    loadContributions(userId, from, to),
    loadChecklists(userId, from, to, stationDays, plandayId != null),
    loadNotes(userId, from, to, viewer),
  ]);

  const room = plandayId != null ? await loadRoomForPerson(plandayId, from, to).catch(err => {
    console.error("[performance-review] room score failed:", err instanceof Error ? err.message : err);
    return null;
  }) : null;

  const attendance = attendanceFrom(myShifts, plandayId != null);
  if (plandayId != null && attendance.lateDates.length > 0) attendance.lateDetails = await lateDetails(plandayId, attendance.lateDates);

  return {
    version: REPORT_VERSION,
    person: { userId, name: person.name.trim(), jobTitle: person.job_title, plandayLinked: plandayId != null },
    period: { from, to, lastReviewDate: lastReview },
    generatedAt: new Date().toISOString(),
    improvements,
    training,
    lean,
    speed,
    room,
    checklists,
    attendance,
    records,
    contributions,
    notes,
  };
}

// ── Improvements ────────────────────────────────────────────────────────

async function loadImprovements(userId: number, from: string, to: string, shifts: Array<{ date: string; typeName: string | null }>, shiftsKnown: boolean): Promise<PerformanceReport["improvements"]> {
  const rows = (await db.execute<{ id: number; title: string; credit_weight: number; done: string; user_id: number }>(sql`
    WITH pairs AS (${CREDIT_PAIRS})
    SELECT s.id, s.title, s.credit_weight, COALESCE(s.done_at, s.approved_at, s.created_at)::text AS done, p.user_id
      FROM pairs p JOIN improvement_submissions s ON s.id = p.improvement_id
     WHERE s.progress_status = 'complete'
       AND COALESCE(s.done_at, s.approved_at, s.created_at) >= ${from}::date - INTERVAL '1 day'
       AND COALESCE(s.done_at, s.approved_at, s.created_at) < ${to}::date + INTERVAL '2 days'
  `)).rows ?? [];
  const inRange = rows.map(r => ({ ...r, day: toDay(r.done) })).filter(r => r.day >= from && r.day <= to);
  const mine = inRange.filter(r => Number(r.user_id) === userId);

  // Team: active colleagues who worked a shift in the period (Planday).
  const team = (await db.execute<{ id: number }>(sql`
    SELECT DISTINCT u.id FROM app_users u JOIN planday_shifts_cache s ON s.employee_id = u.planday_employee_id
     WHERE u.is_active AND s.date BETWEEN ${from} AND ${to}
  `).catch(() => ({ rows: [] as Array<{ id: number }> }))).rows ?? [];
  const teamIds = new Set(team.map(t => Number(t.id)));
  const teamRows = inRange.filter(r => teamIds.has(Number(r.user_id)));
  const teamAverage = teamIds.size > 0 ? teamRows.length / teamIds.size : null;
  // Team score: every team member's credits ÷ every team member's days worked.
  let teamScorePct: number | null = null;
  if (shiftsKnown && teamIds.size > 0) {
    const teamShifts = await loadClassifiedShifts([...teamIds], from).catch(() => new Map<number, Array<{ date: string; typeName: string | null }>>());
    let days = 0;
    for (const list of teamShifts.values()) days += new Set(list.filter(x => x.date <= to && isWorkedShift(x)).map(x => x.date)).size;
    const credits = teamRows.reduce((n, r) => n + Number(r.credit_weight || 1), 0);
    teamScorePct = days > 0 ? improvementScorePct(credits, days) : null;
  }

  const worked = shifts.filter(isWorkedShift);
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  }
  const monthly = months.map(month => {
    const done = mine.filter(r => r.day.startsWith(month));
    const credits = done.reduce((s, r) => s + Number(r.credit_weight || 1), 0);
    const shiftDays = shiftsKnown ? new Set(worked.filter(s => s.date.startsWith(month)).map(s => s.date)).size : null;
    return { month, completed: done.length, credits, shifts: shiftDays, scorePct: shiftDays != null ? improvementScorePct(credits, shiftDays) : null };
  });

  // Their current score — the leaderboard's own calculation, so the two
  // always match (rolling 30 London days to today).
  let current: NonNullable<PerformanceReport["improvements"]["current"]> | null = null;
  try {
    const sc = await loadImprovementScores([userId, ...teamIds]);
    const me = sc.byUser.get(userId);
    const teamScores = [...teamIds].filter(id => id !== userId).map(id => sc.byUser.get(id)?.scorePct).filter((x): x is number => x != null);
    current = {
      from: sc.window.from, to: sc.window.to,
      scorePct: sc.shiftsKnown ? me?.scorePct ?? null : null,
      credits: me?.credits ?? 0, improvements: me?.improvements ?? 0, shifts: me?.shifts ?? null,
      teamAveragePct: teamScores.length > 0 ? Math.round(teamScores.reduce((a, b) => a + b, 0) / teamScores.length) : null,
    };
  } catch (err) {
    console.warn("[performance-review] current improvement score unavailable:", err instanceof Error ? err.message : err);
  }

  const myCredits = mine.reduce((n, r) => n + Number(r.credit_weight || 1), 0);
  const daysWorked = shiftsKnown ? new Set(worked.filter(s => s.date >= from && s.date <= to).map(s => s.date)).size : null;
  return {
    completed: mine.length,
    credits: myCredits,
    scorePct: daysWorked != null && daysWorked > 0 ? improvementScorePct(myCredits, daysWorked) : null,
    daysWorked,
    teamScorePct,
    current,
    teamAverage: teamAverage == null ? null : Math.round(teamAverage * 10) / 10,
    shiftsKnown,
    monthly,
    list: mine.sort((a, b) => b.day.localeCompare(a.day)).map(r => ({ id: Number(r.id), title: r.title, date: r.day, credits: Number(r.credit_weight || 1) })),
  };
}

// ── Training ────────────────────────────────────────────────────────────

async function loadTraining(userId: number, stationDays: Map<string, Set<string>>): Promise<PerformanceReport["training"]> {
  const map = await stationSopMap();
  const worked = new Set<string>();
  for (const set of stationDays.values()) for (const st of set) worked.add(st);
  const allSopIds = [...new Set([...map.values()].flat().map(x => x.sopId))];
  const mine = (await latestReviews(allSopIds, userId)).get(userId) ?? new Map();
  const stations: PerformanceReport["training"]["stations"] = [];
  for (const [station, sops] of map) {
    const s = { station, worksThere: worked.has(station), sopCount: 0, trained: 0, refresher: 0, untrained: 0, missing: [] as Array<{ sopId: number; title: string; status: "refresher" | "untrained" }> };
    for (const x of sops) {
      s.sopCount++;
      const st = reviewStatus(mine.get(x.sopId)?.version, x.currentVersion);
      s[st]++;
      if (st !== "trained") s.missing.push({ sopId: x.sopId, title: x.title, status: st });
    }
    // Only stations they work at, or where they've reviewed something.
    if (s.worksThere || s.trained + s.refresher > 0) stations.push(s);
  }
  stations.sort((a, b) => Number(b.worksThere) - Number(a.worksThere) || a.station.localeCompare(b.station));

  const m = (await db.execute<{ matrix_id: number; name: string; label: string; trained: boolean | null }>(sql`
    SELECT tm.id AS matrix_id, tm.name, i.label, r.trained
      FROM training_matrix_enrolments e
      JOIN training_matrices tm ON tm.id = e.matrix_id
      JOIN training_matrix_items i ON i.matrix_id = tm.id
      LEFT JOIN training_records r ON r.item_id = i.id AND r.user_id = e.user_id
     WHERE e.user_id = ${userId}
     ORDER BY tm.name, i.sort_order, i.id
  `)).rows ?? [];
  const matrices = new Map<number, { matrixId: number; name: string; items: number; trained: number; missing: string[] }>();
  for (const row of m) {
    const k = Number(row.matrix_id);
    const x = matrices.get(k) ?? { matrixId: k, name: row.name, items: 0, trained: 0, missing: [] };
    x.items++;
    if (row.trained) x.trained++; else x.missing.push(row.label);
    matrices.set(k, x);
  }
  return { stations, matrices: [...matrices.values()] };
}

// ── Checklists ──────────────────────────────────────────────────────────

/** Items left unticked at the stations they were rostered on, day by day —
 *  the same "missed" rule as the checklist history (GET /checklists/missing).
 *  Shared responsibility: an unticked item counts for everyone on that
 *  station that day. */
async function loadChecklists(userId: number, from: string, to: string, stationDays: Map<string, Set<string>>, known: boolean): Promise<NonNullable<PerformanceReport["checklists"]>> {
  const [missing, mine, stations] = await Promise.all([
    known && stationDays.size > 0 ? findMissingChecklistItems(from, to, null) : Promise.resolve([]),
    db.execute<{ ticked: number; cant_do: number }>(sql`
      SELECT COUNT(*) FILTER (WHERE skipped_reason IS NULL)::int AS ticked,
             COUNT(*) FILTER (WHERE skipped_reason IS NOT NULL)::int AS cant_do
        FROM checklist_completions
       WHERE completed_by = ${userId} AND completed_at >= ${from}::date AND completed_at < ${to}::date + 1`),
    db.execute<{ station_type: string }>(sql`SELECT DISTINCT station_type FROM checklist_templates WHERE is_active`),
  ]);
  const t = mine.rows?.[0];
  return attributeChecklistMisses({
    known, from, to, stationDays,
    templateStations: new Set((stations.rows ?? []).map(r => r.station_type)),
    resolve: resolveChecklistStation,
    missing,
    ticked: Number(t?.ticked ?? 0),
    cantDo: Number(t?.cant_do ?? 0),
  });
}

// ── Lean Made Simple curriculum ─────────────────────────────────────────

async function loadLean(userId: number, from: string, to: string, today: string): Promise<PerformanceReport["lean"]> {
  // A week counts once its Friday has passed (the weekly review is due then).
  const [assigned, done, selfPaced] = await Promise.all([
    db.execute<{ week: string; title: string }>(sql`
      SELECT DISTINCT ON (lean_week_start) lean_week_start::text AS week, title FROM todo_tasks
       WHERE assignee_id = ${userId} AND lean_week_start BETWEEN ${from}::date - 4 AND ${to}
         AND lean_week_start + 4 < ${today}::date
       ORDER BY lean_week_start, id`),
    db.execute<{ week: string; title: string | null; quiz_correct: number | null; quiz_total: number | null }>(sql`
      SELECT r.week_start::text AS week, p.title, r.quiz_correct, r.quiz_total
        FROM lean_lesson_reviews r LEFT JOIN lean_principles p ON p.id = r.principle_id
       WHERE r.user_id = ${userId} AND r.week_start >= '2001-01-01' AND r.week_start BETWEEN ${from}::date - 4 AND ${to}`),
    db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM lean_lesson_reviews
       WHERE user_id = ${userId} AND week_start < '2001-01-01' AND completed_at BETWEEN ${from}::date AND ${to}::date + 1`),
  ]);
  const doneByWeek = new Map((done.rows ?? []).map(r => [r.week, r]));
  const assignedWeeks = (assigned.rows ?? []).map(r => r.week);
  const weeks = [...new Set([...assignedWeeks, ...doneByWeek.keys()])].sort();
  const titleFor = (w: string) => doneByWeek.get(w)?.title ?? (assigned.rows ?? []).find(r => r.week === w)?.title.replace(/^[^:]*:\s*/, "") ?? null;
  return {
    weeksAssigned: weeks.length,
    weeksCompleted: weeks.filter(w => doneByWeek.has(w)).length,
    completed: weeks.filter(w => doneByWeek.has(w)).map(w => {
      const r = doneByWeek.get(w)!;
      return { weekStart: w, title: r.title, quiz: r.quiz_total ? `${r.quiz_correct ?? 0}/${r.quiz_total}` : null };
    }),
    missed: weeks.filter(w => !doneByWeek.has(w)).map(w => ({ weekStart: w, title: titleFor(w) })),
    selfPaced: Number(selfPaced.rows?.[0]?.n ?? 0),
  };
}

// ── Speed ───────────────────────────────────────────────────────────────

type Kpi = (k: string) => { standard: number | null; stretch: number | null };
type Day = { date: string; amount: number; minutes: number };

/** Per person per day work → that person's days, plus everyone else's rate. */
function split(byUser: Map<number, Map<string, Day>>, userId: number): { mine: Day[]; teamOverall: number | null } {
  const mine = [...(byUser.get(userId)?.values() ?? [])];
  let amount = 0, minutes = 0;
  for (const [uid, days] of byUser) {
    if (uid === userId) continue;
    for (const d of days.values()) if (d.minutes >= MIN_RATE_MINUTES) { amount += d.amount; minutes += d.minutes; }
  }
  return { mine, teamOverall: minutes > 0 ? amount / (minutes / 60) : null };
}

async function loadSpeed(userId: number, from: string, to: string, breaks: Awaited<ReturnType<typeof getStandardBreakConfig>>, kpi: Kpi, buildingTarget: number | null): Promise<PerformanceReport["speed"]> {
  const [built, wraps, packs] = await Promise.all([
    db.execute<{ user_id: number; completed_at: string }>(sql`
      SELECT bc.user_id, bc.completed_at::text AS completed_at
        FROM batch_completions bc
        JOIN production_plan_items pi ON pi.id = bc.plan_item_id
        JOIN recipes r ON r.id = pi.recipe_id
       WHERE bc.station_type IN ('building_1','building_2') AND bc.user_id IS NOT NULL
         AND bc.correction_by_user_id IS NULL
         AND r.category IS DISTINCT FROM ${MAC_CHEESE_CATEGORY}
         AND bc.completed_at >= ${from}::date - INTERVAL '1 day' AND bc.completed_at < ${to}::date + INTERVAL '2 days'`),
    db.execute<{ user_id: number; created_at: string; delta: number }>(sql`
      SELECT user_id, created_at::text AS created_at, delta FROM fridge_stock_changes
       WHERE source = 'wrapping' AND delta > 0 AND user_id IS NOT NULL
         AND created_at >= ${from}::date - INTERVAL '1 day' AND created_at < ${to}::date + INTERVAL '2 days'`),
    db.execute<{ user_id: number; verified_at: string }>(sql`
      SELECT verified_by_user_id AS user_id, verified_at::text AS verified_at FROM apc_consignments
       WHERE verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL AND cancelled_at IS NULL
         AND verified_at >= ${from}::date - INTERVAL '1 day' AND verified_at < ${to}::date + INTERVAL '2 days'`),
  ]);

  const group = <T>(rows: T[], uid: (r: T) => number, at: (r: T) => string) => {
    const g = new Map<number, Map<string, T[]>>();
    for (const r of rows) {
      const day = toDay(at(r));
      if (day < from || day > to) continue;
      const u = g.get(uid(r)) ?? new Map<string, T[]>();
      u.set(day, [...(u.get(day) ?? []), r]);
      g.set(uid(r), u);
    }
    return g;
  };
  const ts = (v: string) => new Date(/Z$|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`).getTime();

  // Building: the run-rate method on each builder's own completions per day.
  const b = group(built.rows ?? [], r => Number(r.user_id), r => r.completed_at);
  const bDays = new Map<number, Map<string, Day>>();
  for (const [uid, days] of b) {
    const m = new Map<string, Day>();
    for (const [date, rs] of days) {
      const res = computeBatchesPerHour(rs.map(r => new Date(ts(r.completed_at))), breaks);
      m.set(date, { date, amount: res.batches, minutes: res.activeMinutes });
    }
    bDays.set(uid, m);
  }
  // Wrapping and packing: the wrapping pace rule on each person's own taps.
  const pace = <T>(g: Map<number, Map<string, T[]>>, at: (r: T) => string, qty: (r: T) => number) => {
    const out = new Map<number, Map<string, Day>>();
    for (const [uid, days] of g) {
      const m = new Map<string, Day>();
      for (const [date, rs] of days) {
        const p = paceFromSubs(rs.map(r => ({ ts: ts(at(r)), packs: qty(r) })).sort((x, y) => x.ts - y.ts), breaks);
        m.set(date, { date, amount: p.packs, minutes: p.activeMinutes ?? 0 });
      }
      out.set(uid, m);
    }
    return out;
  };
  const wDays = pace(group(wraps.rows ?? [], r => Number(r.user_id), r => r.created_at), r => r.created_at, r => Number(r.delta));
  const pDays = pace(group(packs.rows ?? [], r => Number(r.user_id), r => r.verified_at), r => r.verified_at, () => 1);

  const bs = split(bDays, userId), ws = split(wDays, userId), ps = split(pDays, userId);
  return {
    building: rateStat({ unit: "batches an hour", days: bs.mine, teamOverall: bs.teamOverall, standard: buildingTarget, stretch: null,
      how: "Batches they completed signed in at a building station, first to last batch each day less the standard breaks. Mac cheese and admin corrections left out." }),
    wrapping: rateStat({ unit: "packs an hour", days: ws.mine, teamOverall: ws.teamOverall, ...kpi("wrapping"),
      how: "Packs they logged at wrapping, their own first to last wrap each day less the standard breaks." }),
    packing: rateStat({ unit: "orders an hour", days: ps.mine, teamOverall: ps.teamOverall, ...kpi("packing"),
      how: "Orders whose courier label they checked at the packing bench, first to last each day less the standard breaks. Packing isn't otherwise recorded per person." }),
  };
}

// ── Attendance ──────────────────────────────────────────────────────────

function attendanceFrom(shifts: Array<{ date: string; typeName: string | null }>, known: boolean): PerformanceReport["attendance"] {
  const empty = { known, shiftsWorked: 0, sickDays: 0, sickInstances: 0, lates: 0, otherAbsence: 0, attendancePct: null, sickSpells: [], lateDates: [] };
  if (!known) return empty;
  const workedDates = [...new Set(shifts.filter(isWorkedShift).map(s => s.date))].sort();
  const sickDates = [...new Set(shifts.filter(s => isSickName(s.typeName ?? undefined)).map(s => s.date))].sort();
  const otherAbsent = [...new Set(shifts.filter(s => !isWorkedShift(s) && !isSickName(s.typeName ?? undefined)).map(s => s.date))];
  const lateDates = [...new Set(shifts.filter(s => isLateName(s.typeName ?? undefined)).map(s => s.date))].sort();
  const absentDays = new Set([...sickDates, ...otherAbsent].filter(d => !workedDates.includes(d))).size;
  return {
    known,
    shiftsWorked: workedDates.length,
    sickDays: sickDates.length,
    sickInstances: countSickInstances(sickDates, workedDates),
    lates: lateDates.length,
    otherAbsence: otherAbsent.length,
    attendancePct: attendancePct(workedDates.length, absentDays),
    absentDays,
    sickSpells: sickRuns(sickDates, workedDates),
    lateDates,
  };
}

/** How late on each late day: their punch-in against the rostered start,
 *  read from Planday's punch clock one day at a time (only the late days).
 *  Minutes are null when Planday can't be reached or has no rostered start. */
async function lateDetails(plandayId: number, dates: string[]): Promise<NonNullable<PerformanceReport["attendance"]["lateDetails"]>> {
  const { getPlandayPunchClockShifts, getPlandayShiftHistory, isPlandayConfigured } = await import("./planday");
  if (!isPlandayConfigured()) return dates.map(date => ({ date, minutesLate: null, clockedIn: null, rostered: null }));
  return Promise.all(dates.slice(0, 60).map(async date => {
    try {
      const punches = (await getPlandayPunchClockShifts(date, date)).filter(p => Number(p.employeeId) === plandayId)
        .sort((a, b) => String(a.startDateTime).localeCompare(String(b.startDateTime)));
      const first = punches[0];
      if (!first) return { date, minutesLate: null, clockedIn: null, rostered: null };
      const m = minutesLate(first);
      // Approving a late shift moves its start to the punch-in (that's what's
      // paid), so the shift's own start says "on time". The rostered start
      // is in the shift's history (Graeme, 24 Nov 2026).
      const history = first.shiftId ? await getPlandayShiftHistory(Number(first.shiftId)).catch(() => []) : [];
      const rostered = rosteredStartFromHistory(history, String(first.startDateTime), m.rostered);
      return { date, minutesLate: minutesLateAgainst(m.clockedIn, rostered), clockedIn: m.clockedIn, rostered };
    } catch {
      return { date, minutesLate: null, clockedIn: null, rostered: null };
    }
  }));
}

// ── Packing & wrapping room score (Graeme, 25 Nov 2026) ──────────────────
// The whole room's score for each day they had a room shift (the room's own
// positions — Packer, Wrapper — from its settings), averaged. Same stored
// days, standards and 100% line as Analytics → KPIs (lib/room-kpi.ts), so
// the two always agree. Never split per person.

async function loadRoomForPerson(plandayId: number, from: string, to: string): Promise<PerformanceReport["room"]> {
  const [{ loadRoomConfig, loadRoomDays }, { getPlandayPositions }, { roomRatio, roomScore }] = await Promise.all([
    import("./room-kpi-job"), import("./planday"), import("../lib/room-kpi"),
  ]);
  const config = await loadRoomConfig();
  const names = new Set(config.positions.map(p => p.trim().toLowerCase()));
  const positionIds = (await getPlandayPositions()).filter(p => names.has(p.name.trim().toLowerCase())).map(p => p.id);
  if (positionIds.length === 0) return null;
  const days = (await db.execute<{ day: string }>(sql`
    SELECT DISTINCT date::text AS day FROM planday_shifts_cache
     WHERE employee_id = ${plandayId} AND date BETWEEN ${from} AND ${to}
       AND position_id IN (${sql.join(positionIds.map(id => sql`${id}`), sql`, `)})
  `)).rows?.map(r => r.day.slice(0, 10)) ?? [];
  if (days.length === 0) return null;
  const stored = new Map((await loadRoomDays(from, to)).map(d => [d.date, d]));
  return roomSummary(days.map(date => {
    const d = stored.get(date);
    const scorePct = d ? roomScore(roomRatio(d, config.weights), config.standardRatio) : null;
    return { date, scorePct, estimate: !!d && d.status !== "ok" };
  }));
}

// ── Records (only what's recorded) ──────────────────────────────────────

async function loadRecords(userId: number, from: string, to: string): Promise<PerformanceReport["records"]> {
  const rows = (await db.execute<{ id: number; d: string; title: string; status: string; meeting_type: string | null; labels: string[] | null; stage: string | null }>(sql`
    SELECT e.id, COALESCE(e.meeting_date, e.entry_date)::text AS d, e.title, e.status, e.meeting_type,
           ARRAY(SELECT c.label FROM people_record_classifications c
                  WHERE c.id = e.classification_id
                     OR c.id IN (SELECT ec.classification_id FROM people_record_entry_classifications ec WHERE ec.entry_id = e.id)) AS labels,
           st.label AS stage
      FROM people_record_entries e
      LEFT JOIN people_review_stages st ON st.id = e.stage_id
     WHERE e.user_id = ${userId}
       AND COALESCE(e.meeting_date, e.entry_date) BETWEEN ${from} AND ${to}
       AND (e.meeting_status IS NULL OR e.meeting_status <> 'cancelled')
     ORDER BY 2 DESC
  `)).rows ?? [];
  const item = (r: (typeof rows)[number], detail: string | null): RecordItem => ({ entryId: Number(r.id), date: iso(r.d)!, title: r.title, detail });
  const has = (r: (typeof rows)[number], label: string) => (r.labels ?? []).includes(label);
  const rtw = (await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM return_to_work_forms WHERE user_id = ${userId} AND absence_start BETWEEN ${from} AND ${to}
  `).catch(() => ({ rows: [{ n: 0 }] }))).rows?.[0]?.n ?? 0;
  return {
    disciplinary: rows.filter(r => has(r, "Disciplinary") || r.meeting_type === "disciplinary" || r.stage != null)
      .map(r => item(r, [r.stage, r.status === "open" ? "in review" : null].filter(Boolean).join(" · ") || null)),
    attendanceOrTimekeeping: rows.filter(r => has(r, "Attendance") || has(r, "Timekeeping")).map(r => item(r, (r.labels ?? []).filter(l => l === "Attendance" || l === "Timekeeping").join(", "))),
    praise: rows.filter(r => has(r, "Praise / recognition")).map(r => item(r, null)),
    returnToWorkForms: Number(rtw),
  };
}

// ── Notes on the record (Graeme, 24 Nov 2026) ───────────────────────────
// "Bring in all of the notes that have happened since the last performance
// review … so I can then include that in the notes for the meeting."

type NoteRow = {
  id: number; entry_id: number | null; kind: string; title: string | null; body: string; visibility: string;
  shared_with_user_ids: number[] | null; author_id: number | null; author_name: string | null;
  due_date: string | null; done_at: string | null; created_at: string;
  entry_title: string | null; entry_date: string | null;
};
const NOTE_COLUMNS = sql`
  n.id, n.entry_id, n.kind, n.title, n.body, n.visibility, n.shared_with_user_ids, n.author_id, n.author_name,
  n.due_date::text AS due_date, n.done_at, n.created_at,
  e.title AS entry_title, COALESCE(e.meeting_date, e.entry_date)::text AS entry_date`;

/** The record's own reading rule, on the server, before anything leaves it:
 *  a private note is its author's (and the HR colleagues they picked).
 *  No viewer → only what's shared with the person (fail closed). */
function readableNotes(rows: NoteRow[], userId: number, viewer: ReportViewer | null | undefined): NoteRow[] {
  return viewer
    ? visibleNotes(rows.map(r => ({ ...r, authorId: r.author_id, sharedWithUserIds: r.shared_with_user_ids })), viewer, userId)
    : rows.filter(r => r.visibility === "shared");
}

function noteFromRow(r: NoteRow): ReportNote {
  return {
    id: Number(r.id), entryId: r.entry_id != null ? Number(r.entry_id) : null, entryTitle: r.entry_title, entryDate: iso(r.entry_date),
    kind: r.kind, title: r.title, body: r.body, date: toDay(r.created_at),
    shared: r.visibility === "shared",
    sharedWithHr: r.visibility !== "shared" && (r.shared_with_user_ids ?? []).length > 0,
    author: r.author_name, dueDate: iso(r.due_date), done: r.done_at != null,
  };
}

async function loadNotes(userId: number, from: string, to: string, viewer: ReportViewer | undefined): Promise<NonNullable<PerformanceReport["notes"]>> {
  const lastReview = await lastAppraisalEntry(userId, to);
  const rows = (await db.execute<NoteRow>(sql`
    SELECT ${NOTE_COLUMNS}
      FROM people_review_notes n
      LEFT JOIN people_record_entries e ON e.id = n.entry_id
     WHERE n.user_id = ${userId} AND n.deleted_at IS NULL
       AND (e.id IS NULL OR e.meeting_status IS NULL OR e.meeting_status <> 'cancelled')
       AND (n.created_at::date BETWEEN ${from}::date - 1 AND ${to}::date + 1
            OR COALESCE(e.meeting_date, e.entry_date) BETWEEN ${from}::date AND ${to}::date
            OR n.entry_id = ${lastReview?.entryId ?? -1})
     ORDER BY n.created_at DESC, n.id DESC
  `)).rows ?? [];
  const readable = readableNotes(rows, userId, viewer);
  const fromLastReview = readable
    .filter(r => lastReview != null && r.entry_id != null && Number(r.entry_id) === lastReview.entryId && (r.kind === "objective" || r.kind === "agreement"))
    .map(noteFromRow);
  const shown = new Set(fromLastReview.map(n => n.id));
  const list = readable.map(noteFromRow).filter(n => !shown.has(n.id)
    && ((n.date >= from && n.date <= to) || (n.entryDate != null && n.entryDate >= from && n.entryDate <= to)));
  return { lastReview, fromLastReview, list };
}

/**
 * The write-up of the meeting a saved report is attached to — read live, so
 * notes written after the copy was saved still come through, and each reader
 * sees only what they may (the person: only what's been shared with them).
 */
export async function loadMeetingWriteUp(entryId: number, userId: number, viewer: ReportViewer | null): Promise<{ entryId: number; title: string; date: string | null; notes: ReportNote[] } | null> {
  const [entry] = (await db.execute<{ title: string; d: string | null }>(sql`
    SELECT title, COALESCE(meeting_date, entry_date)::text AS d FROM people_record_entries WHERE id = ${entryId} AND user_id = ${userId}
  `)).rows ?? [];
  if (!entry) return null;
  const rows = (await db.execute<NoteRow>(sql`
    SELECT ${NOTE_COLUMNS}
      FROM people_review_notes n
      JOIN people_record_entries e ON e.id = n.entry_id
     WHERE n.entry_id = ${entryId} AND n.user_id = ${userId} AND n.deleted_at IS NULL
     ORDER BY n.created_at, n.id
  `)).rows ?? [];
  return { entryId, title: entry.title, date: iso(entry.d), notes: readableNotes(rows, userId, viewer).map(noteFromRow) };
}

// ── Contributions ───────────────────────────────────────────────────────

async function loadContributions(userId: number, from: string, to: string): Promise<PerformanceReport["contributions"]> {
  const [andon, sops, todos] = await Promise.all([
    db.execute<{ system: number; factory: number }>(sql`
      SELECT COUNT(*) FILTER (WHERE area = 'system')::int AS system,
             COUNT(*) FILTER (WHERE area IS DISTINCT FROM 'system')::int AS factory
        FROM andon_issues WHERE reported_by = ${userId} AND created_at >= ${from}::date AND created_at < ${to}::date + 1`),
    db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM standards_sops WHERE author_id = ${userId} AND created_at >= ${from}::date AND created_at < ${to}::date + 1`),
    db.execute<{ assigned: number; done: number; on_time: number; late: number; open: number }>(sql`
      SELECT COUNT(*)::int AS assigned,
             COUNT(*) FILTER (WHERE status = 'done')::int AS done,
             COUNT(*) FILTER (WHERE status = 'done' AND (due_date IS NULL OR completed_at::date <= due_date))::int AS on_time,
             COUNT(*) FILTER (WHERE status = 'done' AND due_date IS NOT NULL AND completed_at::date > due_date)::int AS late,
             COUNT(*) FILTER (WHERE status = 'open')::int AS open
        FROM todo_tasks
       WHERE assignee_id = ${userId} AND lean_week_start IS NULL
         AND (created_by IS NULL OR created_by <> ${userId})
         AND created_at >= ${from}::date AND created_at < ${to}::date + 1`),
  ]);
  const a = andon.rows?.[0], t = todos.rows?.[0];
  return {
    factoryReports: Number(a?.factory ?? 0),
    appReports: Number(a?.system ?? 0),
    sopsWritten: Number(sops.rows?.[0]?.n ?? 0),
    todos: { assigned: Number(t?.assigned ?? 0), done: Number(t?.done ?? 0), onTime: Number(t?.on_time ?? 0), late: Number(t?.late ?? 0), open: Number(t?.open ?? 0) },
  };
}
