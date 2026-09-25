/**
 * Return-to-work sweep (Graeme, 2026-09-14; any absence 2026-09-25):
 * hourly, reads the Planday mirror for completed spells of absence —
 * sickness, "Absent", dependants' or emergency leave; never holiday — with no
 * form yet, and raises to-dos: for the colleague ("complete your
 * return-to-work form with a manager") and for everyone with People access,
 * naming the colleague and linking to their record (/people/<id>). The to-do
 * interstitial is the pop-up; completing the form closes them. Idempotent:
 * de-duped per spell via the url's spell tag, whichever url format an
 * existing to-do carries (lib/rtw-chase.ts).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  colleagueChaseUrl, managerChaseUrl, chaseLikePatternsForSpell,
  colleagueChaseNotes, managerChaseNotes,
} from "./rtw-chase";

const INTERVAL_MS = 60 * 60 * 1000;

/** Only chase RECENT returns — the form works best fresh. */
const RECENT_RETURN_DAYS = 14;

async function sweep(): Promise<void> {
  const guard = await db.execute<{ ok: string | null }>(sql`
    SELECT to_regclass('public.return_to_work_forms')::text AS ok
  `);
  if (!guard.rows[0]?.ok) return; // first boot before migrations — next run

  const { absenceSpellsForUsers, dueSpells } = await import("./rtw-detect");
  const { rtwManagerUserIds } = await import("../middleware/rtw-access");
  const spellsByUser = await absenceSpellsForUsers(null);
  const managers = await rtwManagerUserIds();

  // Historical spells stay visible (and back-fillable) on each person's
  // record, but nobody gets a to-do about an absence from months ago.
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RECENT_RETURN_DAYS);
  const recentCutoff = cutoff.toISOString().slice(0, 10);

  for (const [userId, spells] of spellsByUser) {
    for (const spell of dueSpells(spells)) {
      if (spell.end < recentCutoff) continue;
      const [endsQ, endsAmp] = chaseLikePatternsForSpell(userId, spell.start);
      const myUrl = colleagueChaseUrl(userId, spell.start);
      await db.execute(sql`
        INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status)
        SELECT ${userId}, NULL, 'Return to work',
               'Complete your return-to-work form with a manager',
               ${colleagueChaseNotes(spell)},
               ${myUrl}, 'high', CURRENT_DATE + 2, 'open'
        WHERE NOT EXISTS (
          SELECT 1 FROM todo_tasks t WHERE t.assignee_id = ${userId} AND t.status <> 'done'
            AND (t.url LIKE ${endsQ} OR t.url LIKE ${endsAmp})
        )
      `);
      for (const managerId of managers) {
        if (managerId === userId) continue;
        const mUrl = managerChaseUrl(userId, spell.start);
        await db.execute(sql`
          INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status)
          SELECT ${managerId}, NULL, 'Return to work',
               (SELECT 'Return-to-work form needed: ' || name FROM app_users WHERE id = ${userId}),
               ${managerChaseNotes(spell)},
               ${mUrl}, 'high', CURRENT_DATE + 2, 'open'
          WHERE NOT EXISTS (
            SELECT 1 FROM todo_tasks t WHERE t.assignee_id = ${managerId} AND t.status <> 'done'
              AND (t.url LIKE ${endsQ} OR t.url LIKE ${endsAmp})
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
