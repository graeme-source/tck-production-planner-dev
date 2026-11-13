import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import { eq, sql } from "drizzle-orm";
import { db, finInvoiceLinesTable, finInvoicesTable, suppliersTable } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";
import { resolveFinanceAccess } from "./finance";
import {
  deliveryLines, forgetMatches, kickLineReader, matchAllSuppliers, nativeReceived, pendingLineReads, rereadInvoiceLines,
  type SupplierMatchBundle,
} from "../lib/finance/delivery-match-store";
import { needsALook, type InvoiceMatch } from "../lib/finance/delivery-matching";

// Finance → Deliveries (Graeme, 13 Nov 2026): every goods-in delivery as a
// delivery note, and — for the suppliers ticked — which invoice it was for,
// with gentle warnings for invoices that have had no delivery for far longer
// than usual. Same access as the rest of Finance. Objectives F and I.

const router: IRouter = Router();

async function requireFinanceAccess(req: Request, res: Response, next: NextFunction) {
  if (await resolveFinanceAccess(req)) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
}
router.use(requireFinanceAccess);

interface InvoiceBrief { id: number; number: string | null; date: string; total: number | null; supplierName: string | null }

function briefs(bundles: SupplierMatchBundle[]): Map<number, InvoiceBrief> {
  return new Map(bundles.flatMap((b) => b.invoices.map((i) => [i.id, {
    id: i.id, number: i.invoiceNumber, date: i.invoiceDate, total: i.totalAmount != null ? Number(i.totalAmount) : null, supplierName: i.supplierName,
  }] as const)));
}

/** A match as the screens show it: names and units on the differences, the twin and the delivery date. */
async function describe(bundles: SupplierMatchBundle[], m: InvoiceMatch, inv: Map<number, InvoiceBrief>) {
  const b = bundles.find((x) => x.invoices.some((i) => i.id === m.invoiceId))!;
  const delivery = m.deliveryId != null ? b.deliveries.find((d) => d.id === m.deliveryId) ?? null : null;
  let differences: { name: string; invoiced: number; received: number; unit: string }[] = [];
  if (m.differences.length) {
    const ids = m.differences.map((d) => d.ingredientId);
    const rows = ((await db.execute(sql`SELECT id, name, unit FROM ingredients WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`) as any).rows) as { id: number; name: string; unit: string }[];
    differences = m.differences.map((d) => {
      const r = rows.find((x) => x.id === d.ingredientId);
      return { name: r?.name ?? "Item", unit: r?.unit ?? "", invoiced: Math.round(d.invoiced * 100) / 100, received: Math.round(d.received * 100) / 100 };
    });
  }
  return {
    invoiceId: m.invoiceId, supplierId: b.supplierId, status: m.status, needsALook: needsALook(m),
    deliveryId: m.deliveryId, deliveryDate: delivery?.date ?? null, gapDays: m.gapDays, ageDays: m.ageDays,
    lateAfterDays: b.result.profile.lateAfterDays, differences, unusualAmount: m.unusualAmount,
    sameAs: m.sameAsInvoiceId != null ? inv.get(m.sameAsInvoiceId) ?? null : null,
  };
}

/** Status for every checked invoice, for the Invoices library and Outstanding. */
router.get("/invoice-status", async (_req, res) => {
  const bundles = await matchAllSuppliers();
  const inv = briefs(bundles);
  const out: Record<number, Awaited<ReturnType<typeof describe>>> = {};
  for (const b of bundles) for (const m of b.result.invoices) out[m.invoiceId] = await describe(bundles, m, inv);
  res.json(out);
});

const ListQuery = z.object({
  days: z.coerce.number().int().min(1).max(400).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
});

router.get("/", validateQuery(ListQuery), async (req, res) => {
  const { days = 30, supplierId } = ListQuery.parse(req.query);
  const [bundles, suppliers, reading] = await Promise.all([
    matchAllSuppliers(),
    db.select({ id: suppliersTable.id, name: suppliersTable.name, enabled: suppliersTable.matchInvoicesToDeliveries }).from(suppliersTable),
    pendingLineReads(),
  ]);
  const inv = briefs(bundles);

  const notes = ((await db.execute(sql`
    SELECT d.id, d.supplier_id AS "supplierId", s.name AS "supplierName", d.received_at AS "receivedAt",
           u.name AS "receivedBy", d.chilled_temp_c::float AS "chilledTempC", d.frozen_temp_c::float AS "frozenTempC",
           d.notes, d.purchase_order_id AS "purchaseOrderId"
      FROM delivery_records d
      JOIN suppliers s ON s.id = d.supplier_id
      LEFT JOIN app_users u ON u.id = d.received_by_user_id
     WHERE d.received_at >= NOW() - (${days} * INTERVAL '1 day')
       ${supplierId ? sql`AND d.supplier_id = ${supplierId}` : sql``}
     ORDER BY d.received_at DESC
     LIMIT 500
  `) as any).rows) as { id: number; supplierId: number; supplierName: string; receivedAt: string; receivedBy: string | null; chilledTempC: number | null; frozenTempC: number | null; notes: string | null; purchaseOrderId: number | null }[];
  const lines = await deliveryLines(notes.map((n) => n.id));
  const invoiceFor = new Map<number, number | null>();
  for (const b of bundles) for (const [d, i] of Object.entries(b.result.deliveryInvoice)) invoiceFor.set(Number(d), i);
  const statusOf = new Map(bundles.flatMap((b) => b.result.invoices.map((m) => [m.invoiceId, m.status] as const)));
  const checked = new Set(bundles.map((b) => b.supplierId));

  const toLook = [];
  for (const b of bundles) {
    if (supplierId && b.supplierId !== supplierId) continue;
    for (const m of b.result.invoices) if (needsALook(m)) toLook.push({ invoice: inv.get(m.invoiceId)!, match: await describe(bundles, m, inv) });
  }
  toLook.sort((a, b) => b.invoice.date.localeCompare(a.invoice.date));

  const ratioIds = [...new Set(bundles.flatMap((b) => Object.keys(b.result.profile.usualRatios).map(Number)))];
  const ratioNames = ratioIds.length
    ? ((await db.execute(sql`SELECT id, name FROM ingredients WHERE id IN (${sql.join(ratioIds.map((id) => sql`${id}`), sql`, `)})`) as any).rows) as { id: number; name: string }[]
    : [];

  res.json({
    reading,
    suppliers: suppliers
      .filter((s) => s.enabled || notes.some((n) => n.supplierId === s.id))
      .map((s) => {
        const b = bundles.find((x) => x.supplierId === s.id);
        const counts = b ? {
          matched: b.result.invoices.filter((m) => m.status === "matched" || m.status === "matched_by_date").length,
          waiting: b.result.invoices.filter((m) => m.status === "waiting").length,
          toLook: b.result.invoices.filter(needsALook).length,
        } : null;
        const ratios = b ? Object.entries(b.result.profile.usualRatios).map(([id, ratio]) => ({
          name: ratioNames.find((r) => r.id === Number(id))?.name ?? "Item", ratio,
        })) : [];
        return {
          id: s.id, name: s.name, enabled: s.enabled, counts, ratios,
          typicalGapDays: b?.result.profile.typicalGapDays ?? null, lateAfterDays: b?.result.profile.lateAfterDays ?? null,
        };
      })
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)),
    toLook,
    deliveries: notes.map((n) => {
      const invoiceId = invoiceFor.get(n.id) ?? null;
      return {
        ...n,
        checked: checked.has(n.supplierId),
        lines: lines.filter((l) => l.deliveryId === n.id).map((l) => ({
          name: l.name, unit: l.unit, ordered: l.ordered, received: l.received, nativeReceived: nativeReceived(l), ingredientUnit: l.ingredientUnit,
        })),
        invoice: invoiceId != null ? { ...inv.get(invoiceId)!, status: statusOf.get(invoiceId) ?? null } : null,
      };
    }),
  });
});

/** One invoice's lines as Claude read them (for the invoice's detail). */
router.get("/invoices/:id/lines", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Bad id" }); return; }
  const [inv] = await db.select({ linesStatus: finInvoicesTable.linesStatus }).from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
  if (!inv) { res.status(404).json({ error: "Not found" }); return; }
  const lines = await db.select().from(finInvoiceLinesTable).where(eq(finInvoiceLinesTable.invoiceId, id)).orderBy(finInvoiceLinesTable.position);
  res.json({ linesStatus: inv.linesStatus, lines });
});

router.post("/invoices/:id/read-lines", validate(z.object({})), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Bad id" }); return; }
  await rereadInvoiceLines(id);
  res.json({ ok: true });
});

const SupplierBody = z.object({ enabled: z.boolean() });

/** Tick or untick a supplier. Ticking reads its last couple of months of invoices. */
router.put("/suppliers/:id", validate(SupplierBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Bad id" }); return; }
  const { enabled } = SupplierBody.parse(req.body);
  const [row] = await db.update(suppliersTable).set({ matchInvoicesToDeliveries: enabled }).where(eq(suppliersTable.id, id)).returning({ id: suppliersTable.id, name: suppliersTable.name });
  if (!row) { res.status(404).json({ error: "Supplier not found" }); return; }
  console.log(`[finance] delivery check ${enabled ? "on" : "off"} for ${row.name} by user ${req.session.userId}`);
  forgetMatches();
  if (enabled) void kickLineReader();
  res.json({ ok: true });
});

export default router;
