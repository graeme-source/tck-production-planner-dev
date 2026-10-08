/**
 * Taking wrapped packs back OUT of the production fridge (or product
 * freezer) from the wrapping station — the rules, kept pure so they're
 * tested without a database.
 *
 * Why this exists (Graeme, 2026-10-08): the wrapping screen's "Undo" was a
 * single tap. On 8 Oct at 13:35 it took 20 Philly Cheesesteak packs out of
 * the record three seconds after the last BBQ stack went in — the panel had
 * just auto-advanced from BBQ to Philly under the wrapper's finger. Those 20
 * had really been wrapped (and already despatched), so the plan said "20
 * still to wrap" all afternoon. An undo is now a deliberate act: the screen
 * confirms twice, and the server refuses any request that doesn't carry the
 * confirmation and a reason — so a stray tap or a replayed request can't
 * move stock on its own.
 *
 * Who did it is the session user (fridge_stock_changes.user_id); why is the
 * reason, written into the change's note by undoNote().
 */
import * as z from "zod";

export const UNDO_REASONS = ["added_twice", "wrong_recipe", "not_wrapped", "other"] as const;
export type UndoReason = (typeof UNDO_REASONS)[number];

/** The words the Stock Control history shows for each reason. The station
 *  screen shows the same labels (production-planner lib/wrapping-undo.ts). */
export const UNDO_REASON_LABELS: Record<UndoReason, string> = {
  added_twice: "Added twice",
  wrong_recipe: "Wrong recipe",
  not_wrapped: "Not actually wrapped",
  other: "Other",
};

/** Longest free-text "Other" reason kept in the note. */
export const UNDO_OTHER_MAX = 120;

/**
 * Body of DELETE /production-plans/:id/items/:itemId/fridge (and /freezer).
 * `confirm: true` and a `reason` are REQUIRED — a request without them is
 * refused with 400 before anything is touched. "Other" needs its words.
 */
export const TakeBackOutBody = z
  .object({
    qty: z.number().int().min(1).max(1000),
    packSize: z.union([z.literal(2), z.literal(8)]).optional(),
    confirm: z.literal(true, {
      errorMap: () => ({ message: "Taking packs back out needs confirming on the wrapping screen" }),
    }),
    reason: z.enum(UNDO_REASONS),
    otherText: z.string().trim().max(UNDO_OTHER_MAX).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.reason === "other" && !(body.otherText ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["otherText"],
        message: "Say why when the reason is Other",
      });
    }
  });
export type TakeBackOutBody = z.infer<typeof TakeBackOutBody>;

/** The note on the fridge_stock_changes row — always starts "Undo wrapped"
 *  so the history reads the same as before, then the reason. */
export function undoNote(reason: UndoReason, otherText?: string | null, packSize: number = 2): string {
  const what = packSize === 8 ? "Undo wrapped (8-pack bags)" : "Undo wrapped";
  if (reason === "other") {
    const words = (otherText ?? "").trim().replace(/\s+/g, " ").slice(0, UNDO_OTHER_MAX);
    return words ? `${what} — Other: ${words}` : `${what} — Other`;
  }
  return `${what} — ${UNDO_REASON_LABELS[reason]}`;
}

/**
 * Which fridge batches a removal takes from, in order. Ordinary removals
 * (despatch, manual counts) take the oldest use-by first. An undo of wrapped
 * packs takes them back from the batch they were wrapped into — this plan's
 * julian batch — first, then oldest-first for anything that batch no longer
 * holds (so the batch rows still add up to the aggregate). The order within
 * each group is kept as given (the caller sorts by use-by).
 */
export function batchesInRemovalOrder<T extends { batchNumber: number }>(
  batchesOldestFirst: readonly T[],
  preferBatchNumber?: number | null,
): T[] {
  if (preferBatchNumber == null) return [...batchesOldestFirst];
  const preferred = batchesOldestFirst.filter(b => b.batchNumber === preferBatchNumber);
  const rest = batchesOldestFirst.filter(b => b.batchNumber !== preferBatchNumber);
  return [...preferred, ...rest];
}
