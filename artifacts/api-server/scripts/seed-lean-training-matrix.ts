#!/usr/bin/env tsx
/**
 * seed-lean-training-matrix.ts
 *
 * Creates (or tops up) the Lean training matrix: one item per active weekly
 * principle in the installed curriculum, each carrying principle_id so the
 * weekly in-app lesson review auto-ticks the right cell. Enrols every
 * active user. Idempotent — safe to re-run after a curriculum change or a
 * new starter joins (Objective E).
 *
 * Run:
 *   DATABASE_URL=... pnpm --filter @workspace/api-server exec tsx \
 *     scripts/seed-lean-training-matrix.ts
 */
import { pool } from "@workspace/db";

const MATRIX_NAME = "Lean — Lean Made Simple";
const ON_DEMAND_TITLE = "On-demand lessons";

async function main() {
  const pg = await pool.connect();
  try {
    await pg.query("BEGIN");

    const existing = await pg.query<{ id: number }>(
      `SELECT id FROM training_matrices WHERE name = $1`, [MATRIX_NAME],
    );
    let matrixId = existing.rows[0]?.id;
    if (!matrixId) {
      const created = await pg.query<{ id: number }>(
        `INSERT INTO training_matrices (name, description)
         VALUES ($1, 'The weekly lean curriculum. Cells tick themselves when someone completes that week''s in-app lesson review (pages + quiz).')
         RETURNING id`,
        [MATRIX_NAME],
      );
      matrixId = created.rows[0].id;
      console.log(`created matrix #${matrixId} "${MATRIX_NAME}"`);
    } else {
      console.log(`matrix #${matrixId} "${MATRIX_NAME}" already exists`);
    }

    const { rows: principles } = await pg.query<{ id: number; week_position: number; title: string }>(
      `SELECT id, week_position, title FROM lean_principles
       WHERE is_active AND title <> $1 AND week_position < 1000
       ORDER BY week_position`,
      [ON_DEMAND_TITLE],
    );
    let newItems = 0;
    for (const p of principles) {
      const { rowCount } = await pg.query(
        `INSERT INTO training_matrix_items (matrix_id, label, principle_id, sort_order)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (SELECT 1 FROM training_matrix_items WHERE matrix_id = $1 AND principle_id = $3)`,
        [matrixId, `Wk ${p.week_position}: ${p.title}`, p.id, p.week_position],
      );
      newItems += rowCount ?? 0;
    }
    const { rowCount: enrolled } = await pg.query(
      `INSERT INTO training_matrix_enrolments (matrix_id, user_id)
       SELECT $1, id FROM app_users WHERE is_active
       ON CONFLICT (matrix_id, user_id) DO NOTHING`,
      [matrixId],
    );

    await pg.query("COMMIT");
    console.log(`items: +${newItems} (of ${principles.length} principles) · enrolments: +${enrolled ?? 0}`);
  } catch (err) {
    await pg.query("ROLLBACK");
    throw err;
  } finally {
    pg.release();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
