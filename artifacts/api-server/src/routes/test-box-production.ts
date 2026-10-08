/**
 * Test-box production from sales (Graeme, 2026-10-08). Objectives A and C.
 *
 *   GET  /api/test-boxes/:id/deliveries/:deliveryId/production
 *        ?refresh=1   fetch the newest orders from Shopify first (READ only)
 *        ?safety=0|1  preview with / without the +1 safety batch
 *        What queueing would do now: packs sold per recipe for this delivery
 *        date → calzones → batches, what's queued already, blockers (drafts)
 *        and warnings. Read only — the card shows it before anything is
 *        queued, and the close confirmation repeats it.
 *   POST /api/test-boxes/:id/deliveries/:deliveryId/production
 *        { safetyBatch? }  "Recount from sales" on a closed / queued
 *        delivery: re-count and bring its Queued production rows in step
 *        (update in place, never duplicate). Closing orders does the same
 *        automatically (routes/test-boxes.ts → closeAndQueue).
 *
 * Rules: lib/test-box-production.ts (pure, tested); database side:
 * lib/test-box-production-data.ts. Same door as the rest of Test boxes.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, testBoxesTable, testBoxDeliveriesTable, usersTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { syncTestBox } from "../lib/test-box-data";
import {
  mirrorFromDate, productionPreview, queueFromSales, refreshOrdersMirror,
} from "../lib/test-box-production-data";

const router: IRouter = Router();
router.use("/:id/deliveries/:deliveryId/production", requireFounderArea("founder.sales"));

function ids(req: Request): { id: number; deliveryId: number } | null {
  const id = Number(req.params["id"]);
  const deliveryId = Number(req.params["deliveryId"]);
  return Number.isInteger(id) && id > 0 && Number.isInteger(deliveryId) && deliveryId > 0 ? { id, deliveryId } : null;
}

async function load(id: number, deliveryId: number) {
  const [box] = await db.select().from(testBoxesTable).where(and(eq(testBoxesTable.id, id), isNull(testBoxesTable.deletedAt)));
  if (!box) return null;
  const [delivery] = await db.select().from(testBoxDeliveriesTable)
    .where(and(eq(testBoxDeliveriesTable.id, deliveryId), eq(testBoxDeliveriesTable.testBoxId, id), isNull(testBoxDeliveriesTable.deletedAt)));
  return delivery ? { box, delivery } : null;
}

const PreviewQuery = z.object({
  refresh: z.enum(["0", "1"]).optional(),
  safety: z.enum(["0", "1"]).optional(),
});

router.get("/:id/deliveries/:deliveryId/production", async (req: Request, res: Response) => {
  const p = ids(req);
  const q = PreviewQuery.safeParse(req.query);
  if (!p || !q.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const found = await load(p.id, p.deliveryId);
  if (!found) { res.status(404).json({ error: "Delivery date not found (it may have been removed)" }); return; }
  const refreshError = q.data.refresh === "1" ? await refreshOrdersMirror(mirrorFromDate(found.box)) : null;
  const preview = await productionPreview(db, found.box, found.delivery, {
    ...(q.data.safety !== undefined ? { safetyBatch: q.data.safety === "1" } : {}),
    refreshError,
  });
  res.json({ preview });
});

const QueueBody = z.object({ safetyBatch: z.boolean().optional() });

router.post("/:id/deliveries/:deliveryId/production", validate(QueueBody), async (req: Request, res: Response) => {
  const p = ids(req);
  if (!p) { res.status(400).json({ error: "Invalid id" }); return; }
  const { safetyBatch } = req.body as z.infer<typeof QueueBody>;
  const uid = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, uid));
  const user = { id: uid, name: u?.name ?? "Someone" };
  const found = await load(p.id, p.deliveryId);
  if (!found) { res.status(404).json({ error: "Delivery date not found (it may have been removed)" }); return; }
  const refreshError = await refreshOrdersMirror(mirrorFromDate(found.box));

  const r = await db.transaction(async (tx) => {
    const [box] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, p.id)).for("update");
    if (!box || box.deletedAt) return { status: 404 as const };
    const [delivery] = await tx.select().from(testBoxDeliveriesTable)
      .where(and(eq(testBoxDeliveriesTable.id, p.deliveryId), eq(testBoxDeliveriesTable.testBoxId, p.id), isNull(testBoxDeliveriesTable.deletedAt)));
    if (!delivery) return { status: 404 as const };
    if (delivery.status !== "closed" && delivery.status !== "queued") return { status: 409 as const, status_: delivery.status };
    const result = await queueFromSales(tx, box, delivery, user, { safetyBatch });
    if (result.ok) {
      await tx.update(testBoxesTable).set({ updatedById: user.id, updatedByName: user.name, updatedAt: new Date() }).where(eq(testBoxesTable.id, box.id));
      await syncTestBox(tx, box.id, user);
    }
    return { status: 200 as const, result };
  });
  if (r.status === 404) { res.status(404).json({ error: "Delivery date not found (it may have been removed)" }); return; }
  if (r.status === 409) { res.status(409).json({ error: "Close orders for this date first — production is queued from the sales once orders are closed." }); return; }
  const { result } = r;
  if (!result.ok) {
    res.status(409).json({
      error: `Put ${result.preview.blockers.map(b => b.name).join(", ")} on the menu first — a draft can't go on a production plan.`,
      code: "DRAFT_RECIPES", preview: result.preview,
    });
    return;
  }
  if (refreshError) result.preview.warnings.push("Couldn't fetch the newest orders from Shopify — counted from the last synced copy.");
  res.json({ preview: result.preview, queued: result.queued });
});

export default router;
