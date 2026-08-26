/**
 * Keeping the Lean training matrix in step with the curriculum
 * (Objective E — Graeme, 2026-08-26: "the training matrix should always
 * match the curriculum as a single source of truth").
 *
 * The curriculum is the truth: one scheduled week = one matrix column,
 * in the same order, with the same name. Whenever a week is added,
 * renamed, re-ordered or removed, the matrix follows in the same
 * transaction — no seeder script to remember to run.
 *
 * The one place we deliberately DON'T follow the curriculum is deleting a
 * column people have already been signed off against. A training record is
 * evidence that a person was trained on something; dropping the column
 * cascades those rows away and the evidence is gone. So a column whose week
 * has left the plan is removed only while nobody has been signed off on it,
 * and otherwise kept as a historical column. `planMatrixSync` reports those
 * separately so the caller can tell the user what it kept and why.
 *
 * Split out as pure functions so the ordering and safety rules are unit
 * tested without a database (charter: tests are pure logic, no DB).
 */

/** One scheduled week of the curriculum, in plan order. */
export interface CurriculumWeek {
  principleId: number;
  title: string;
  /** Null for a subject's own week; otherwise this week's slice ("Sweep"). */
  partLabel: string | null;
  /** 1-based position in the plan. */
  position: number;
}

/** One existing column on the Lean matrix. */
export interface MatrixItemRow {
  id: number;
  label: string;
  principleId: number | null;
  sortOrder: number;
  /** True if anyone has ever been signed off against this column. */
  hasSignOffs: boolean;
}

export interface MatrixSyncPlan {
  create: Array<{ principleId: number; label: string; sortOrder: number }>;
  update: Array<{ id: number; label: string; sortOrder: number }>;
  /** Columns whose week has gone and which nobody was signed off on. */
  remove: number[];
  /** Columns whose week has gone but which carry sign-offs — kept as history. */
  keepAsHistory: number[];
}

/** The column header for a week: "3S — Sweep", or just "3S" for its own week. */
export function matrixLabelFor(week: Pick<CurriculumWeek, "title" | "partLabel">): string {
  const part = week.partLabel?.trim();
  return part ? `${week.title} — ${part}` : week.title;
}

/**
 * Work out the changes that bring `items` in line with `weeks`.
 *
 * Matching is by principleId, never by label — a week can be renamed
 * freely without the matrix losing anyone's sign-off history. Columns that
 * predate the planner and carry no principleId are left alone entirely:
 * they're somebody's hand-made column, not ours to manage.
 */
export function planMatrixSync(weeks: CurriculumWeek[], items: MatrixItemRow[]): MatrixSyncPlan {
  const plan: MatrixSyncPlan = { create: [], update: [], remove: [], keepAsHistory: [] };

  const byPrinciple = new Map<number, MatrixItemRow>();
  for (const item of items) {
    // Only ever manage columns we own. A duplicate principleId (possible if
    // the old seeder ran twice) keeps the lowest id and lets the rest fall
    // through to the orphan rules below, so we converge on one column.
    if (item.principleId == null) continue;
    const existing = byPrinciple.get(item.principleId);
    if (!existing || item.id < existing.id) byPrinciple.set(item.principleId, item);
  }

  const wanted = new Set<number>();
  const ordered = [...weeks].sort((a, b) => a.position - b.position);
  ordered.forEach((week, index) => {
    const label = matrixLabelFor(week);
    const sortOrder = index + 1;
    const existing = byPrinciple.get(week.principleId);
    if (!existing) {
      plan.create.push({ principleId: week.principleId, label, sortOrder });
      return;
    }
    wanted.add(existing.id);
    if (existing.label !== label || existing.sortOrder !== sortOrder) {
      plan.update.push({ id: existing.id, label, sortOrder });
    }
  });

  for (const item of items) {
    if (item.principleId == null) continue;
    if (wanted.has(item.id)) continue;
    if (item.hasSignOffs) plan.keepAsHistory.push(item.id);
    else plan.remove.push(item.id);
  }

  return plan;
}

/** True when the plan would change nothing — lets callers skip the write. */
export function isNoopPlan(plan: MatrixSyncPlan): boolean {
  return plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0;
}
