/**
 * A supplier's payment terms and the other names on their invoices
 * (Graeme, 10 Nov 2026; migration 0365). Objective I. Edited from the
 * supplier's Edit dialog, each change saved on its own; read by the Finance
 * Inbox (lib/finance/invoice-queue.ts) to say how an invoice is paid.
 *
 *   GET    /api/suppliers/:id/payment
 *   PUT    /api/suppliers/:id/payment-terms         { paymentTerms }
 *   POST   /api/suppliers/:id/invoice-names         { name }
 *   DELETE /api/suppliers/:id/invoice-names/:nameId
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, supplierInvoiceNamesTable, suppliersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";

const router: IRouter = Router();

const idOf = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function payment(supplierId: number) {
  const [s] = await db.select({ id: suppliersTable.id, paymentTerms: suppliersTable.paymentTerms })
    .from(suppliersTable).where(eq(suppliersTable.id, supplierId));
  if (!s) return null;
  const invoiceNames = await db.select({ id: supplierInvoiceNamesTable.id, name: supplierInvoiceNamesTable.name })
    .from(supplierInvoiceNamesTable).where(eq(supplierInvoiceNamesTable.supplierId, supplierId))
    .orderBy(asc(supplierInvoiceNamesTable.name));
  return { supplierId: s.id, paymentTerms: s.paymentTerms, invoiceNames };
}

router.get("/:id/payment", async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const p = id ? await payment(id) : null;
  if (!p) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json(p);
});

const TermsBody = z.object({ paymentTerms: z.enum(["paid_when_ordered", "on_account"]) }).strict();

router.put("/:id/payment-terms", requireManagerOrAdmin, validate(TermsBody), async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) { res.status(400).json({ error: "Bad supplier id" }); return; }
  const { paymentTerms } = req.body as z.infer<typeof TermsBody>;
  const done = await db.update(suppliersTable).set({ paymentTerms }).where(eq(suppliersTable.id, id)).returning({ id: suppliersTable.id });
  if (done.length === 0) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json(await payment(id));
});

const NameBody = z.object({ name: z.string().trim().min(2, "Type the name as it's on their invoices").max(200) }).strict();

router.post("/:id/invoice-names", requireManagerOrAdmin, validate(NameBody), async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id || !(await payment(id))) { res.status(404).json({ error: "Supplier not found" }); return; }
  const { name } = req.body as z.infer<typeof NameBody>;
  const [taken] = await db.select({ supplierName: suppliersTable.name })
    .from(supplierInvoiceNamesTable)
    .innerJoin(suppliersTable, eq(suppliersTable.id, supplierInvoiceNamesTable.supplierId))
    .where(sql`lower(${supplierInvoiceNamesTable.name}) = lower(${name})`);
  if (taken) {
    res.status(409).json({ error: `"${name}" is already linked to ${taken.supplierName.trim()}.` });
    return;
  }
  await db.insert(supplierInvoiceNamesTable).values({ supplierId: id, name, createdBy: req.session.userId ?? null });
  res.json(await payment(id));
});

router.delete("/:id/invoice-names/:nameId", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const nameId = idOf(req.params.nameId);
  if (!id || !nameId) { res.status(400).json({ error: "Bad id" }); return; }
  await db.delete(supplierInvoiceNamesTable)
    .where(and(eq(supplierInvoiceNamesTable.id, nameId), eq(supplierInvoiceNamesTable.supplierId, id)));
  const p = await payment(id);
  if (!p) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json(p);
});

export default router;
