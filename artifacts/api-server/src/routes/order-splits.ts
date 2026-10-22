import { Router, type IRouter } from "express";
import * as z from "zod";
import { db, orderLineSplitsTable, ingredientsTable, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { cancelSplit, listSplits, splitTargetDate } from "../lib/order-splits";

// "Split with another supplier" on an Orders line (fix-queue #248 + #328,
// Jane Miles; Graeme approved 22 Oct 2026). Objective C. Anyone who can
// place orders can split and cancel — the same people as the Orders page.
//
//   GET  /order-splits/preview?targetSupplierId=  the day it would land on
//   GET  /order-splits?status=pending             splits waiting
//   POST /order-splits                            save a split
//   POST /order-splits/:id/cancel                 cancel before it's placed
const router: IRouter = Router();

const PreviewQuery = z.object({ targetSupplierId: z.coerce.number().int().positive() });

router.get("/preview", async (req, res) => {
  const q = PreviewQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "targetSupplierId is required" }); return; }
  const t = await splitTargetDate(q.data.targetSupplierId);
  if (!t.supplierName) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json({ targetSupplierId: q.data.targetSupplierId, targetSupplierName: t.supplierName, targetOrderDate: t.date });
});

const ListQuery = z.object({ status: z.enum(["pending", "placed", "cancelled"]).optional() });

router.get("/", async (req, res) => {
  const q = ListQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "status must be pending, placed or cancelled" }); return; }
  res.json(await listSplits({ status: q.data.status }));
});

const CreateSplitBody = z.object({
  ingredientId: z.number().int().positive(),
  packs: z.number().int().min(1).max(100000),
  fromSupplierId: z.number().int().positive(),
  fromPlanId: z.number().int().positive().nullable().optional(),
  targetSupplierId: z.number().int().positive(),
}).refine(b => b.fromSupplierId !== b.targetSupplierId, { message: "Pick a different supplier to split with" });

router.post("/", validate(CreateSplitBody), async (req, res) => {
  const body = req.body as z.infer<typeof CreateSplitBody>;
  if (body.fromSupplierId === body.targetSupplierId) {
    res.status(400).json({ error: "Pick a different supplier to split with" });
    return;
  }
  const [ing] = await db.select({ id: ingredientsTable.id }).from(ingredientsTable).where(eq(ingredientsTable.id, body.ingredientId));
  if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }
  const [from] = await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, body.fromSupplierId));
  if (!from) { res.status(404).json({ error: "Supplier not found" }); return; }

  const today = londonDateString();
  const target = await splitTargetDate(body.targetSupplierId, today);
  if (!target.supplierName) { res.status(404).json({ error: "Supplier not found" }); return; }
  if (!target.date) {
    res.status(409).json({ error: `${target.supplierName} has no order day in the next three weeks — check its order days on the supplier record.` });
    return;
  }

  const [row] = await db.insert(orderLineSplitsTable).values({
    ingredientId: body.ingredientId,
    packs: String(body.packs),
    fromSupplierId: body.fromSupplierId,
    fromPlanId: body.fromPlanId ?? null,
    fromOrderDate: today,
    targetSupplierId: body.targetSupplierId,
    targetOrderDate: target.date,
    status: "pending",
    createdByUserId: req.session.userId ?? null,
  }).returning({ id: orderLineSplitsTable.id });

  const [view] = await listSplits({ ids: [row.id] });
  res.status(201).json(view);
});

const CancelBody = z.object({}).passthrough();

router.post("/:id/cancel", validate(CancelBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid split id" }); return; }
  const result = await cancelSplit(id, req.session.userId ?? null);
  if (result === "not-found") { res.status(404).json({ error: "Split not found" }); return; }
  if (result === "already-placed") { res.status(409).json({ error: "That split is already on a placed order — it can't be cancelled here." }); return; }
  res.json({ ok: true, status: "cancelled" });
});

export default router;
