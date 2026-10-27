/** The smallest text on a label proof, for the publish check's "Smallest
 *  text: …" line. A small 102 × 25 mm label has no field table, so there is
 *  none — null, not a crash (2026-10-27: publishing the garlic mayo label
 *  failed with "Cannot read properties of undefined (reading 'key')"). */
export function smallestField<T extends { sizePt: number }>(fields: readonly T[]): T | null {
  return fields.length ? fields.reduce((m, f) => (f.sizePt < m.sizePt ? f : m), fields[0]!) : null;
}
