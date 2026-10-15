/**
 * Short-delivery report settings (Graeme, 2026-10-15). Objectives C and D.
 * Mounted at /api/deliveries/short-reports BEFORE the deliveries router, so
 * "short-reports" is never read as a purchase-order id by its GET /:id.
 *
 *   GET /settings   which team list gets the reports, and who always gets a
 *                   to-do + bell — anyone who can receive deliveries reads it
 *                   (the goods-in dialog pre-fills "Also tell…" from it)
 *   PUT /settings   change them (managers and admins)
 *
 * The reports themselves are made by lib/short-delivery-report.ts when
 * goods-in is completed (POST /api/deliveries/:id/receive).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { asc, isNull } from "drizzle-orm";
import { db, teamListsTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { requireFeature } from "../lib/feature-access";
import { readShortReportSettings, writeShortReportSettings } from "../lib/short-delivery-report";

const router: IRouter = Router();

// Same audience as receiving a delivery.
const canReceive = requireFeature("page.deliveries_receive");

const settingsBody = z.object({
  teamListId: z.number().int().positive().nullable(),
  recipientIds: z.array(z.number().int().positive()).max(100),
});

async function settingsResponse() {
  const settings = await readShortReportSettings();
  const lists = await db.select({ id: teamListsTable.id, name: teamListsTable.name })
    .from(teamListsTable)
    .where(isNull(teamListsTable.archivedAt))
    .orderBy(asc(teamListsTable.sortOrder), asc(teamListsTable.name));
  const current = lists.find(l => l.id === settings.teamListId) ?? null;
  return { ...settings, teamListName: current?.name ?? null, teamLists: lists };
}

router.get("/settings", canReceive, async (_req: Request, res: Response) => {
  res.json(await settingsResponse());
});

router.put("/settings", requireManagerOrAdmin, validate(settingsBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof settingsBody>;
  await writeShortReportSettings({ teamListId: body.teamListId, recipientIds: [...new Set(body.recipientIds)] });
  res.json(await settingsResponse());
});

export default router;
