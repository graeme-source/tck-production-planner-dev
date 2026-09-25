/**
 * Quality rejects — wonky and dog bin counters on a plan item, side by side
 * (Graeme, 2026-09-25). Mounted under /production-plans, ahead of the frozen
 * production-plans router, so the wonky paths the stations already call keep
 * working unchanged:
 *
 *   POST   /production-plans/:id/items/:itemId/wonly     +1 wonky (was in production-plans.ts)
 *   DELETE /production-plans/:id/items/:itemId/wonly     −1 wonky (undo)
 *   POST   /production-plans/:id/items/:itemId/dog-bin   +1 dog bin
 *   DELETE /production-plans/:id/items/:itemId/dog-bin   −1 dog bin (undo)
 *
 * Body (optional on all four): { stationType?: "ovens" | "wrapping" } — which
 * screen the tap came from, for the audit trail only.
 *
 * Every tap is ONE atomic UPDATE (no read-modify-write race under concurrent
 * taps; a removal is guarded in the same statement so a counter can never go
 * below zero) plus one quality_reject_events row saying who and when, in the
 * same transaction. The + taps put a person's name on work, so they sit in
 * the server PIN lock (lib/pin-enforce.ts); the − undo taps, like every other
 * undo there, do not.
 *
 * Which counters a tap moves is decided in lib/quality-rejects.ts (tested):
 * a dog bin moves dog_bin_count ONLY — never wonky, fridge or freezer stock.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, productionPlanItemsTable, qualityRejectEventsTable } from "@workspace/db";
import { and, eq, gt, sql, type SQL } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import {
  liveCounter,
  rejectCounterChanges,
  REJECT_LABELS,
  type QualityRejectKind,
  type RejectCounter,
  type TapDelta,
} from "../lib/quality-rejects";

const router: IRouter = Router();

const Params = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

const TapBody = z
  .object({ stationType: z.enum(["ovens", "wrapping"]).optional() })
  .optional();

const COLUMNS = {
  wonlyCount: productionPlanItemsTable.wonlyCount,
  wonlyTotal: productionPlanItemsTable.wonlyTotal,
  dogBinCount: productionPlanItemsTable.dogBinCount,
} as const satisfies Record<RejectCounter, unknown>;

function tapHandler(kind: QualityRejectKind, delta: TapDelta) {
  return async (req: Request, res: Response): Promise<void> => {
    const params = Params.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid plan or item id" });
      return;
    }
    const { id: planId, itemId } = params.data;
    const stationType = (req.body as { stationType?: string } | undefined)?.stationType ?? null;
    const userId = req.session?.userId ?? null;

    const set: Partial<Record<RejectCounter, SQL>> = {};
    for (const [col, d] of Object.entries(rejectCounterChanges(kind, delta)) as Array<[RejectCounter, TapDelta]>) {
      set[col] = sql`GREATEST(${COLUMNS[col]} + ${d}, 0)`;
    }
    const live = COLUMNS[liveCounter(kind)];

    try {
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(productionPlanItemsTable)
          .set(set)
          .where(and(
            eq(productionPlanItemsTable.id, itemId),
            eq(productionPlanItemsTable.planId, planId),
            // A removal only lands while there's something to remove.
            delta < 0 ? gt(live, 0) : undefined,
          ))
          .returning({
            recipeId: productionPlanItemsTable.recipeId,
            wonlyCount: productionPlanItemsTable.wonlyCount,
            wonlyTotal: productionPlanItemsTable.wonlyTotal,
            dogBinCount: productionPlanItemsTable.dogBinCount,
          });
        if (!row) return null;
        await tx.insert(qualityRejectEventsTable).values({
          planId,
          planItemId: itemId,
          recipeId: row.recipeId,
          kind,
          delta,
          stationType,
          userId,
        });
        return row;
      });

      if (!updated) {
        // Tell "no such item" apart from "nothing left to take off".
        const [exists] = await db
          .select({ id: productionPlanItemsTable.id })
          .from(productionPlanItemsTable)
          .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
        if (!exists) {
          res.status(404).json({ error: "Plan item not found" });
        } else {
          res.status(409).json({ error: REJECT_LABELS[kind].alreadyZero });
        }
        return;
      }

      res.json({
        itemId,
        wonlyCount: updated.wonlyCount,
        wonlyTotal: updated.wonlyTotal,
        dogBinCount: updated.dogBinCount,
      });
    } catch (err) {
      console.error(`[quality-rejects] ${kind} ${delta > 0 ? "+1" : "−1"} failed for item ${itemId}:`, err);
      res.status(500).json({ error: `Couldn't record the ${REJECT_LABELS[kind].name.toLowerCase()} — tap again` });
    }
  };
}

router.post("/:id/items/:itemId/wonly", validate(TapBody), tapHandler("wonky", 1));
router.delete("/:id/items/:itemId/wonly", validate(TapBody), tapHandler("wonky", -1));
router.post("/:id/items/:itemId/dog-bin", validate(TapBody), tapHandler("dog_bin", 1));
router.delete("/:id/items/:itemId/dog-bin", validate(TapBody), tapHandler("dog_bin", -1));

export default router;
