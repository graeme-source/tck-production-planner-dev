import { Router, type IRouter } from "express";
import { db, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateSupplierBody, UpdateSupplierBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import * as z from "zod";

const router: IRouter = Router();

// Minimum order spend in £ (Graeme, 2026-10-01). null / "" clears it (no
// minimum). The generated spec doesn't know the field yet, so it's added
// here — validated, not just passed through.
const minimumOrderValueField = z
  .union([z.number(), z.string().trim()])
  .transform((v, ctx) => {
    if (v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Minimum order value must be between £0 and £100,000" });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  })
  .nullish();
const CreateSupplierBodyWithMinimum = CreateSupplierBody.extend({ minimumOrderValue: minimumOrderValueField });
const UpdateSupplierBodyWithMinimum = UpdateSupplierBody.extend({ minimumOrderValue: minimumOrderValueField });

/** "75.00" → 75; null stays null (numeric columns come back as strings). */
function moneyOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRow(r: typeof suppliersTable.$inferSelect) {
  return { ...r, minimumOrderValue: moneyOrNull(r.minimumOrderValue), createdAt: r.createdAt.toISOString() };
}

/** null/0 both mean "no minimum" — store NULL so the Orders page has one test. */
function minimumForDb(v: number | null | undefined): string | null {
  return v != null && v > 0 ? v.toFixed(2) : null;
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(suppliersTable).orderBy(suppliersTable.name);
  res.json(rows.map(mapRow));
});

router.post("/", validate(CreateSupplierBodyWithMinimum), async (req, res) => {
  const { name, contactName, email, phone, orderingPhone, website, address, notes, orderFrequency, orderDays, leadTimeDays, cutoffTime, invoiceNotRequired, minimumOrderValue } = req.body;
  const [row] = await db.insert(suppliersTable).values({ name, contactName, email, phone, orderingPhone: orderingPhone || null, website, address, notes, orderFrequency: orderFrequency ?? "daily", orderDays: orderDays || null, leadTimeDays: leadTimeDays ?? 1, cutoffTime: cutoffTime || "17:00", invoiceNotRequired: invoiceNotRequired === true, minimumOrderValue: minimumForDb(minimumOrderValue) }).returning();
  res.status(201).json(mapRow(row));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.put("/:id", validate(UpdateSupplierBodyWithMinimum), async (req, res) => {
  const id = Number(req.params.id);
  const { name, contactName, email, phone, orderingPhone, website, address, notes, orderFrequency, orderDays, leadTimeDays, cutoffTime, invoiceNotRequired, minimumOrderValue } = req.body;
  const [row] = await db.update(suppliersTable).set({ name, contactName, email, phone, ...(orderingPhone !== undefined ? { orderingPhone: orderingPhone || null } : {}), website, address, notes, ...(orderFrequency !== undefined ? { orderFrequency } : {}), ...(orderDays !== undefined ? { orderDays: orderDays || null } : {}), ...(leadTimeDays !== undefined && leadTimeDays !== null ? { leadTimeDays } : {}), ...(cutoffTime !== undefined && cutoffTime !== null ? { cutoffTime } : {}), ...(invoiceNotRequired !== undefined ? { invoiceNotRequired: invoiceNotRequired === true } : {}), ...(minimumOrderValue !== undefined ? { minimumOrderValue: minimumForDb(minimumOrderValue) } : {}) }).where(eq(suppliersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(suppliersTable).where(eq(suppliersTable.id, id));
  res.status(204).send();
});

export default router;
