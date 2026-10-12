/**
 * The private HR "Needs attention" queue — the plumbing around the pure
 * rules in @workspace/people-reviews (attention.ts), Graeme 2026-10-12.
 *
 *   loadAttentionItems()   everything that needs doing, for everyone
 *   syncAttentionTodos()   ONE generic to-do — "Your attention is required in
 *                          HR — tap here" — on the list of each person who can
 *                          write employment records and has something to do
 *                          (never about their own record); ticked off when
 *                          their queue is empty. No names, reasons or counts.
 *   startHrAttentionScheduler()  runs the sync shortly after boot, then hourly;
 *                          the record's write routes also run it after a change.
 *
 * Probation facts: a people_probation row when someone has set or decided
 * it; otherwise derived from the latest contract's start date + probation
 * length — only for starters on/after probation_prompt_from_hire_date (the
 * same go-live rule as the probation prompts), so long-standing staff whose
 * probation was handled by hand are never flagged.
 */
import { db, appSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  attentionQueue, queueForViewer, planAttentionTodo, hrAttentionTodo, periodEnd, londonTodayIso,
  DEFAULT_ATTENTION_SETTINGS, HR_ATTENTION_URL, meetingWrittenUp, type MeetingStatus, type AttentionItem, type AttentionSettings, type QueueFacts,
} from "@workspace/people-reviews";
import { canWriteEmploymentRecord, type RecordActor, type RecordSubject } from "./people-write-access";
import { isFounderEmail } from "./founder-email";
import { entryClassIdsSql } from "./entry-classifications";

async function setting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

export async function attentionSettings(): Promise<AttentionSettings> {
  const rows = await db.execute<{ probation_days: number; review_days: number; warning_days: number }>(
    sql`SELECT probation_days, review_days, warning_days FROM people_hr_settings WHERE id = 1`,
  );
  const r = rows.rows[0];
  return r
    ? { probationDays: Number(r.probation_days), reviewDays: Number(r.review_days), warningDays: Number(r.warning_days) }
    : DEFAULT_ATTENTION_SETTINGS;
}

export interface ProbationFact { userId: number; startDate: string; endDate: string; outcome: "passed" | "not_passed" | null; derived: boolean }

/** Every active person's probation, stored or derived (see the header). */
export async function loadProbations(userIds?: number[]): Promise<ProbationFact[]> {
  const [defaultMonthsRaw, fromRaw] = await Promise.all([setting("probation_default_months"), setting("probation_prompt_from_hire_date")]);
  const defaultMonths = Number(defaultMonthsRaw) > 0 ? Number(defaultMonthsRaw) : 6;
  const from = fromRaw && /^\d{4}-\d{2}-\d{2}/.test(fromRaw) ? fromRaw.slice(0, 10) : null;
  const rows = await db.execute<{
    id: number; probation_months: number | null; contract_start: string | null;
    p_start: string | null; p_end: string | null; p_outcome: string | null;
  }>(sql`
    SELECT u.id, u.probation_months, c.start_date::text AS contract_start,
           p.start_date::text AS p_start, p.end_date::text AS p_end, p.outcome AS p_outcome
      FROM app_users u
      LEFT JOIN people_probation p ON p.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT start_date FROM employment_contracts ec WHERE ec.user_id = u.id ORDER BY ec.issued_at DESC LIMIT 1
      ) c ON TRUE
     WHERE u.is_active = TRUE
  `);
  const out: ProbationFact[] = [];
  for (const r of rows.rows) {
    const id = Number(r.id);
    if (userIds && !userIds.includes(id)) continue;
    if (r.p_start && r.p_end) {
      out.push({ userId: id, startDate: r.p_start, endDate: r.p_end, outcome: (r.p_outcome as ProbationFact["outcome"]) ?? null, derived: false });
    } else if (r.contract_start && from && r.contract_start >= from) {
      const months = r.probation_months && r.probation_months > 0 ? Number(r.probation_months) : defaultMonths;
      out.push({ userId: id, startDate: r.contract_start, endDate: periodEnd(r.contract_start, months), outcome: null, derived: true });
    }
  }
  return out;
}

/** Everything that needs doing, for everyone (filter per viewer after). */
export async function loadAttentionItems(today = londonTodayIso()): Promise<AttentionItem[]> {
  const [settings, probations, entries] = await Promise.all([
    attentionSettings(),
    loadProbations(),
    db.execute<{
      id: number; user_id: number; status: string; review_end: string | null; meeting_date: string | null; outcome: string | null;
      warning_expires_on: string | null; warning_withdrawn_at: string | null; stage_type: string | null; uses_stage: boolean;
      meeting_status: string | null; write_ups: number; has_notes: boolean;
    }>(sql`
      SELECT e.id, e.user_id, e.status, e.review_end::text, e.meeting_date::text, e.outcome,
             e.warning_expires_on::text, e.warning_withdrawn_at::text, s.type AS stage_type,
             EXISTS (SELECT 1 FROM people_record_classifications c WHERE c.id IN ${entryClassIdsSql("e")} AND 'stage' = ANY(c.field_sets)) AS uses_stage, e.meeting_status,
             (btrim(COALESCE(e.notes, '')) <> '') AS has_notes,
             (SELECT COUNT(*)::int FROM people_review_notes n WHERE n.entry_id = e.id AND n.deleted_at IS NULL) AS write_ups
        FROM people_record_entries e
        JOIN app_users u ON u.id = e.user_id AND u.is_active = TRUE
        LEFT JOIN people_review_stages s ON s.id = e.stage_id
    `),
  ]);
  const facts: QueueFacts = {
    todayIso: today,
    settings,
    probations: probations.map(p => ({ userId: p.userId, endDate: p.endDate, outcome: p.outcome })),
    openEntries: entries.rows.filter(e => e.status === "open").map(e => ({ id: Number(e.id), userId: Number(e.user_id), reviewEnd: e.review_end })),
    warnings: entries.rows
      .filter(e => e.uses_stage && e.stage_type === "warning" && e.warning_expires_on && !e.warning_withdrawn_at)
      .map(e => ({ entryId: Number(e.id), userId: Number(e.user_id), expiresOn: e.warning_expires_on! })),
    meetings: entries.rows
      .filter(e => e.meeting_date)
      // A review needs writing up once its day comes (lib/people-reviews
      // meetingWrittenUp): a write-up note, notes typed on the entry or an
      // outcome answers it, a cancelled one never asks.
      .map(e => ({
        entryId: Number(e.id), userId: Number(e.user_id), meetingDate: e.meeting_date!,
        writtenUp: meetingWrittenUp({
          meetingStatus: (e.meeting_status as MeetingStatus | null) ?? null, outcome: e.outcome, status: e.status,
          writeUpCount: Number(e.write_ups), notes: e.has_notes ? "yes" : null,
        }),
      })),
  };
  return attentionQueue(facts);
}

interface Writer extends RecordActor { name: string }

/** Everyone who can write employment records: the founder + People access. */
async function writers(): Promise<Writer[]> {
  const rows = await db.execute<{ id: number; name: string; email: string | null; planday_employee_id: number | null; granted: boolean }>(sql`
    SELECT u.id, u.name, u.email, u.planday_employee_id, (g.user_id IS NOT NULL) AS granted
      FROM app_users u LEFT JOIN people_access_grants g ON g.user_id = u.id
     WHERE u.is_active = TRUE
  `);
  return rows.rows
    .map(r => ({ id: Number(r.id), name: r.name, email: r.email, plandayEmployeeId: r.planday_employee_id == null ? null : Number(r.planday_employee_id), hasPeopleAccess: r.granted === true }))
    .filter(w => w.hasPeopleAccess || isFounderEmail(w.email));
}

/** The record subjects for a set of user ids (for the own-record rule). */
export async function subjectsById(ids: number[]): Promise<Map<number, RecordSubject>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{ id: number; email: string | null; planday_employee_id: number | null }>(
    sql`SELECT id, email, planday_employee_id FROM app_users WHERE id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`,
  );
  return new Map(rows.rows.map(r => [Number(r.id), { id: Number(r.id), email: r.email, plandayEmployeeId: r.planday_employee_id == null ? null : Number(r.planday_employee_id) }]));
}

/** One viewer's queue, by the shared write rule — never their own record. */
export async function attentionForViewer(actor: RecordActor, items?: AttentionItem[]): Promise<AttentionItem[]> {
  const all = items ?? await loadAttentionItems();
  const subjects = await subjectsById([...new Set(all.map(i => i.userId))]);
  return queueForViewer(all, uid => { const s = subjects.get(uid); return !!s && canWriteEmploymentRecord(actor, s); });
}

let syncing: Promise<void> | null = null;

/** Keep each writer's single generic to-do in step with their queue. */
export function syncAttentionTodos(): Promise<void> {
  // One at a time — a burst of writes shouldn't race to create duplicates.
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const items = await loadAttentionItems();
      for (const w of await writers()) {
        const mine = await attentionForViewer(w, items);
        const open = await db.execute<{ id: number }>(sql`
          SELECT id FROM todo_tasks WHERE assignee_id = ${w.id} AND url = ${HR_ATTENTION_URL} AND status <> 'done' ORDER BY id
        `);
        const plan = planAttentionTodo(mine, open.rows.map(r => Number(r.id)));
        if (plan.create) {
          const t = hrAttentionTodo(w.id);
          await db.execute(sql`
            INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status, acknowledged_at)
            VALUES (${t.assigneeId}, NULL, ${t.createdByName}, ${t.title}, NULL, ${t.url}, ${t.priority}, CURRENT_DATE, 'open', NOW())
          `);
        }
        for (const id of plan.close) {
          await db.execute(sql`UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = ${id}`);
        }
      }
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** After a write on the record: re-sync, never failing the write. */
export function resyncAttentionSoon(): void {
  syncAttentionTodos().catch(err => console.warn("[hr-attention] sync failed (will retry hourly):", err instanceof Error ? err.message : err));
}

export function startHrAttentionScheduler(): void {
  const run = () => resyncAttentionSoon();
  setTimeout(run, 45_000);
  setInterval(run, 60 * 60 * 1000);
}
