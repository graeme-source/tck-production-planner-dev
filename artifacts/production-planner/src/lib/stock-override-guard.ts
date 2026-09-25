/**
 * Guard logic for calculator screens whose Stock cell can write the master
 * production-fridge record (Stock Control).
 *
 * Background (2026-09-14 incident): the mac cheese calculator's Stock column
 * auto-saved every keystroke straight into stock_entries with no visible
 * feedback. An operator typed plan numbers into it while building the next
 * day's plan and silently rewrote the fridge stock for both mac cheese
 * recipes, throwing the next day's stock count out by exactly those edits.
 *
 * The guard: typing in the cell only affects the on-screen calculation.
 * Writing Stock Control is a separate, explicit, confirmed step — and this
 * module holds the pure decisions for it so they stay unit-testable.
 */

/** True when the operator has changed the Stock cell away from the value the
 *  server supplied — i.e. there is something that COULD be saved. An
 *  untouched cell (undefined) is never "edited", and clearing the field to
 *  0 counts as an edit but must never auto-save (that wrote a phantom 0 to
 *  Stock Control in the 2026-09-14 incident). */
export function stockCellEdited(typed: number | undefined, serverValue: number): boolean {
  return typed !== undefined && typed !== serverValue;
}

export interface StockWritePlan {
  /** Absolute level the write would set in Stock Control. */
  newLevel: number;
  /** Stock Control's current live level, for the confirmation text. */
  currentLevel: number;
  /** Signed change the write amounts to. */
  delta: number;
  /** Set when today's orders haven't all been scanned out yet: those packs
   *  are still physically in the fridge, so they belong in the count being
   *  saved — the plan takes them off separately. Null when there is nothing
   *  to warn about. */
  dispatchWarning: string | null;
}

/** Describes exactly what confirming a Stock cell save would do, so the UI
 *  can show it before anything is written. */
export function planStockWrite(
  typed: number,
  liveStock: number,
  stillToDispatchToday: number,
): StockWritePlan {
  const newLevel = Math.max(0, Math.round(typed));
  const currentLevel = Math.max(0, Math.round(liveStock));
  const toDispatch = Math.max(0, Math.round(stillToDispatchToday));
  return {
    newLevel,
    currentLevel,
    delta: newLevel - currentLevel,
    dispatchWarning: toDispatch > 0
      ? `${toDispatch} pack${toDispatch === 1 ? "" : "s"} from today's orders haven't been scanned out yet — they're still in the fridge, so include them in your count. The plan takes them off for you.`
      : null,
  };
}
