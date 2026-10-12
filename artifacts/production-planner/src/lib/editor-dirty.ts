/**
 * Has the person changed anything? For the recipe and sub-recipe editors'
 * pinned save bar (Graeme, 2026-10-12: grey when nothing changed, green when
 * there is something to save, and a warning before closing). Objective F:
 * no silent data loss.
 *
 * Compares the form's current values against the values it was loaded with,
 * so editing a field and putting it back counts as "no changes". Form inputs
 * hand back strings for numbers ("5" vs 5) and "" / null / undefined / false
 * for "nothing", so values are normalised before comparing:
 *   • numeric strings → numbers ("0.250" = 0.25)
 *   • "", null, undefined and false are all "empty"
 *   • strings are trimmed
 * Arrays compare in order (row order is meaningful); objects key by key.
 * Keys in `ignore` (top level, e.g. a derived yield) are skipped.
 *
 * Pure — unit-tested.
 */

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/;

export function normaliseForDirty(v: unknown): unknown {
  if (v === undefined || v === null || v === false) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    if (NUMERIC.test(t)) return Number(t);
    return t;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(normaliseForDirty);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const n = normaliseForDirty((v as Record<string, unknown>)[k]);
      if (n !== null) out[k] = n;
    }
    return out;
  }
  return v;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(k => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export function formIsDirty(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  ignore: readonly string[] = [],
): boolean {
  const skip = new Set(ignore);
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const k of keys) {
    if (skip.has(k)) continue;
    if (!same(normaliseForDirty(baseline[k]), normaliseForDirty(current[k]))) return true;
  }
  return false;
}
