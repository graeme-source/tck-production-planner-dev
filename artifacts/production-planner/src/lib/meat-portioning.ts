/**
 * How a raw meat is portioned at the Raw Meat station (Graeme, 9 Nov 2026,
 * Fix queue #396). Pure, tested.
 *
 * Each raw meat says whether it goes in trays or bags, and whether the station
 * splits it at all. With the split off, the run is one lot: the station shows
 * the total meat, rub and sauce and one tick that ticks every portion, so the
 * stock and "still to prep" figures (which count portions) don't change.
 */
export type MeatContainer = "tray" | "bag";

export interface MeatPortioning {
  id: number;
  countsTowardSlowMeat: boolean;
  container: MeatContainer;
  breakdown: boolean;
}

export const DEFAULT_PORTIONING: Omit<MeatPortioning, "id"> = { countsTowardSlowMeat: true, container: "tray", breakdown: true };

/** "tray", "trays", "bag", "bags". */
export function portionWord(container: MeatContainer | undefined, count: number): string {
  const word = container === "bag" ? "bag" : "tray";
  return count === 1 ? word : `${word}s`;
}

/** The word for a mix of meats: "bag" only when every one of them is bagged. */
export function sharedContainer(containers: Array<MeatContainer | undefined>): MeatContainer {
  return containers.length > 0 && containers.every(c => c === "bag") ? "bag" : "tray";
}

/** What tapping the single "all in one" tick does: tick every portion not yet
 *  done, or untick them all when they're all done. Tray numbers 1…count. */
export function wholeLotToggle(count: number, isDone: (n: number) => boolean): { action: "tick" | "untick"; numbers: number[] } {
  const all = Array.from({ length: Math.max(0, count) }, (_, i) => i + 1);
  const notDone = all.filter(n => !isDone(n));
  return notDone.length === 0 ? { action: "untick", numbers: all } : { action: "tick", numbers: notDone };
}

/** What the counters show for one meat: its portions when split, or one lot
 *  (done once every portion is ticked) when it isn't. */
export function displayUnits(input: { portions: number; done: number; breakdown: boolean }): { total: number; done: number } {
  const { portions, done, breakdown } = input;
  if (breakdown || portions <= 0) return { total: portions, done };
  return { total: 1, done: done >= portions ? 1 : 0 };
}
