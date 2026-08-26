/**
 * The SQL migration runner — applies pending files from lib/db/migrations/
 * at API server startup, so a schema change ships as a file and nothing
 * else (see sql-migration-plan.ts for the decision rules and the baseline
 * story; that half is pure and unit-tested).
 *
 * Mechanics:
 *   - Applied files are recorded in _sql_migrations by filename.
 *   - A Postgres advisory lock makes concurrent instances safe: whoever
 *     wins the lock applies, everyone else waits and finds nothing to do.
 *   - Each file runs inside its own transaction. A failure rolls that file
 *     back, is logged loudly, and STOPS the run — later files often depend
 *     on earlier ones, so skipping ahead would apply them out of order.
 *     The server still comes up (same posture as runStartupMigrations):
 *     a bad migration should page us, not take the kitchen offline.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { planSqlMigrations } from "./sql-migration-plan";

// src/lib/ → api-server → artifacts → repo root. The server always runs
// from source via tsx (dev and the Docker image alike), and the image
// COPYs lib/ in, so this resolves everywhere the server does.
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../lib/db/migrations",
);

// Arbitrary but fixed — must simply never collide with another advisory
// lock in this codebase (there are currently none).
const ADVISORY_LOCK_KEY = 20260826;

export async function runSqlMigrations(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(MIGRATIONS_DIR);
  } catch (err) {
    console.error(`[sql-migrations] cannot read ${MIGRATIONS_DIR} — skipping:`, err);
    return;
  }

  const pg = await pool.connect();
  try {
    await pg.query(`SELECT pg_advisory_lock($1)`, [ADVISORY_LOCK_KEY]);

    await pg.query(`
      CREATE TABLE IF NOT EXISTS _sql_migrations (
        file_name TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
        -- 'run' = actually executed; 'baseline' = predates the runner and
        -- was assumed applied (see sql-migration-plan.ts).
        how TEXT NOT NULL DEFAULT 'run'
      )
    `);

    const { rows } = await pg.query<{ file_name: string }>(`SELECT file_name FROM _sql_migrations`);
    const plan = planSqlMigrations(files, new Set(rows.map(r => r.file_name)));

    for (const file of plan.markOnly) {
      await pg.query(
        `INSERT INTO _sql_migrations (file_name, how) VALUES ($1, 'baseline') ON CONFLICT DO NOTHING`,
        [file],
      );
    }
    if (plan.markOnly.length > 0) {
      console.log(`[sql-migrations] baselined ${plan.markOnly.length} pre-runner migrations`);
    }

    for (const file of plan.run) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await pg.query("BEGIN");
        await pg.query(sql);
        await pg.query(`INSERT INTO _sql_migrations (file_name, how) VALUES ($1, 'run')`, [file]);
        await pg.query("COMMIT");
        console.log(`[sql-migrations] applied ${file}`);
      } catch (err) {
        await pg.query("ROLLBACK").catch(() => {});
        console.error(`[sql-migrations] FAILED applying ${file} — stopping here; later migrations not attempted:`, err);
        return;
      }
    }
  } finally {
    await pg.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
    pg.release();
  }
}
