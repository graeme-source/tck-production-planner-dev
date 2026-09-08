/**
 * Pure decision logic for the packing screen's two operational alerts:
 *
 * 1. The shrink-wrapper warm-up prompt — the wrapper takes roughly 15 orders'
 *    worth of packing time to get up to temperature, and the team packs first,
 *    wraps after. Prompting at 15 orders remaining means the wrapper is warm
 *    the moment packing runs out, instead of everyone standing around it.
 *
 * 2. Print-dialog detection — labels only print silently when Chrome itself
 *    runs with --kiosk-printing. The app cannot suppress the dialog; what it
 *    CAN do is notice that a print() call blocked long enough for a human to
 *    click a dialog away, and tell the bench how to fix the machine.
 */

/** How many orders left in the wave when the shrink-wrapper prompt fires.
 *  Matches the wrapper's real warm-up time measured in packing work: about
 *  15 orders (Graeme, 2026-09-08). */
export const SHRINK_WRAP_REMAINING_THRESHOLD = 15;

/** The packing-cycle views — the screens an operator only sees standing at
 *  the bench, which is the only place the shrink-wrapper prompt belongs.
 *  The list view is also read from the office, where an overlay demanding
 *  someone walk to the wrapper would be noise. */
const PACKING_CYCLE_VIEWS = new Set(["picking", "pre-confirm", "confirm"]);

export function shouldPromptShrinkWrap({ totalOrders, totalFulfilled, view, acknowledged }: {
  totalOrders: number | null | undefined;
  totalFulfilled: number | null | undefined;
  view: string;
  acknowledged: boolean;
}): boolean {
  if (acknowledged) return false;
  if (!PACKING_CYCLE_VIEWS.has(view)) return false;
  if (totalOrders == null || totalFulfilled == null || totalOrders <= 0) return false;
  const remaining = totalOrders - totalFulfilled;
  // A wave that STARTS at 15 or fewer orders still prompts (on the first
  // order opened): the wrapper needs switching on immediately in that case.
  return remaining > 0 && remaining <= SHRINK_WRAP_REMAINING_THRESHOLD;
}

/** With --kiosk-printing, print() spools the job and returns within
 *  milliseconds. Without it, Chrome blocks the calling thread while its
 *  print dialog is open — so a call that took over a second means a dialog
 *  came up and a person dismissed it. The threshold is generous: a slow
 *  kiosk spool is tens of milliseconds; a human click is never under a
 *  second in practice, and a missed detection just waits for the next label. */
export const PRINT_DIALOG_BLOCK_THRESHOLD_MS = 1200;

export function printDialogLikelyShown(blockedMs: number): boolean {
  return blockedMs >= PRINT_DIALOG_BLOCK_THRESHOLD_MS;
}
