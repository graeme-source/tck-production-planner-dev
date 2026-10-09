/**
 * Building station — "Edit production numbers" for one recipe (Graeme,
 * 2026-10-09). Mounted under /production-plans AHEAD of the frozen
 * production-plans router, so no new code goes in that file:
 *
 *   GET  /production-plans/:id/items/:itemId/building-edit
 *        → the recipe's batch rows on both building lines, each line's extra
 *          packs, packs per batch, batches already through the ovens and
 *          packs already wrapped into storage. The screen turns these into
 *          the two counters with @workspace/building-edit.
 *
 *   POST /production-plans/:id/items/:itemId/building-edit
 *        body { stationType, batches, extraPacks, expected: { batches, extraPacks },
 *               batchesLine?, extraPacksLine? }  — which line each change is
 *               taken off / added to (the builder picks it; default stationType)
 *        → applies the staged edit in ONE transaction and returns the new
 *          numbers. `expected` is what the builder saw when they opened the
 *          dialog: if the other line has recorded something since (or a
 *          retry of a save that already went through arrives), the numbers
 *          won't match and nothing changes (409) — the screen reloads them.
 *
 * What changes (rules + floors in @workspace/building-edit, tested):
 *   −batch  deletes a batch_completions row — the chosen line's newest full
 *           batch first — so the TCK run rate and dashboard KPI drop with it;
 *   +batch  inserts a full batch row on the chosen line now, under the
 *           signed-in person, marked
 *           with correction_by_user_id + correction_note "Edit numbers";
 *   ±packs  moves building_station_progress.extra_packs, then the item's
 *           extra_packs_built cache is recomputed (lib/building-progress).
 * Refused (422, with the reason in words) when the chosen line hasn't that
 * many to give, below the batches already through the ovens, or a pack total
 * below what's already wrapped into storage.
 * Every save writes one building_count_edits row (who, before → after, the
 * rows removed/added). It adds batches under a person's name, so it sits in
 * the server PIN lock (lib/pin-enforce.ts).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  productionPlansTable,
  productionPlanItemsTable,
  recipesTable,
  batchCompletionsTable,
  buildingStationProgressTable,
  buildingCountEditsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { recomputeItemFromProgress } from "../lib/building-progress";
import {
  BUILDING_LINES,
  BATCH_WORDS,
  PACK_WORDS,
  buildNumbers,
  editBlockReason,
  editSummary,
  planBuildEdit,
  type BuildEditState,
} from "@workspace/building-edit";

const router: IRouter = Router();

const Params = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

// Extra packs may already be negative on old data (see editBlockReason);
// the rules, not the schema, decide what's allowed.
const Counts = z.object({
  batches: z.number().int().min(0).max(1000),
  extraPacks: z.number().int().min(-5000).max(5000),
});

export const BuildingEditBody = Counts.extend({
  stationType: z.enum(BUILDING_LINES),
  expected: Counts,
  batchesLine: z.enum(BUILDING_LINES).optional(),
  extraPacksLine: z.enum(BUILDING_LINES).optional(),
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Everything the rules need about one plan item, read through `ex`. */
async function loadState(ex: typeof db | Tx, planId: number, itemId: number, lock: boolean) {
  const q = ex
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
      fridgeQty: productionPlanItemsTable.fridgeQty,
      freezerQty: productionPlanItemsTable.freezerQty,
      fridgeEightPackQty: productionPlanItemsTable.fridgeEightPackQty,
      freezerEightPackQty: productionPlanItemsTable.freezerEightPackQty,
      planStatus: productionPlansTable.status,
    })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlansTable.id, productionPlanItemsTable.planId))
    .leftJoin(recipesTable, eq(recipesTable.id, productionPlanItemsTable.recipeId))
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
  // Lock the item row so two Saves (both lines editing at once) queue up
  // and the second one sees the first one's result.
  const [item] = lock ? await q.for("update", { of: productionPlanItemsTable }) : await q;
  if (!item) return null;

  const completions = await ex
    .select({
      id: batchCompletionsTable.id,
      stationType: batchCompletionsTable.stationType,
      userId: batchCompletionsTable.userId,
      completedAt: batchCompletionsTable.completedAt,
      partialPacks: batchCompletionsTable.partialPacks,
    })
    .from(batchCompletionsTable)
    .where(and(
      eq(batchCompletionsTable.planItemId, itemId),
      inArray(batchCompletionsTable.stationType, [...BUILDING_LINES, "ovens"]),
    ));
  const progress = await ex
    .select({ stationType: buildingStationProgressTable.stationType, extraPacks: buildingStationProgressTable.extraPacks })
    .from(buildingStationProgressTable)
    .where(eq(buildingStationProgressTable.planItemId, itemId));

  // Same packs-per-batch as recipe-completion.ts / the batch-completions
  // route: whole packs of the recipe's own pack size in one batch.
  const packSize = Number(item.packSize) || 2;
  const packsPerBatch = Math.max(1, Math.floor((Number(item.portionsPerBatch) || 10) / packSize));
  // An 8-pack bag holds this many of the recipe's packs (4 two-packs).
  const packsPerBag = Math.max(1, Math.floor(8 / packSize));

  const buildRows = completions.filter(c => (BUILDING_LINES as readonly string[]).includes(c.stationType));
  const state: BuildEditState = {
    completions: buildRows.map(c => ({ id: c.id, stationType: c.stationType, completedAt: c.completedAt, partialPacks: c.partialPacks })),
    stationExtras: Object.fromEntries(progress.map(p => [p.stationType, p.extraPacks])),
    packsPerBatch,
    ovenBatches: completions.length - buildRows.length,
    packsStored: (item.fridgeQty ?? 0) + (item.freezerQty ?? 0)
      + ((item.fridgeEightPackQty ?? 0) + (item.freezerEightPackQty ?? 0)) * packsPerBag,
  };
  // A batch is one pack (mac cheese and the like): the screen counts packs
  // and has no separate extra-packs counter.
  const countsPacks = packsPerBatch === 1;
  return { item, state, buildRows, countsPacks };
}

function response(itemId: number, recipeName: string | null, state: BuildEditState, countsPacks: boolean) {
  return {
    itemId,
    recipeName,
    countsPacks,
    packsPerBatch: state.packsPerBatch,
    ovenBatches: state.ovenBatches,
    packsStored: state.packsStored,
    stationExtras: state.stationExtras,
    completions: state.completions.map(c => ({
      id: c.id,
      stationType: c.stationType,
      completedAt: c.completedAt instanceof Date ? c.completedAt.toISOString() : c.completedAt,
      partialPacks: c.partialPacks,
    })),
    numbers: buildNumbers(state),
  };
}

router.get("/:id/items/:itemId/building-edit", async (req: Request, res: Response) => {
  const params = Params.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid plan or item id" }); return; }
  const loaded = await loadState(db, params.data.id, params.data.itemId, false);
  if (!loaded) { res.status(404).json({ error: "Plan item not found" }); return; }
  res.json(response(params.data.itemId, loaded.item.recipeName, loaded.state, loaded.countsPacks));
});

class EditRefused extends Error {
  constructor(public status: number, message: string) { super(message); }
}

router.post("/:id/items/:itemId/building-edit", validate(BuildingEditBody), async (req: Request, res: Response) => {
  const params = Params.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid plan or item id" }); return; }
  const { id: planId, itemId } = params.data;
  const body = req.body as z.infer<typeof BuildingEditBody>;
  const userId = req.session.userId ?? null;
  const line = body.stationType;
  const lines = { batches: body.batchesLine ?? line, extraPacks: body.extraPacksLine ?? line };

  try {
    const result = await db.transaction(async (tx) => {
      const loaded = await loadState(tx, planId, itemId, true);
      if (!loaded) throw new EditRefused(404, "Plan item not found");
      if (loaded.item.planStatus === "draft") {
        throw new EditRefused(409, "This plan is still a draft — activate it before recording production.");
      }
      const { state, buildRows, countsPacks } = loaded;
      const unit = countsPacks ? PACK_WORDS : BATCH_WORDS;
      const before = buildNumbers(state);
      if (before.batches !== body.expected.batches || before.extraPacks !== body.expected.extraPacks) {
        throw new EditRefused(409, "The numbers changed while you were editing (the other line may have recorded something). Check them and save again.");
      }
      const target = { batches: body.batches, extraPacks: countsPacks ? before.extraPacks : body.extraPacks };
      const reason = editBlockReason(state, target, lines, unit);
      if (reason) throw new EditRefused(422, reason);

      const plan = planBuildEdit(state, target, lines);
      const summary = editSummary(
        { batches: before.batches, extraPacks: before.extraPacks },
        { batches: plan.after.batches, extraPacks: plan.after.extraPacks },
        unit,
        lines,
      );
      if (!summary) return { state, recipeName: loaded.item.recipeName, countsPacks, summary };

      if (plan.removeCompletionIds.length > 0) {
        await tx.delete(batchCompletionsTable).where(inArray(batchCompletionsTable.id, plan.removeCompletionIds));
      }
      let addedIds: number[] = [];
      if (plan.addBatches > 0) {
        const now = new Date();
        const inserted = await tx.insert(batchCompletionsTable).values(
          Array.from({ length: plan.addBatches }, () => ({
            planItemId: itemId,
            stationType: lines.batches,
            userId,
            completedAt: now,
            correctionByUserId: userId,
            correctionNote: "Added with Edit numbers on the building station",
          })),
        ).returning({ id: batchCompletionsTable.id });
        addedIds = inserted.map(r => r.id);
        // Same as recording a batch: the recipe is under way.
        await tx.update(productionPlanItemsTable)
          .set({ status: sql`CASE WHEN ${productionPlanItemsTable.status} = 'pending' THEN 'in-progress' ELSE ${productionPlanItemsTable.status} END` })
          .where(eq(productionPlanItemsTable.id, itemId));
      }
      for (const [station, delta] of Object.entries(plan.extrasDelta)) {
        if (!delta) continue;
        await tx.execute(sql`
          INSERT INTO building_station_progress (plan_item_id, station_type, extra_packs, updated_at)
          VALUES (${itemId}, ${station}, ${delta}, NOW())
          ON CONFLICT (plan_item_id, station_type)
          DO UPDATE SET extra_packs = building_station_progress.extra_packs + ${delta}, updated_at = NOW()
        `);
      }
      if (Object.keys(plan.extrasDelta).length > 0) await recomputeItemFromProgress(itemId, tx);

      const removed = buildRows
        .filter(c => plan.removeCompletionIds.includes(c.id))
        .map(c => ({ id: c.id, stationType: c.stationType, userId: c.userId, completedAt: c.completedAt.toISOString(), partialPacks: c.partialPacks }));
      await tx.insert(buildingCountEditsTable).values({
        planId,
        planItemId: itemId,
        recipeId: loaded.item.recipeId,
        stationType: line,
        userId,
        batchesBefore: before.batches,
        batchesAfter: plan.after.batches,
        extraPacksBefore: before.extraPacks,
        extraPacksAfter: plan.after.extraPacks,
        removedCompletions: removed,
        addedCompletionIds: addedIds,
        extrasDelta: plan.extrasDelta,
        summary,
      });

      const after = await loadState(tx, planId, itemId, false);
      return { state: after!.state, recipeName: loaded.item.recipeName, countsPacks, summary };
    });

    console.info("[building-edit]", JSON.stringify({ planId, itemId, line, lines, userId, summary: result.summary || "no change" }));
    res.json({ ...response(itemId, result.recipeName, result.state, result.countsPacks), summary: result.summary });
  } catch (err) {
    if (err instanceof EditRefused) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
