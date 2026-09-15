/**
 * Return-to-work sweep (Graeme, 2026-09-14): hourly, reads the Planday
 * mirror for completed spells of sick leave with no form yet, and raises
 * to-dos — for the colleague ("complete your return-to-work form with a
 * manager") and for each RTW manager, naming the colleague. The to-do
 * interstitial is the pop-up; completing the form closes them. Idempotent:
 * de-duped per spell via the url's spell tag.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const INTERVAL_MS = 60 * 60 * 1000;

async function sweep(): Promise<void> {
  const guard = await db.execute<{ ok: string | null }>(sql`
    SELECT to_regclass('public.return_to_work_forms')::text AS ok
  `);
  if (!guard.rows[0]?.ok) return; // first boot before migrations — next run

  const { sickSpellsForUsers, dueSpells } = await import("./rtw-detect");
  const { rtwManagerUserIds } = await import("../middleware/rtw-access");
  const spellsByUser = await sickSpellsForUsers(null);
  const managers = await rtwManagerUserIds();

  // Only chase RECENT returns — the form works best fresh. Historical
  // spells stay visible (and back-fillable) from the report's sick-leave
  // modal, but nobody gets a to-do about an absence from months ago.
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  const recentCutoff = cutoff.toISOString().slice(0, 10);

  for (const [userId, spells] of spellsByUser) {
    for (const spell of dueSpells(spells)) {
      if (spell.end < recentCutoff) continue;
      const tag = `spell=${userId}:${spell.start}`;
      const myUrl = `/return-to-work?${tag}`;
      await db.execute(sql`
        INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status)
        SELECT ${userId}, NULL, 'Return to work',
               'Complete your return-to-work form with a manager',
               ${`Welcome back. You were off sick ${spell.start === spell.end ? `on ${spell.start}` : `${spell.start} to ${spell.end}`} — grab a manager and fill in the short return-to-work form together. It's private: only you, Graeme and Lorna can see it.`},
               ${myUrl}, 'high', CURRENT_DATE + 2, 'open'
        WHERE NOT EXISTS (
          SELECT 1 FROM todo_tasks t WHERE t.assignee_id = ${userId} AND t.url = ${myUrl} AND t.status <> 'done'
        )
      `);
      for (const managerId of managers) {
        if (managerId === userId) continue;
        const mUrl = `/return-to-work?user=${userId}&${tag}`;
        await db.execute(sql`
          INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status)
          SELECT ${managerId}, NULL, 'Return to work',
               (SELECT 'Return-to-work form needed: ' || name FROM app_users WHERE id = ${userId}),
               ${`Back from sick leave (${spell.start === spell.end ? spell.start : `${spell.start} to ${spell.end}`}) with no return-to-work form yet. Sit down with them and complete it together.`},
               ${mUrl}, 'high', CURRENT_DATE + 2, 'open'
          WHERE NOT EXISTS (
            SELECT 1 FROM todo_tasks t WHERE t.assignee_id = ${managerId} AND t.url = ${mUrl} AND t.status <> 'done'
          )
        `);
      }
    }
  }
}

export function startRtwScheduler(): void {
  const run = () => sweep().catch(err =>
    console.warn("[rtw] return-to-work sweep failed (will retry next hour):", err));
  setTimeout(run, 30_000);
  setInterval(run, INTERVAL_MS);
}
