/**
 * An employment-record entry's classifications (migration 0184; Graeme,
 * 2026-10-12: "we should be [able to tick a] number of classifications").
 *
 * people_record_entries.classification_id is the PRIMARY (the first
 * ticked); people_record_entry_classifications holds the full set. This is
 * the ONLY place either is written for a set, so the two never drift:
 * setEntryClassifications writes the primary column and the links together.
 * Readers use loadEntryClassIds (the app) or entryClassIdsSql (SQL joins);
 * both include the primary even if an older row has no links yet. The rules
 * themselves are pure, in @workspace/people-reviews (entryClassIds,
 * entryClassification).
 */
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { cleanClassIds } from "@workspace/people-reviews";

type Exec = Pick<typeof db, "execute">;

/** Every entry's ticked classifications, primary first. */
export async function loadEntryClassIds(exec: Exec, entryIds: readonly number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (entryIds.length === 0) return out;
  const ids = sql.join(entryIds.map(id => sql`${id}`), sql`, `);
  const rows = await exec.execute<{ entry_id: number; classification_id: number; primary_id: number }>(sql`
    SELECT l.entry_id, l.classification_id, e.classification_id AS primary_id
      FROM people_record_entry_classifications l
      JOIN people_record_entries e ON e.id = l.entry_id
     WHERE l.entry_id IN (${ids})
     ORDER BY l.entry_id, (l.classification_id = e.classification_id) DESC, l.position, l.classification_id
  `);
  for (const r of rows.rows) {
    const id = Number(r.entry_id);
    out.set(id, [...(out.get(id) ?? []), Number(r.classification_id)]);
  }
  return out;
}

/** SQL: the classification ids of the entry aliased `e` (links ∪ primary). */
export function entryClassIdsSql(entryAlias: string): SQL {
  const e = sql.raw(entryAlias);
  return sql`(SELECT l.classification_id FROM people_record_entry_classifications l WHERE l.entry_id = ${e}.id
              UNION SELECT ${e}.classification_id)`;
}

/** Write the ticked set: the primary column (first ticked) and the links,
 *  in order. Unticked ones are unlinked. `ids` must already be checked
 *  against the classification list. */
export async function setEntryClassifications(exec: Exec, entryId: number, raw: readonly number[]): Promise<void> {
  const ids = cleanClassIds(raw);
  if (ids.length === 0) throw new Error("An entry needs at least one classification");
  const list = sql.join(ids.map(id => sql`${id}`), sql`, `);
  await exec.execute(sql`UPDATE people_record_entries SET classification_id = ${ids[0]}, updated_at = NOW() WHERE id = ${entryId}`);
  await exec.execute(sql`
    DELETE FROM people_record_entry_classifications
     WHERE entry_id = ${entryId} AND classification_id NOT IN (${list})
  `);
  for (const [position, id] of ids.entries()) {
    await exec.execute(sql`
      INSERT INTO people_record_entry_classifications (entry_id, classification_id, position)
      VALUES (${entryId}, ${id}, ${position})
      ON CONFLICT (entry_id, classification_id) DO UPDATE SET position = EXCLUDED.position
    `);
  }
}
