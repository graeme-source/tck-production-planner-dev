/**
 * "Is building finished?" — the one rule behind the building station's
 * "That's everything built!" pop-up, the pulsing finish button and the queue's
 * "All done" chip.
 *
 * Building is finished when EVERY item on the plan has reached its OWN target
 * (or the builder marked that item finished for the day — a deliberate short
 * build, e.g. the filling ran out). Extras on one item never count towards
 * another item's target.
 *
 * Why this exists: the station used to add every item's built count into one
 * total and compare it with the sum of every target. Mac cheese is 1 pack per
 * batch row, so 2 extra mac cheese packs made the combined total hit the
 * combined target while 2 Philly batches were still outstanding — the pop-up
 * fired "2 batches early" (plan 172, 18 Sep 2026).
 */

export interface BuildProgressItem {
  /** Planned batches (calzone) or packs (mac cheese) for this item. */
  target: number;
  /** Built so far across both building lines. */
  built: number;
  /** The builder marked this item finished for the day. */
  markedComplete: boolean;
}

/** This item needs nothing more from the builders. */
export function isItemBuilt(item: BuildProgressItem): boolean {
  return item.markedComplete || item.built >= item.target;
}

/** Every item is built to its own target. False when nothing is planned. */
export function isBuildingComplete(items: BuildProgressItem[]): boolean {
  return items.some(it => it.target > 0) && items.every(isItemBuilt);
}

/** How many batches/packs are still to build, item by item — an item's
 *  extras never reduce another item's shortfall. Items marked finished owe
 *  nothing. Keep calzone and mac cheese in separate calls: batches and packs
 *  are different units. */
export function stillToBuild(items: BuildProgressItem[]): number {
  return items.reduce((s, it) => s + (it.markedComplete ? 0 : Math.max(0, it.target - it.built)), 0);
}

/** Overall progress as a whole-number percentage, 0–100. Each item
 *  contributes at most its own target, so over-building one item can't make
 *  the bar look finished while another is short. An item marked finished
 *  counts as complete. */
export function buildProgressPercent(items: BuildProgressItem[]): number {
  let target = 0;
  let done = 0;
  for (const it of items) {
    const t = Math.max(0, it.target);
    target += t;
    done += it.markedComplete ? t : Math.min(Math.max(0, it.built), t);
  }
  return target > 0 ? Math.round((done / target) * 100) : 0;
}
