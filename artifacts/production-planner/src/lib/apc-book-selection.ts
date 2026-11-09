/**
 * The Book APC consignments modal's starting ticks and button (Graeme, 9 Nov
 * 2026): it opens with every ready order ticked, and the button says what it
 * will do, like the Tag all modal: "Book all 107", or "Book 5" for a smaller
 * pick. Pure, tested.
 */
export function defaultSelection(ready: Array<{ orderId: number }>): Set<number> {
  return new Set(ready.map(o => o.orderId));
}

export function bookButtonLabel(ticked: number[], ready: number[]): string {
  if (ticked.length === 0) return "Book";
  const tickedSet = new Set(ticked);
  const allReady = ready.length > 0 && ticked.length === ready.length && ready.every(id => tickedSet.has(id));
  return allReady ? `Book all ${ticked.length}` : `Book ${ticked.length}`;
}
