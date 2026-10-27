/**
 * Best guess at which areas a change affects, from the files it touched
 * and/or its words. A starting point a person confirms — never the final
 * word — so it errs towards tagging rather than missing a station.
 */
import type { ChangeArea } from "./types";

export interface GuessInput {
  /** Repo-relative file paths the change touched (from a commit or deploy). */
  paths?: readonly string[];
  /** Title and body of the entry. */
  text?: string | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `text` mention `phrase` as whole words (case-insensitive)? */
export function mentions(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(p.toLowerCase())}($|[^a-z0-9])`).test(text.toLowerCase());
}

/** Area keys the change most likely affects, in the areas' sort order.
 *  A change that touched files but matched nothing is treated as office /
 *  behind-the-scenes work (the safe default: it stays out of the meeting). */
export function guessAreas(input: GuessInput, areas: readonly ChangeArea[]): string[] {
  const hit = new Set<string>();
  const paths = (input.paths ?? []).map(p => p.toLowerCase());
  for (const area of areas) {
    if (paths.some(p => area.pathHints.some(h => h && p.includes(h.toLowerCase())))) hit.add(area.key);
  }
  const text = input.text ?? "";
  if (text.trim()) {
    for (const area of areas) {
      if (area.wordHints.some(w => mentions(text, w))) hit.add(area.key);
    }
  }
  if (hit.size === 0 && paths.length > 0) {
    const office = areas.find(a => a.kind === "office");
    if (office) hit.add(office.key);
  }
  return sortAreaKeys([...hit], areas);
}

/** Keys in the areas' display order; unknown keys dropped. */
export function sortAreaKeys(keys: readonly string[], areas: readonly ChangeArea[]): string[] {
  const order = new Map(areas.map(a => [a.key, a.sortOrder] as const));
  return [...new Set(keys)].filter(k => order.has(k)).sort((a, b) => order.get(a)! - order.get(b)!);
}
