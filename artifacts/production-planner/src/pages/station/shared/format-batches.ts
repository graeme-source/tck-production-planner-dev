// Fractional batch counts on station screens.
//
// "3.2 batches" is ambiguous on the floor: half the team reads ".2" as
// "2 packs" when 0.2 of a standard 5-pack batch is actually 1 pack. So
// fractional parts are always spelled out in PACKS instead of decimals
// (Graeme, 2026-08-26): 3.2 → "3 + 1pk", 3 → "3".
//
// packsPerBatch defaults to the standard calzone batch (10 portions ÷ 2 per
// pack = 5); pass the recipe's own figure where the caller has it.
export function formatBatches(batches: number | null | undefined, packsPerBatch = 5): string {
  const b = Number(batches) || 0;
  const whole = Math.floor(b + 1e-9);
  const packs = Math.round((b - whole) * Math.max(1, packsPerBatch));
  if (packs <= 0) return String(whole);
  return `${whole} + ${packs}pk`;
}

/** Total packs represented by a (possibly fractional) batch count —
 *  3.2 batches at 5 packs/batch → 16. Shown greyed in brackets beside
 *  batch counters so the floor can sanity-check against physical packs. */
export function batchesToPacks(batches: number | null | undefined, packsPerBatch = 5): number {
  return Math.round((Number(batches) || 0) * Math.max(1, packsPerBatch));
}
