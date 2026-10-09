/**
 * PATCH /production-plans/:id/items/:itemId/extra-packs-built
 *   body { delta: 1 | -1, stationType?: 'building_1' | 'building_2' }
 *
 * One + / − tap on an "Extra packs" counter. Moved out of the frozen
 * routes/production-plans.ts (2026-10-09) and mounted ahead of it.
 *
 * Extras are stored per building line (building_station_progress); the
 * item's extra_packs_built is the sum, which ovens/wrapping/dispatch read.
 *   - The building lines' Pack Adjustment names its own line.
 *   - The oven station's Extra Packs counter names no line — before this
 *     move every oven tap got 400 "stationType must be building_1 or
 *     building_2" and the buttons looked dead (Graeme, 9 Oct 2026). The
 *     line is now chosen by planExtraPackTap (@workspace/building-edit,
 *     tested): + on the line that most recently recorded a batch of this
 *     recipe, − off the most recent line that actually holds loose packs.
 * Refused with the reason in words (422) when there's no loose pack to take
 * off, or when − would drop the pack total below what's already wrapped.
 * The item row is locked so two quick taps (or both lines at once) queue up.
 *
 * Not in the server PIN lock: a tap records no person, same as before.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, productionPlanItemsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { recomputeItemFromProgress } from "../lib/building-progress";
import { BUILDING_LINES, planExtraPackTap } from "@workspace/building-edit";
import { loadState } from "./building-edit";

const router: IRouter = Router();

const Params = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

export const ExtraPacksBody = z.object({
  delta: z.union([z.literal(1), z.literal(-1)]),
  stationType: z.enum(BUILDING_LINES).nullish(),
});

class TapRefused extends Error {
  constructor(public status: number, message: string) { super(message); }
}

router.patch("/:id/items/:itemId/extra-packs-built", validate(ExtraPacksBody), async (req: Request, res: Response) => {
  const params = Params.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid plan or item id" }); return; }
  const { id: planId, itemId } = params.data;
  const body = req.body as z.infer<typeof ExtraPacksBody>;

  try {
    const result = await db.transaction(async (tx) => {
      const loaded = await loadState(tx, planId, itemId, true);
      if (!loaded) throw new TapRefused(404, "Plan item not found");
      const tap = planExtraPackTap(loaded.state, body.delta, body.stationType ?? null);
      if (!tap.ok) throw new TapRefused(422, tap.reason);

      for (const [station, d] of Object.entries(tap.extrasDelta)) {
        if (!d) continue;
        await tx.execute(sql`
          INSERT INTO building_station_progress (plan_item_id, station_type, extra_packs, updated_at)
          VALUES (${itemId}, ${station}, ${d}, NOW())
          ON CONFLICT (plan_item_id, station_type)
          DO UPDATE SET extra_packs = building_station_progress.extra_packs + ${d}, updated_at = NOW()
        `);
      }
      await recomputeItemFromProgress(itemId, tx);

      const [line] = (await tx.execute(sql`
        SELECT extra_packs FROM building_station_progress
        WHERE plan_item_id = ${itemId} AND station_type = ${tap.line}
      `)).rows as { extra_packs: number }[];
      const [item] = await tx.select({ extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt })
        .from(productionPlanItemsTable)
        .where(eq(productionPlanItemsTable.id, itemId));
      return { line: tap.line, stationExtraPacks: line?.extra_packs ?? 0, extraPacksBuilt: item?.extraPacksBuilt ?? 0 };
    });

    res.json({
      itemId,
      stationType: result.line,
      stationExtraPacks: result.stationExtraPacks,
      extraPacksBuilt: result.extraPacksBuilt,
    });
  } catch (err) {
    if (err instanceof TapRefused) { res.status(err.status).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
