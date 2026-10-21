/**
 * The marketing calendar's LIST view (Graeme, 2026-10-20): "ONE continuous
 * chronological order … emails shown only ONCE … I should clearly see where
 * we are today, what's coming up, and whether or not each one has been
 * approved." Pure — no React, no fetch. Tested in agenda.test.ts.
 *
 * buildAgenda() turns phases + Klaviyo emails into rows, top to bottom:
 *
 *   week    "Week of Mon 19 Oct" — every week in the range gets one
 *   day     a day with an email, a phase starting or ending, or today.
 *           Today's row (isToday) IS the Today marker: one Today, with
 *           today's phases and emails directly under it, never a second
 *           row repeating it (Graeme, 2026-10-21)
 *   quiet   a run of empty days inside one week, all under the same phases
 *           (a thin line, so the timeline stays continuous)
 *
 * Klaviyo drafts with no send date are NOT in the rows — "these aren't
 * scheduled for today, they're not scheduled at all" (Graeme, 2026-10-21).
 * They get their own collapsible Drafts section: sortDrafts() and
 * draftsOpen() below.
 *
 * Phases get a lane (assignLanes), so a phase's stripe sits in the same
 * place on every row it covers and overlapping phases sit side by side.
 */
import { addDays, assignLanes, daysBetween, overlaps, startOfWeek } from "./calendar";

export interface AgendaPhase { id: number; startDate: string; endDate: string }
export interface AgendaEmail { id: string; date: string | null; sendAt: string | null }

export interface PhaseOnRow<P> { phase: P; lane: number }

export type AgendaRow<P extends AgendaPhase, E extends AgendaEmail> =
  | { kind: "week"; key: string; weekStart: string; weekEnd: string; current: boolean }
  | {
    kind: "day"; key: string; date: string; isToday: boolean; isPast: boolean;
    /** Every phase covering the day (its stripe). */
    phases: PhaseOnRow<P>[];
    /** Phases that start / end on this day. */
    starts: P[]; ends: P[];
    /** Klaviyo emails sending this day, by send time. */
    emails: E[];
  }
  | { kind: "quiet"; key: string; from: string; to: string; days: number; isPast: boolean; phases: PhaseOnRow<P>[] };

export interface Agenda<P extends AgendaPhase, E extends AgendaEmail> {
  rows: AgendaRow<P, E>[];
  /** How many stripe lanes the phases need (0 = no phases in range). */
  laneCount: number;
}

/**
 * The list's default window: `weeksBack` whole weeks before the week
 * containing `today`, to `weeksAhead` whole weeks after it (Monday–Sunday).
 */
export function agendaRange(today: string, weeksBack = 2, weeksAhead = 10): { from: string; to: string } {
  const thisWeek = startOfWeek(today);
  return { from: addDays(thisWeek, -7 * weeksBack), to: addDays(thisWeek, 7 * (weeksAhead + 1) - 1) };
}

function sendOrder(a: AgendaEmail, b: AgendaEmail): number {
  // Timed emails first, by time; untimed after; then id so the order is stable.
  const ta = a.sendAt ? Date.parse(a.sendAt) : NaN;
  const tb = b.sendAt ? Date.parse(b.sendAt) : NaN;
  const ka = Number.isNaN(ta) ? Infinity : ta;
  const kb = Number.isNaN(tb) ? Infinity : tb;
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.id.localeCompare(b.id);
}

export function buildAgenda<P extends AgendaPhase, E extends AgendaEmail>(input: {
  from: string;
  to: string;
  today: string;
  phases: readonly P[];
  /** Emails with a send date (undated ones and those outside the range are ignored). */
  emails: readonly E[];
}): Agenda<P, E> {
  const { from, to, today } = input;
  const rows: AgendaRow<P, E>[] = [];
  if (to < from) return { rows, laneCount: 0 };

  const phases = input.phases.filter(p => overlaps(p, from, to));
  const lanes = assignLanes(phases);
  const laneCount = phases.reduce((m, p) => Math.max(m, (lanes.get(p.id) ?? 0) + 1), 0);

  const byDay = new Map<string, E[]>();
  for (const e of input.emails) {
    if (!e.date || e.date < from || e.date > to) continue;
    const list = byDay.get(e.date) ?? [];
    list.push(e);
    byDay.set(e.date, list);
  }
  for (const list of byDay.values()) list.sort(sendOrder);

  const covering = (day: string): PhaseOnRow<P>[] => phases
    .filter(p => p.startDate <= day && p.endDate >= day)
    .map(p => ({ phase: p, lane: lanes.get(p.id) ?? 0 }))
    .sort((a, b) => a.lane - b.lane);
  const sameSet = (a: PhaseOnRow<P>[], b: PhaseOnRow<P>[]) =>
    a.length === b.length && a.every((x, i) => x.phase.id === b[i].phase.id);

  let quiet: Extract<AgendaRow<P, E>, { kind: "quiet" }> | null = null;
  const flushQuiet = () => { if (quiet) { rows.push(quiet); quiet = null; } };

  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekStart = startOfWeek(day);
    if (day === from || day === weekStart) {
      flushQuiet();
      rows.push({
        kind: "week", key: `week-${weekStart}`, weekStart, weekEnd: addDays(weekStart, 6),
        current: today >= weekStart && today <= addDays(weekStart, 6),
      });
    }
    const onDay = covering(day);
    const starts = phases.filter(p => p.startDate === day);
    const ends = phases.filter(p => p.endDate === day);
    const emails = byDay.get(day) ?? [];
    const isToday = day === today;
    const isPast = day < today;

    if (isToday || starts.length || ends.length || emails.length) {
      flushQuiet();
      rows.push({ kind: "day", key: `day-${day}`, date: day, isToday, isPast, phases: onDay, starts, ends, emails });
      continue;
    }
    // An empty day: extend the quiet run if it's under the same phases and
    // on the same side of today, else start a new one.
    const q = quiet as Extract<AgendaRow<P, E>, { kind: "quiet" }> | null;
    if (q && sameSet(q.phases, onDay) && q.isPast === isPast) {
      q.to = day;
      q.days = daysBetween(q.from, day) + 1;
    } else {
      flushQuiet();
      quiet = { kind: "quiet", key: `quiet-${day}`, from: day, to: day, days: 1, isPast, phases: onDay };
    }
  }
  flushQuiet();
  return { rows, laneCount };
}

// ── Drafts with no send date (Graeme, 2026-10-21) ─────────────────────────
// Their own collapsible section at the top of the calendar (List and Month
// views alike), never under Today.

/** Undated drafts in a stable order (any with a time first, then by id). */
export function sortDrafts<E extends AgendaEmail>(drafts: readonly E[]): E[] {
  return [...drafts].sort(sendOrder);
}

/**
 * Is the Drafts section open? This device's own choice when it has made one
 * ("open" / "closed"); otherwise open only when a draft needs approval.
 */
export function draftsOpen(saved: string | null | undefined, anyNeedsApproval: boolean): boolean {
  if (saved === "open") return true;
  if (saved === "closed") return false;
  return anyNeedsApproval;
}
