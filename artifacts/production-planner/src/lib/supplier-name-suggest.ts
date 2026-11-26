/**
 * Supplier names as you type, and "Did you mean…?" for a typo (Graeme, 26 Nov
 * 2026: "when someone's adding a transaction, we start typing Klaviyo, and it
 * basically pre-populates it"; a hand-typed "Klayvio" stopped the invoice
 * matching). The names come from invoices and card statements, never from
 * other hand-typed transactions. Pure, tested. Objective I.
 */
export interface SupplierName { name: string; count: number }

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Names starting with what's typed first, then a word starting with it, then anywhere; busiest first within each. */
export function matchSupplierNames(names: readonly SupplierName[], typed: string, limit = 8): SupplierName[] {
  const q = typed.trim().toLowerCase();
  if (q.length < 2) return [];
  const sq = squash(q);
  const rank = (n: string): number | null => {
    const lower = n.toLowerCase();
    if (lower.startsWith(q) || squash(n).startsWith(sq)) return 0;
    if (lower.split(/[\s\-–.,&/]+/).some((w) => w.startsWith(q))) return 1;
    if (squash(n).includes(sq)) return 2;
    return null;
  };
  return names
    .map((n, i) => ({ n, i, r: rank(n.name) }))
    .filter((x): x is { n: SupplierName; i: number; r: number } => x.r != null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.n);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** A known supplier the typed name is probably a typo of, or null. Compares
 *  the first word (5+ letters): one slip in 5–6 letters, two in longer. */
export function didYouMean(names: readonly SupplierName[], typed: string): string | null {
  const first = squash(typed.trim().split(/\s+/)[0] ?? "");
  if (first.length < 5) return null;
  if (names.some((n) => squash(n.name.split(/\s+/)[0] ?? "") === first)) return null;
  let best: { name: string; d: number } | null = null;
  for (const n of names) {
    const w = squash(n.name.split(/\s+/)[0] ?? "");
    if (w.length < 5) continue;
    const d = editDistance(first, w);
    const allowed = Math.min(first.length, w.length) >= 7 ? 2 : 1;
    if (d > 0 && d <= allowed && (!best || d < best.d)) best = { name: n.name, d };
  }
  return best?.name ?? null;
}

/** A pasted link made usable: trimmed, https:// added when missing; null when it isn't a link. */
export function cleanLink(raw: string): string | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}
