/**
 * Nudging the scheduling manager to book probation reviews.
 *
 * Graeme (2026-09-03): Lorna does the scheduling, so Lorna gets a to-do three
 * weeks before someone's probation review falls due. Start dates come from
 * Planday, where employment actually begins; probation length is six months
 * by default and can be set per person.
 *
 * Two things keep this from becoming noise, which is the fastest way to get a
 * prompt ignored forever:
 *
 *   • It only nudges for people who START on or after the go-live date.
 *     Everyone already employed had their probation arranged by hand — Major
 *     Sarai's three-month review on 22 September was booked before this
 *     existed — so prompting about arrangements that already exist would make
 *     the feature useless on day one.
 *   • It never raises a second to-do for the same person while the first is
 *     still open, and stops entirely once a probation meeting is booked.
 *
 * All the date arithmetic lives in @workspace/db (probation.ts) where it is
 * tested; this file is the plumbing around it.
 */
import { db, usersTable, employeeMeetingsTable, appSettingsTable, needsProbationPrompt, probationDueDate, DEFAULT_PROBATION_MONTHS } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getPlandayEmployees } from "../services/planday";

const DAY_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let running = false;

async function setting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

/** Midnight UTC for a "YYYY-MM-DD" string, or null if it isn't one. */
function parseDay(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ProbationPromptResult {
  checked: number;
  prompted: string[];
  skippedNoScheduler: boolean;
}

export async function runProbationPromptCycle(now = new Date()): Promise<ProbationPromptResult> {
  const [defaultMonthsRaw, schedulerRaw, fromDateRaw] = await Promise.all([
    setting("probation_default_months"),
    setting("probation_scheduler_user_id"),
    setting("probation_prompt_from_hire_date"),
  ]);

  const schedulerId = Number(schedulerRaw);
  if (!Number.isInteger(schedulerId) || schedulerId <= 0) {
    // Nobody to nudge. Say so once per cycle rather than failing — the
    // setting is filled in from Settings, not from here.
    return { checked: 0, prompted: [], skippedNoScheduler: true };
  }

  const defaultMonths = Number(defaultMonthsRaw) || DEFAULT_PROBATION_MONTHS;
  const promptForHiresFrom = parseDay(fromDateRaw) ?? now;

  const staff = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      plandayEmployeeId: usersTable.plandayEmployeeId,
      probationMonths: usersTable.probationMonths,
    })
    .from(usersTable)
    .where(eq(usersTable.isActive, true));

  const linked = staff.filter(s => s.plandayEmployeeId != null);
  if (linked.length === 0) return { checked: 0, prompted: [], skippedNoScheduler: false };

  const employees = await getPlandayEmployees();
  const hiredById = new Map<number, string | null | undefined>();
  for (const e of employees) hiredById.set(e.id, e.hiredDate);

  // Anyone with a probation meeting already on their record is in hand.
  const booked = await db
    .select({ subjectUserId: employeeMeetingsTable.subjectUserId })
    .from(employeeMeetingsTable)
    .where(and(
      eq(employeeMeetingsTable.kind, "probation"),
      inArray(employeeMeetingsTable.subjectUserId, linked.map(s => s.id)),
    ));
  const alreadyBooked = new Set(booked.map(b => b.subjectUserId));

  const prompted: string[] = [];
  for (const person of linked) {
    const hiredOn = parseDay(hiredById.get(person.plandayEmployeeId!));
    const due = needsProbationPrompt(
      {
        hiredOn,
        probationMonths: person.probationMonths,
        alreadyBooked: alreadyBooked.has(person.id),
      },
      now,
      { defaultMonths, promptForHiresFrom },
    );
    if (!due || !hiredOn) continue;

    const dueDate = probationDueDate(hiredOn, person.probationMonths ?? defaultMonths)
      .toISOString().slice(0, 10);
    const title = `Book ${person.name}'s probation review`;

    // Don't stack the same nudge day after day.
    const existing = await db.execute<{ id: number }>(sql`
      SELECT id FROM todo_tasks
      WHERE assignee_id = ${schedulerId} AND status = 'open' AND title = ${title}
      LIMIT 1
    `);
    if (existing.rows.length > 0) continue;

    await db.execute(sql`
      INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, priority, due_date)
      VALUES (
        ${schedulerId}, NULL, ${"Probation reminder"}, ${title},
        ${`${person.name}'s probation ends on ${dueDate}. Book the review in before then and it'll show on their record.`},
        ${"high"}, ${dueDate}
      )
    `);
    prompted.push(person.name);
    console.log(`[probation] to-do raised for ${person.name} (due ${dueDate})`);
  }

  return { checked: linked.length, prompted, skippedNoScheduler: false };
}

async function loop() {
  if (!running) return;
  try {
    const result = await runProbationPromptCycle();
    if (result.skippedNoScheduler) {
      console.log("[probation] no scheduling manager set (probation_scheduler_user_id) — nothing to do");
    }
  } catch (err) {
    // A reminder failing must never take the server with it.
    console.error("[probation] cycle failed:", err instanceof Error ? err.message : err);
  }
  if (running) timer = setTimeout(() => { void loop(); }, DAY_MS);
}

export function startProbationPrompts(): void {
  if (running) return;
  running = true;
  // A few minutes after boot, then daily. Nothing here is time-critical —
  // three weeks of notice absorbs a day either way.
  timer = setTimeout(() => { void loop(); }, 5 * 60_000);
  console.log("[probation] reminder scheduler started");
}

export function stopProbationPrompts(): void {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
}
