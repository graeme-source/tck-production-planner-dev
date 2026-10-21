import { Router, type IRouter } from "express";
import { db, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateSupplierBody, UpdateSupplierBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
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
// The supplier's account manager (Graeme, 2026-10-16; migration 0198) —
// short-shelf-life reports from goods-in are emailed here. "" clears.
const accountManagerNameField = z.string().trim().max(200).nullish().transform(v => (v ? v : v === undefined ? undefined : null));
const accountManagerEmailField = z
  .string()
  .trim()
  .max(320)
  .refine(v => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Account manager email doesn't look like an email address")
  .nullish()
  .transform(v => (v ? v : v === undefined ? undefined : null));
// Our account number with the supplier (Graeme, 2026-10-21; migration
// 0213) — quoted near the top of the goods-in issue email. Kept as typed
// (trimmed); "" / null clears.
const accountNumberField = z.string().trim().max(100).nullish().transform(v => (v ? v : v === undefined ? undefined : null));
const extraSupplierFields = {
  minimumOrderValue: minimumOrderValueField,
  accountManagerName: accountManagerNameField,
  accountManagerEmail: accountManagerEmailField,
  accountNumber: accountNumberField,
};
const AccountNumberBody = z.object({ accountNumber: accountNumberField });
const CreateSupplierBodyWithMinimum = CreateSupplierBody.extend(extraSupplierFields);
const UpdateSupplierBodyWithMinimum = UpdateSupplierBody.extend(extraSupplierFields);

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
  const { name, contactName, email, phone, orderingPhone, website, address, notes, orderFrequency, orderDays, leadTimeDays, cutoffTime, invoiceNotRequired, minimumOrderValue, accountManagerName, accountManagerEmail, accountNumber } = req.body;
  const [row] = await db.insert(suppliersTable).values({ name, contactName, email, phone, orderingPhone: orderingPhone || null, website, address, notes, orderFrequency: orderFrequency ?? "daily", orderDays: orderDays || null, leadTimeDays: leadTimeDays ?? 1, cutoffTime: cutoffTime || "17:00", invoiceNotRequired: invoiceNotRequired === true, minimumOrderValue: minimumForDb(minimumOrderValue), accountManagerName: accountManagerName ?? null, accountManagerEmail: accountManagerEmail ?? null, accountNumber: accountNumber ?? null }).returning();
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
  const { name, contactName, email, phone, orderingPhone, website, address, notes, orderFrequency, orderDays, leadTimeDays, cutoffTime, invoiceNotRequired, minimumOrderValue, accountManagerName, accountManagerEmail } = req.body;
  const [row] = await db.update(suppliersTable).set({ ...(accountManagerName !== undefined ? { accountManagerName } : {}), ...(accountManagerEmail !== undefined ? { accountManagerEmail } : {}), name, contactName, email, phone, ...(orderingPhone !== undefined ? { orderingPhone: orderingPhone || null } : {}), website, address, notes, ...(orderFrequency !== undefined ? { orderFrequency } : {}), ...(orderDays !== undefined ? { orderDays: orderDays || null } : {}), ...(leadTimeDays !== undefined && leadTimeDays !== null ? { leadTimeDays } : {}), ...(cutoffTime !== undefined && cutoffTime !== null ? { cutoffTime } : {}), ...(invoiceNotRequired !== undefined ? { invoiceNotRequired: invoiceNotRequired === true } : {}), ...(minimumOrderValue !== undefined ? { minimumOrderValue: minimumForDb(minimumOrderValue) } : {}) }).where(eq(suppliersTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

// The account number on its own, autosaved from the supplier record — the
// full PUT rewrites every field, so a one-field autosave can't use it.
router.patch("/:id/account-number", requireManagerOrAdmin, validate(AccountNumberBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Bad supplier id" }); return; }
  const accountNumber = (req.body as { accountNumber?: string | null }).accountNumber ?? null;
  const [row] = await db.update(suppliersTable).set({ accountNumber }).where(eq(suppliersTable.id, id))
    .returning({ id: suppliersTable.id, accountNumber: suppliersTable.accountNumber });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(suppliersTable).where(eq(suppliersTable.id, id));
  res.status(204).send();
});

export default router;
