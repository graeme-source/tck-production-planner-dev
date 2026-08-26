/**
 * Which migration files still need to run — the decision half of the SQL
 * migration runner (see sql-migrations.ts for the half that touches the
 * database; charter: tests are pure logic).
 *
 * Context: the repo has carried two migration systems — runStartupMigrations()
 * boot DDL and the numbered files in lib/db/migrations/ — and the files had
 * NO runner at all, so every new one had to be applied to every database by
 * hand (docs/CODEBASE_ANALYSIS.md §5.4; the planner-launch friction,
 * 2026-08-26, is what finally forced the fix). This runner makes the files
 * self-applying. The charter already requires all new schema change to be a
 * file; now a file is also sufficient.
 *
 * The baseline rule: every database that exists today (live, local dev)
 * already carries the effects of migrations 0001–0056, applied by hand over
 * months — but no record of that exists anywhere in the database. Replaying
 * them would fail (not all early files are idempotent). So on first run,
 * files at or below the baseline are recorded as applied WITHOUT being
 * executed, and only files above it actually run.
 */

/** Everything ≤ this number is assumed already applied on first contact
 *  with a database that predates the runner. 0057 is the first file the
 *  runner ever executes for real — it shipped in the same commit series. */
export const SQL_MIGRATION_BASELINE = 56;

export interface SqlMigrationPlan {
  /** Files to record as applied without executing (pre-runner history). */
  markOnly: string[];
  /** Files to actually execute, in order. */
  run: string[];
}

/** The NNNN prefix of a migration filename, or null for a non-migration file. */
export function migrationNumber(fileName: string): number | null {
  const match = /^(\d{4})_.+\.sql$/.exec(fileName);
  return match ? Number(match[1]) : null;
}

/**
 * Decide what to do with each file in the migrations directory.
 *
 * Files sort by full filename, which keeps the historical duplicate numbers
 * (0017_add_partial_packs… / 0017_add_sku_barcodes…) in a stable order.
 * Anything that doesn't match the NNNN_name.sql shape is ignored rather than
 * executed — a stray README or editor backup must never reach the database.
 */
export function planSqlMigrations(
  filesInDir: string[],
  alreadyApplied: Set<string>,
  baseline: number = SQL_MIGRATION_BASELINE,
): SqlMigrationPlan {
  const plan: SqlMigrationPlan = { markOnly: [], run: [] };
  const ordered = [...filesInDir].sort();
  for (const file of ordered) {
    const num = migrationNumber(file);
    if (num == null) continue;
    if (alreadyApplied.has(file)) continue;
    if (num <= baseline) plan.markOnly.push(file);
    else plan.run.push(file);
  }
  return plan;
}
