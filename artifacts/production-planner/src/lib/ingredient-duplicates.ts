/**
 * "Mixed Herbs already exists — did you mean that one?" (#326, Jane Miles).
 *
 * Two Mixed Herbs records (#44 and #225) ended up side by side, and once the
 * second one had order and stock history it could no longer be deleted.
 * Adding an ingredient now warns when one with a near-identical name or the
 * same supplier code is already on file. A warning only — it never blocks.
 */
export interface ExistingIngredient {
  id: number;
  name: string;
  supplierPartNumber?: string | null;
}

export interface DuplicateMatch {
  id: number;
  name: string;
  reason: "name" | "code";
}

/** Lower case, punctuation and "&"/"and" ignored, plural "s" dropped. */
export function normaliseIngredientName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(w => w && w !== "and")
    .map(w => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .sort()
    .join(" ");
}

function normaliseCode(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Edit distance, small strings only. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Existing ingredients the new one probably duplicates (code matches first). */
export function findLikelyDuplicates(
  draft: { name: string; supplierPartNumber?: string | null },
  existing: readonly ExistingIngredient[],
  excludeId: number | null = null,
): DuplicateMatch[] {
  const name = normaliseIngredientName(draft.name ?? "");
  const code = normaliseCode(draft.supplierPartNumber);
  if (!name && !code) return [];
  const out: DuplicateMatch[] = [];
  for (const e of existing) {
    if (e.id === excludeId) continue;
    if (code && code.length >= 3 && normaliseCode(e.supplierPartNumber) === code) {
      out.push({ id: e.id, name: e.name, reason: "code" });
      continue;
    }
    if (name.length < 3) continue;
    const other = normaliseIngredientName(e.name);
    const close = other === name || (name.length >= 6 && editDistance(other, name) <= 1);
    if (close) out.push({ id: e.id, name: e.name, reason: "name" });
  }
  return out.sort((a, b) => (a.reason === b.reason ? 0 : a.reason === "code" ? -1 : 1));
}

/** The warning line under the name field, or null. */
export function duplicateWarning(matches: readonly DuplicateMatch[]): string | null {
  if (matches.length === 0) return null;
  const first = matches[0];
  const why = first.reason === "code" ? " with the same supplier code" : "";
  const more = matches.length > 1 ? ` (and ${matches.length - 1} more similar)` : "";
  return `${first.name} already exists${why}${more}, did you mean that one?`;
}
