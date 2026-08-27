/**
 * A Postgres `int[]` literal, for `= ANY(...)` inside a Drizzle sql template.
 *
 * Drizzle expands a JS array interpolated into a sql template as a ROW
 * CONSTRUCTOR — `${[1,2,3]}` becomes `($1, $2, $3)` — so the natural-looking
 * `ANY(${ids})` renders `ANY(($1,$2,$3))`, which Postgres rejects outright.
 *
 * This shipped to live on 2026-08-26 and took the whole improvements list
 * down: the query only runs when there is at least one improvement, so an
 * empty database never triggers it and neither typecheck nor the unit tests
 * could see it. The failure mode is the nasty one — the endpoint 500s and the
 * page renders its empty state, so it reads as "no data" rather than "broken".
 *
 * The fix is to pass the whole array as ONE parameter, as a `{1,2,3}` literal
 * with an explicit cast. routes/standards.ts already did this; this module
 * exists so there is one obvious place to reach for, and one place to test.
 */

/** Format ids as a Postgres array literal: `{1,2,3}`. Pair with `::int[]`. */
export function intArrayLiteral(ids: Array<number | string>): string {
  return `{${ids.map(id => Number(id)).join(",")}}`;
}
