// Collections — goods leaving the unit, the mirror of a delivery.
//
// A driver arrives to collect something (returnable containers, equipment going
// for repair, samples). The team ticks off what's actually handed over, takes
// the driver's signature on the iPad, and optionally photographs the items with
// the driver or in the vehicle.
//
// Two rules drive the UI, both enforced here rather than only in the browser:
//   1. A collection sharing a supplier + date with a scheduled purchase order
//      belongs to that delivery. Derived at query time, never stored — moving
//      the delivery to another day detaches the collection cleanly.
//   2. While a collection is outstanding, its delivery cannot be received. The
//      collection is the thing most easily forgotten once the driver has gone.
//
// Signature and photo are bytea, matching improvement attachments and the
// Documents PDFs.

import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import {
  db,
  collectionsTable,
  collectionLinesTable,
  suppliersTable,
  usersTable,
  purchaseOrdersTable,
} from "@workspace/db";
import { eq, and, gte, lte, inArray, asc, desc, ne } from "drizzle-orm";
import * as z from "zod";

const router: IRouter = Router();

// Signatures are a few KB; a phone photo can be several MB. 15MB matches the
// Documents upload cap.
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

async function sessionUser(req: Request) {
  const userId = req.session?.userId ?? null;
  if (!userId) return { id: null as number | null, name: null as string | null };
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return { id: userId, name: u?.name ?? null };
}

/** A collection still needing to be handed over. Cancelled ones don't block. */
function isOutstanding(status: string): boolean {
  return status === "scheduled";
}

/**
 * Collections blocking a given purchase order's receive, matched on supplier +
 * date. Exported so the deliveries route can enforce the same rule without
 * duplicating the join.
 */
export async function outstandingCollectionsForOrder(purchaseOrderId: number) {
  const [order] = await db
    .select({
      supplierId: purchaseOrdersTable.supplierId,
      expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate,
    })
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, purchaseOrderId));

  if (!order?.expectedDeliveryDate) return [];

  return db
    .select({
      id: collectionsTable.id,
      reference: collectionsTable.reference,
      status: collectionsTable.status,
    })
    .from(collectionsTable)
    .where(
      and(
        eq(collectionsTable.supplierId, order.supplierId),
        eq(collectionsTable.collectionDate, order.expectedDeliveryDate),
        eq(collectionsTable.status, "scheduled"),
      ),
    );
}

async function loadLines(collectionIds: number[]) {
  if (collectionIds.length === 0) return new Map<number, any[]>();
  const rows = await db
    .select()
    .from(collectionLinesTable)
    .where(inArray(collectionLinesTable.collectionId, collectionIds))
    .orderBy(asc(collectionLinesTable.sortOrder), asc(collectionLinesTable.id));

  const byCollection = new Map<number, any[]>();
  for (const r of rows) {
    const list = byCollection.get(r.collectionId) ?? [];
    list.push({
      ...r,
      quantity: Number(r.quantity),
      quantityCollected: r.quantityCollected != null ? Number(r.quantityCollected) : null,
    });
    byCollection.set(r.collectionId, list);
  }
  return byCollection;
}

/** Shape returned to the UI. Blobs are never inlined — they're fetched from
 *  their own endpoints so the weekly view stays small. */
function serialise(c: any, supplierName: string | null, lines: any[]) {
  return {
    id: c.id,
    supplierId: c.supplierId,
    supplierName,
    collectionDate: c.collectionDate,
    status: c.status,
    reference: c.reference,
    notes: c.notes,
    driverName: c.driverName,
    hasSignature: !!c.signatureMime,
    hasPhoto: !!c.photoMime,
    collectedAt: c.collectedAt,
    collectedByName: c.collectedByName,
    createdAt: c.createdAt,
    lines,
    outstanding: isOutstanding(c.status),
  };
}

// ── List collections in a date range ───────────────────────────────────────
// The weekly deliveries view calls this with the same Mon–Sun window it uses
// for orders, then groups client-side.
router.get("/", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;

  const filters = [];
  if (from) filters.push(gte(collectionsTable.collectionDate, from));
  if (to) filters.push(lte(collectionsTable.collectionDate, to));

  const rows = await db
    .select({
      c: collectionsTable,
      supplierName: suppliersTable.name,
    })
    .from(collectionsTable)
    .leftJoin(suppliersTable, eq(collectionsTable.supplierId, suppliersTable.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(collectionsTable.collectionDate), asc(suppliersTable.name));

  const linesByCollection = await loadLines(rows.map(r => r.c.id));
  res.json(rows.map(r => serialise(r.c, r.supplierName, linesByCollection.get(r.c.id) ?? [])));
});

// ── Single collection ──────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({ c: collectionsTable, supplierName: suppliersTable.name })
    .from(collectionsTable)
    .leftJoin(suppliersTable, eq(collectionsTable.supplierId, suppliersTable.id))
    .where(eq(collectionsTable.id, id));

  if (!row) { res.status(404).json({ error: "Collection not found" }); return; }
  const lines = (await loadLines([id])).get(id) ?? [];
  res.json(serialise(row.c, row.supplierName, lines));
});

// ── Create ─────────────────────────────────────────────────────────────────
const LineInput = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().min(0).default(1),
  unit: z.string().trim().max(30).default("items"),
  notes: z.string().trim().max(500).optional(),
});

const CreateCollection = z.object({
  supplierId: z.number().int(),
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "collectionDate must be YYYY-MM-DD"),
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(LineInput).min(1, "A collection needs at least one item"),
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = CreateCollection.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  const [supplier] = await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, d.supplierId));
  if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }

  const [created] = await db.insert(collectionsTable).values({
    supplierId: d.supplierId,
    collectionDate: d.collectionDate,
    reference: d.reference || null,
    notes: d.notes || null,
  }).returning();

  await db.insert(collectionLinesTable).values(
    d.lines.map((l, i) => ({
      collectionId: created.id,
      description: l.description,
      quantity: String(l.quantity),
      unit: l.unit || "items",
      notes: l.notes || null,
      sortOrder: i,
    })),
  );

  const lines = (await loadLines([created.id])).get(created.id) ?? [];
  res.json(serialise(created, null, lines));
});

// ── Edit header / lines while still scheduled ──────────────────────────────
const UpdateCollection = z.object({
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["scheduled", "cancelled"]).optional(),
  lines: z.array(LineInput).optional(),
});

router.patch("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateCollection.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }

  const [existing] = await db.select().from(collectionsTable).where(eq(collectionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Collection not found" }); return; }
  // A completed collection carries a signature against a specific item list —
  // editing it afterwards would make that signature evidence for something the
  // driver never signed for.
  if (existing.status === "collected") {
    res.status(409).json({ error: "This collection is already signed for and can't be edited." });
    return;
  }

  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.collectionDate !== undefined) patch.collectionDate = d.collectionDate;
  if (d.reference !== undefined) patch.reference = d.reference || null;
  if (d.notes !== undefined) patch.notes = d.notes || null;
  if (d.status !== undefined) patch.status = d.status;

  if (Object.keys(patch).length > 0) {
    await db.update(collectionsTable).set(patch).where(eq(collectionsTable.id, id));
  }

  if (d.lines) {
    await db.delete(collectionLinesTable).where(eq(collectionLinesTable.collectionId, id));
    await db.insert(collectionLinesTable).values(
      d.lines.map((l, i) => ({
        collectionId: id,
        description: l.description,
        quantity: String(l.quantity),
        unit: l.unit || "items",
        notes: l.notes || null,
        sortOrder: i,
      })),
    );
  }

  const [updated] = await db.select().from(collectionsTable).where(eq(collectionsTable.id, id));
  const lines = (await loadLines([id])).get(id) ?? [];
  res.json(serialise(updated, null, lines));
});

// ── Tick a line off as it's handed over ────────────────────────────────────
router.patch("/lines/:lineId", async (req: Request, res: Response) => {
  const lineId = Number(req.params.lineId);
  if (!Number.isFinite(lineId)) { res.status(400).json({ error: "Invalid line id" }); return; }

  const parsed = z.object({
    checkedOff: z.boolean().optional(),
    quantityCollected: z.number().min(0).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.checkedOff !== undefined) patch.checkedOff = parsed.data.checkedOff;
  if (parsed.data.quantityCollected !== undefined) {
    patch.quantityCollected = parsed.data.quantityCollected == null ? null : String(parsed.data.quantityCollected);
  }
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes || null;

  const [updated] = await db
    .update(collectionLinesTable)
    .set(patch)
    .where(eq(collectionLinesTable.id, lineId))
    .returning();

  if (!updated) { res.status(404).json({ error: "Line not found" }); return; }
  res.json({ ...updated, quantity: Number(updated.quantity), quantityCollected: updated.quantityCollected != null ? Number(updated.quantityCollected) : null });
});

// ── Complete: every line ticked + driver name + signature ──────────────────
// multipart, because the signature PNG and the optional photo come as files.
// Enforced server-side so a collection can never be closed without the
// evidence the whole feature exists to capture.
router.post(
  "/:id/complete",
  imageUpload.fields([{ name: "signature", maxCount: 1 }, { name: "photo", maxCount: 1 }]),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [existing] = await db.select().from(collectionsTable).where(eq(collectionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Collection not found" }); return; }
    if (existing.status === "collected") {
      res.status(409).json({ error: "This collection has already been signed for." });
      return;
    }

    const driverName = typeof req.body?.driverName === "string" ? req.body.driverName.trim() : "";
    if (driverName.length < 2) {
      res.status(400).json({ error: "The driver's name is required." });
      return;
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const signature = files?.signature?.[0];
    if (!signature) {
      res.status(400).json({ error: "The driver's signature is required." });
      return;
    }
    if (!signature.mimetype.startsWith("image/")) {
      res.status(400).json({ error: "Signature must be an image." });
      return;
    }

    const photo = files?.photo?.[0];
    if (photo && !photo.mimetype.startsWith("image/")) {
      res.status(400).json({ error: "Photo must be an image." });
      return;
    }

    // Every line must be ticked — a part-handed-over collection is a different
    // thing from a completed one, and signing for it would misrepresent what
    // left the building.
    const lines = await db.select().from(collectionLinesTable).where(eq(collectionLinesTable.collectionId, id));
    const unticked = lines.filter(l => !l.checkedOff);
    if (unticked.length > 0) {
      res.status(400).json({
        error: `${unticked.length} item${unticked.length === 1 ? "" : "s"} still to tick off before the driver signs.`,
        untickedIds: unticked.map(l => l.id),
      });
      return;
    }

    const user = await sessionUser(req);
    const [updated] = await db.update(collectionsTable).set({
      status: "collected",
      driverName,
      signatureBlob: signature.buffer,
      signatureMime: signature.mimetype,
      ...(photo ? { photoBlob: photo.buffer, photoMime: photo.mimetype } : {}),
      collectedAt: new Date(),
      collectedByUserId: user.id,
      collectedByName: user.name,
    }).where(eq(collectionsTable.id, id)).returning();

    const outLines = (await loadLines([id])).get(id) ?? [];
    res.json(serialise(updated, null, outLines));
  },
);

// ── Serve the captured images ──────────────────────────────────────────────
router.get("/:id/signature", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .select({ blob: collectionsTable.signatureBlob, mime: collectionsTable.signatureMime })
    .from(collectionsTable)
    .where(eq(collectionsTable.id, id));
  if (!row?.blob || !row.mime) { res.status(404).json({ error: "No signature on this collection" }); return; }
  res.setHeader("Content-Type", row.mime);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.send(row.blob);
});

router.get("/:id/photo", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .select({ blob: collectionsTable.photoBlob, mime: collectionsTable.photoMime })
    .from(collectionsTable)
    .where(eq(collectionsTable.id, id));
  if (!row?.blob || !row.mime) { res.status(404).json({ error: "No photo on this collection" }); return; }
  res.setHeader("Content-Type", row.mime);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.send(row.blob);
});

// ── Delete (only while scheduled) ──────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select({ status: collectionsTable.status }).from(collectionsTable).where(eq(collectionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Collection not found" }); return; }
  if (existing.status === "collected") {
    res.status(409).json({ error: "A signed-for collection is a record of what left the building — cancel it instead of deleting it." });
    return;
  }
  await db.delete(collectionsTable).where(eq(collectionsTable.id, id));
  res.json({ ok: true });
});

export default router;
