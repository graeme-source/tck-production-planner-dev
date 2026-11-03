/**
 * Part-made sub-recipe progress, remembered on this iPad (issue #378).
 *
 * The make-a-sub-recipe checklist (Bases & Sauces, the prep hub, and the
 * replenish pop-up from Main Prep / Raw Meat) used to keep its ingredient
 * ticks only on screen, so being signed out on a break, a reload or a screen
 * swap wiped them. Progress is saved per plan + London day + sub-recipe and
 * comes back the same day; anything from another day is dropped.
 * Pure: storage is passed in, so tests need no browser.
 */

export const PROGRESS_KEY_PREFIX = "tck.subRecipeProgress.";

export interface SubRecipeProgress {
  batches: number;
  batchMultiplier: 1 | 2 | 3 | 4 | "custom" | "exact";
  customBatches: number;
  stockOnHand: string;
  checked: string[];
}

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function progressKey(planId: number | null | undefined, day: string, subRecipeId: number): string {
  return `${PROGRESS_KEY_PREFIX}${planId ?? "none"}.${day}.${subRecipeId}`;
}

/** The London day a key was saved on, or null if it isn't one of ours. */
export function dayOfKey(key: string): string | null {
  if (!key.startsWith(PROGRESS_KEY_PREFIX)) return null;
  const parts = key.slice(PROGRESS_KEY_PREFIX.length).split(".");
  return parts.length === 3 ? parts[1] : null;
}

export function parseProgress(raw: string | null): SubRecipeProgress | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const batches = Number(v.batches);
    if (!Number.isFinite(batches) || batches <= 0) return null;
    const multiplier = [1, 2, 3, 4, "custom", "exact"].includes(v.batchMultiplier) ? v.batchMultiplier : 1;
    const custom = Number(v.customBatches);
    return {
      batches,
      batchMultiplier: multiplier,
      customBatches: Number.isFinite(custom) && custom > 0 ? custom : 1,
      stockOnHand: typeof v.stockOnHand === "string" ? v.stockOnHand : "",
      checked: Array.isArray(v.checked) ? v.checked.filter((k: unknown): k is string => typeof k === "string") : [],
    };
  } catch {
    return null;
  }
}

export function loadProgress(store: KeyStore | null, key: string): SubRecipeProgress | null {
  if (!store) return null;
  try { return parseProgress(store.getItem(key)); } catch { return null; }
}

/** Saves progress and sweeps away anything saved on another day. */
export function saveProgress(store: KeyStore | null, key: string, progress: SubRecipeProgress): void {
  if (!store) return;
  try {
    const today = dayOfKey(key);
    const stale: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k !== key) {
        const d = dayOfKey(k);
        if (d != null && d !== today) stale.push(k);
      }
    }
    stale.forEach(k => store.removeItem(k));
    store.setItem(key, JSON.stringify(progress));
  } catch { /* storage full or blocked — progress just isn't remembered */ }
}

export function clearProgress(store: KeyStore | null, key: string): void {
  if (!store) return;
  try { store.removeItem(key); } catch { /* ignore */ }
}

/** window.localStorage, or null where it's blocked (private mode, previews). */
export function browserStore(): KeyStore | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}
