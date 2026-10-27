/**
 * Prep timing on the prep screens — the pure half of
 * hooks/use-prep-session-capture.ts (Graeme, 27 Oct 2026; Objectives C and I).
 * The server's rules for sessions are api-server lib/prep-session-rules.ts.
 */

/** The station keys a session can be opened from (the server checks them). */
export type PrepSessionStation = "main_prep" | "prep_bases" | "prep_meat" | "prep";

/** A prep item as a screen holds it: an ingredient or a sub-recipe, and the
 *  one recipe it was opened for when the screen works recipe by recipe
 *  (Raw Meat). */
export interface PrepSessionItem {
  ingredientId?: number | null;
  subRecipeId?: number | null;
  recipeId?: number | null;
}

/** "ing:12", "sub:5", "ing:12@r:3" — or null when it isn't exactly one item. */
export function prepItemKey(item: PrepSessionItem): string | null {
  const base = prepItemBaseKey(item);
  if (base == null) return null;
  return item.recipeId != null ? `${base}@r:${item.recipeId}` : base;
}

/** The item without its recipe scope ("ing:12"). */
export function prepItemBaseKey(item: PrepSessionItem): string | null {
  const ing = item.ingredientId ?? null;
  const sub = item.subRecipeId ?? null;
  if ((ing == null) === (sub == null)) return null;
  return ing != null ? `ing:${ing}` : `sub:${sub}`;
}

/** What has to happen when the items open on screen become `next`: which
 *  open sessions to close, which items to open. Duplicates and invalid
 *  items in `next` are ignored. */
export function focusChanges(
  openKeys: Iterable<string>,
  next: readonly PrepSessionItem[],
): { close: string[]; open: Array<{ key: string; item: PrepSessionItem }> } {
  const wanted = new Map<string, PrepSessionItem>();
  for (const item of next) {
    const key = prepItemKey(item);
    if (key != null && !wanted.has(key)) wanted.set(key, item);
  }
  const already = new Set(openKeys);
  return {
    close: [...already].filter(k => !wanted.has(k)),
    open: [...wanted].filter(([k]) => !already.has(k)).map(([key, item]) => ({ key, item })),
  };
}

/** A quantity the server will accept, or null (it's optional — a session is
 *  still timed without one, just not per kg). */
export function cleanQuantity(qty: number | null | undefined): number | null {
  if (qty == null || !Number.isFinite(qty) || qty < 0 || qty > 1_000_000) return null;
  return Math.round(qty * 10_000) / 10_000;
}

export const DEVICE_ID_KEY = "tck-prep-device-id";

/** A random id per browser, kept in storage — tells two iPads apart in the
 *  timing data. Storage can be blocked (private mode); the id is optional
 *  context, so that just means no id. */
export function deviceIdFrom(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  make: () => string,
): string | null {
  if (!storage) return null;
  try {
    const existing = storage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = make();
    storage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch (err) {
    console.warn("[prep-timing] no device id (storage unavailable):", err);
    return null;
  }
}
