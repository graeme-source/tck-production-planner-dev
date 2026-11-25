/**
 * Raw Meat station marinade ticks — the pure rules (Graeme, 25 Nov 2026):
 * each marinade/seasoning line under a meat gets ONE tick that covers every
 * tray ("we just tick it once, and that denotes that we've done all the
 * trays"), and ticked lines drop out of view while "hide done" is on so the
 * list shrinks as they're added. The trays are still ticked as before.
 * Objective B. Saved as linked prep ticks: routes/prep-linked-completions.ts.
 */

/** One line: the recipe + the raw meat + EITHER a marinade ingredient (Table
 *  Salt) OR a marinade sub-recipe (Garlic Confit). */
export interface MarinadeTickLine {
  recipeId: number;
  meatIngredientId: number;
  marinadeIngredientId: number | null;
  marinadeSubRecipeId: number | null;
}

/** A tick, keyed like every other "linked" prep tick (prep_linked_completions). */
export interface MarinadeTick {
  key: string;
  userId: number | null;
  userName: string | null;
  tickedAt: string;
}

/** A marinade row from prep-requirements-by-recipe (the fields we key on). */
export interface MarinadeRowIds {
  rawMeatIngredientId: number;
  marinadeIngredientId: number | null;
  marinadeSubRecipeId: number | null;
}

/** The line a marinade row is, for one recipe — null when it has no id to key on. */
export function marinadeLineOf(recipeId: number, m: MarinadeRowIds): MarinadeTickLine | null {
  const ing = m.marinadeIngredientId ?? null;
  const sub = m.marinadeSubRecipeId ?? null;
  // Exactly one id identifies the line; anything else can't be ticked.
  if ((ing == null) === (sub == null)) return null;
  return { recipeId, meatIngredientId: m.rawMeatIngredientId, marinadeIngredientId: ing, marinadeSubRecipeId: sub };
}

/** Every Raw Meat marinade tick starts with this; other linked ticks on the
 *  plan (pasta water, salt) live in the same table and are ignored here. */
export const MARINADE_KEY_PREFIX = "raw_meat_marinade:";

/** The key saved on the plan: "raw_meat_marinade:<recipe>:<meat>:i<id>" (or s<id>). */
export function marinadeLineKey(l: MarinadeTickLine): string {
  const what = l.marinadeIngredientId != null ? `i${l.marinadeIngredientId}` : `s${l.marinadeSubRecipeId}`;
  return `${MARINADE_KEY_PREFIX}${l.recipeId}:${l.meatIngredientId}:${what}`;
}

/** A tick's time as an ISO date. Postgres' own text ("2026-11-25 13:05:45.3")
 *  is UTC with no zone, which Safari would read as local time or not at all. */
export function tickIso(at: string): string {
  const t = at.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"); // "+00" → "+00:00"
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}Z`;
  const d = new Date(zoned);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** The API's rows as ticks — only this feature's keys. */
export function marinadeTicksFrom(
  rows: ReadonlyArray<{ key: string; userId: number | null; userName: string | null; completedAt: string }>,
): MarinadeTick[] {
  return rows.filter(r => r.key.startsWith(MARINADE_KEY_PREFIX))
    .map(r => ({ key: r.key, userId: r.userId, userName: r.userName, tickedAt: tickIso(r.completedAt) }));
}

/** Every tick, by line key. */
export function ticksByKey(ticks: readonly MarinadeTick[]): Map<string, MarinadeTick> {
  return new Map(ticks.map(t => [t.key, t]));
}

/** The ticks with one line ticked on (added if missing) or off (removed) —
 *  what the screen shows the moment someone taps, before the server answers. */
export function withTick(
  ticks: readonly MarinadeTick[],
  key: string,
  on: boolean,
  who: { userId: number | null; userName: string | null; tickedAt: string },
): MarinadeTick[] {
  const rest = ticks.filter(t => t.key !== key);
  return on ? [...rest, { key, ...who }] : rest;
}

/** The ticks after a save failed: this one line goes back to how it was
 *  (its old tick, or none); every other line keeps what it has now. */
export function afterFailedTick(
  ticks: readonly MarinadeTick[],
  key: string,
  was: MarinadeTick | null,
): MarinadeTick[] {
  const rest = ticks.filter(t => t.key !== key);
  return was ? [...rest, was] : rest;
}

/** A ticked row drops away and the next slides up under the finger, so the
 *  second half of a gloved double-tap would tick the wrong line. */
export const DOUBLE_TAP_MS = 400;
export function isDoubleTap(lastTapAt: number | null, now: number): boolean {
  return lastTapAt != null && now - lastTapAt < DOUBLE_TAP_MS;
}

export interface MarinadeRowView<T> {
  row: T;
  key: string | null;
  tick: MarinadeTick | null;
}

/**
 * Which rows to show for one meat. Ticked rows are hidden unless showDone
 * is on; a row that can't be keyed is never "done", so it always shows.
 * Order is kept. doneCount / total are for the toggle and "X of Y added".
 */
export function visibleMarinadeRows<T extends MarinadeRowIds>(
  recipeId: number,
  rows: readonly T[],
  ticked: ReadonlyMap<string, MarinadeTick>,
  showDone: boolean,
): { visible: MarinadeRowView<T>[]; doneCount: number; total: number } {
  const all = rows.map(row => {
    const line = marinadeLineOf(recipeId, row);
    const key = line ? marinadeLineKey(line) : null;
    return { row, key, tick: key ? ticked.get(key) ?? null : null };
  });
  const doneCount = all.filter(v => v.tick != null).length;
  return {
    visible: showDone ? all : all.filter(v => v.tick == null),
    doneCount,
    total: all.length,
  };
}
