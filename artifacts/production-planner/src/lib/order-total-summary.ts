/** The order's estimated total and how many lines have no price yet (so
 *  aren't in it) — the bottom of every To Order card (Graeme, 20 Nov 2026:
 *  "make the total … obvious and visible … so we can check while we're
 *  ordering"). Counts only lines being ordered. */
export function orderTotalSummary(lines: ReadonlyArray<{ editedPacks: number; costPerPack: number; isMisc?: boolean }>): { total: number; unpriced: number; lines: number } {
  let total = 0, unpriced = 0, count = 0;
  for (const l of lines) {
    if (!(l.editedPacks > 0)) continue;
    count += 1;
    if (l.costPerPack > 0) total += l.editedPacks * l.costPerPack;
    else unpriced += 1;
  }
  return { total: Math.round(total * 100) / 100, unpriced, lines: count };
}
