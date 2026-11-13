import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq, sql } from "drizzle-orm";
import { db, finInvoiceLinesTable, finInvoicesTable, ingredientPriceReviewsTable, ingredientsTable, suppliersTable } from "@workspace/db";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../ai/claude";
import { claudeCanRead } from "../uploaded-contract-access";
import { londonDateString } from "../london-time";
import { matchSupplierForInvoice } from "../supplier-invoice-match";
import { suppliersForMatch } from "./invoice-queue";
import { logFinEvent } from "./invoice-store";
import {
  dayNumber, deliveredNativeQty, matchSupplierInvoices, EARLIEST_GAP,
  type MatchDelivery, type MatchInvoice, type SupplierMatchResult,
} from "./delivery-matching";
import {
  INVOICE_LINES_TOOL, invoiceLinesPrompt, invoicePricePerOurPack, normaliseInvoiceLines, priceDiffers,
  type IngredientForReading,
} from "./invoice-lines-read";

// Invoices checked against goods-in deliveries (Graeme, 13 Nov 2026): the
// database half. Only suppliers ticked "Check invoices against deliveries"
// are read and matched. Objectives F and I.

/** How far back invoices are checked (and read when a supplier is ticked). */
export const MATCH_WINDOW_DAYS = 75;

function windowStart(today: string): string {
  return isoFromDay(dayNumber(today) - MATCH_WINDOW_DAYS);
}

function isoFromDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export async function enabledSupplierIds(): Promise<number[]> {
  const rows = await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.matchInvoicesToDeliveries, true));
  return rows.map((r) => r.id);
}

interface InvoiceRow {
  id: number;
  supplierName: string | null;
  invoiceDate: string;
  invoiceNumber: string | null;
  totalAmount: string | null;
  linesStatus: string | null;
}

/** Invoices in the window, grouped by the supplier they're from. */
async function invoicesBySupplier(since: string, supplierIds: ReadonlySet<number>): Promise<Map<number, InvoiceRow[]>> {
  const rows = (await db.execute(sql`
    SELECT id, supplier_name AS "supplierName", invoice_date::text AS "invoiceDate", invoice_number AS "invoiceNumber",
           total_amount::text AS "totalAmount", lines_status AS "linesStatus"
      FROM fin_invoices
     WHERE invoice_date >= ${since} AND doc_kind = 'invoice' AND duplicate_of_id IS NULL AND read_status <> 'pending'
     ORDER BY invoice_date, id
  `) as any).rows as InvoiceRow[];
  const suppliers = await suppliersForMatch();
  const out = new Map<number, InvoiceRow[]>();
  for (const r of rows) {
    const s = matchSupplierForInvoice(r.supplierName, suppliers);
    if (!s || !supplierIds.has(s.supplierId)) continue;
    out.set(s.supplierId, [...(out.get(s.supplierId) ?? []), r]);
  }
  return out;
}

export interface DeliveryLineRow {
  deliveryId: number;
  ingredientId: number | null;
  name: string;
  unit: string | null;
  ingredientUnit: string | null;
  ordered: number | null;
  received: number | null;
  packWeight: number;
  palletSize: number | null;
}

async function deliveryLines(deliveryIds: number[]): Promise<DeliveryLineRow[]> {
  if (deliveryIds.length === 0) return [];
  return ((await db.execute(sql`
    SELECT d.id AS "deliveryId", l.ingredient_id AS "ingredientId",
           COALESCE(i.name, l.description, 'Item') AS name, l.unit, i.unit AS "ingredientUnit",
           l.quantity_ordered::float AS ordered, l.quantity_received::float AS received,
           COALESCE(i.pack_weight, 0)::float AS "packWeight", i.pallet_size::float AS "palletSize"
      FROM delivery_records d
      JOIN purchase_order_lines l ON l.purchase_order_id = d.purchase_order_id
      LEFT JOIN ingredients i ON i.id = l.ingredient_id
     WHERE d.id IN (${sql.join(deliveryIds.map((id) => sql`${id}`), sql`, `)})
     ORDER BY d.id, l.id
  `) as any).rows) as DeliveryLineRow[];
}

const WEIGHED_UNITS = new Set(["kg", "g", "l", "ml", "litre", "litres"]);
function isWeighed(unit: string | null): boolean {
  return unit != null && WEIGHED_UNITS.has(unit.toLowerCase());
}

export function nativeReceived(l: DeliveryLineRow): number {
  return deliveredNativeQty(l.received ?? 0, l.unit, l.packWeight, l.palletSize);
}

export interface SupplierMatchBundle {
  supplierId: number;
  result: SupplierMatchResult;
  invoices: InvoiceRow[];
  deliveries: { id: number; date: string }[];
}

let cache: { at: number; today: string; bundles: SupplierMatchBundle[] } | null = null;

export function forgetMatches(): void {
  cache = null;
}

/** Every ticked supplier's invoices matched against its deliveries (cached a minute). */
export async function matchAllSuppliers(): Promise<SupplierMatchBundle[]> {
  const today = londonDateString();
  if (cache && cache.today === today && Date.now() - cache.at < 60_000) return cache.bundles;
  const ids = await enabledSupplierIds();
  const since = windowStart(today);
  const invoicesBy = await invoicesBySupplier(since, new Set(ids));
  const deliveriesSince = isoFromDay(dayNumber(since) + EARLIEST_GAP);
  const bundles: SupplierMatchBundle[] = [];
  for (const supplierId of ids) {
    const invoices = invoicesBy.get(supplierId) ?? [];
    const deliveries = ((await db.execute<{ id: number; date: string }>(sql`
      SELECT id, (received_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date::text AS date
        FROM delivery_records WHERE supplier_id = ${supplierId} AND received_at >= ${deliveriesSince}
       ORDER BY received_at
    `) as any).rows) as { id: number; date: string }[];
    const dl = await deliveryLines(deliveries.map((d) => d.id));
    const readIds = invoices.filter((i) => i.linesStatus === "done").map((i) => i.id);
    const invLines = readIds.length
      ? await db.select().from(finInvoiceLinesTable).where(sql`${finInvoiceLinesTable.invoiceId} IN (${sql.join(readIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];
    const matchInvoices: MatchInvoice[] = invoices.map((i) => ({
      id: i.id, date: i.invoiceDate, number: i.invoiceNumber, total: i.totalAmount != null ? Number(i.totalAmount) : null,
      lines: i.linesStatus === "done"
        ? invLines.filter((l) => l.invoiceId === i.id).map((l) => ({
          ingredientId: l.ingredientId, isCharge: l.isCharge,
          nativeQty: l.quantity != null && l.nativePerUnit != null ? Number(l.quantity) * Number(l.nativePerUnit) : null,
        }))
        : null,
    }));
    const matchDeliveries: MatchDelivery[] = deliveries.map((d) => ({
      id: d.id, date: d.date,
      lines: dl.filter((l) => l.deliveryId === d.id && l.ingredientId != null)
        .map((l) => ({ ingredientId: l.ingredientId!, nativeQty: nativeReceived(l), weighed: isWeighed(l.ingredientUnit) })),
    }));
    bundles.push({ supplierId, result: matchSupplierInvoices(matchInvoices, matchDeliveries, today), invoices, deliveries });
  }
  cache = { at: Date.now(), today, bundles };
  return bundles;
}

export { deliveryLines };

// ---------------------------------------------------------------------------
// Reading invoice lines. Single-flight; kicked when a supplier is ticked,
// when someone asks for a re-read, and every 10 minutes for new invoices.

/** Mark every unread invoice of the ticked suppliers in the window as waiting to be read. */
export async function queueLineReads(): Promise<number> {
  const ids = await enabledSupplierIds();
  if (ids.length === 0) return 0;
  const since = windowStart(londonDateString());
  const by = await invoicesBySupplier(since, new Set(ids));
  const toQueue = [...by.values()].flat().filter((i) => i.linesStatus == null).map((i) => i.id);
  if (toQueue.length === 0) return 0;
  await db.update(finInvoicesTable).set({ linesStatus: "pending" })
    .where(sql`${finInvoicesTable.id} IN (${sql.join(toQueue.map((id) => sql`${id}`), sql`, `)}) AND ${finInvoicesTable.linesStatus} IS NULL`);
  return toQueue.length;
}

let readerRun: Promise<void> | null = null;

/** Start reading (or join the read already going); resolves when nothing is left. */
export function kickLineReader(): Promise<void> {
  if (readerRun) return readerRun;
  readerRun = (async () => {
    await queueLineReads();
    for (let n = 0; n < 1000; n++) {
      const [inv] = await db.select({ id: finInvoicesTable.id }).from(finInvoicesTable)
        .where(eq(finInvoicesTable.linesStatus, "pending")).orderBy(asc(finInvoicesTable.id)).limit(1);
      if (!inv) return;
      await readInvoiceLines(inv.id);
    }
  })()
    .catch((err) => console.error("[finance] invoice line reader crashed:", err))
    .finally(() => { readerRun = null; forgetMatches(); });
  return readerRun;
}

export async function pendingLineReads(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(finInvoicesTable).where(eq(finInvoicesTable.linesStatus, "pending"));
  return r?.n ?? 0;
}

/** What we buy from a supplier: its items, and anything on its recent orders. */
async function supplierIngredients(supplierId: number): Promise<IngredientForReading[]> {
  const rows = ((await db.execute(sql`
    SELECT i.id, i.name, i.unit, COALESCE(i.pack_weight, 0)::float AS "packWeight", i.pack_name AS "packName", i.supplier_part_number AS "partNumber"
      FROM ingredients i
     WHERE i.supplier_id = ${supplierId} OR i.secondary_supplier_id = ${supplierId}
        OR i.id IN (SELECT l.ingredient_id FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.purchase_order_id
                     WHERE o.supplier_id = ${supplierId} AND o.created_at >= NOW() - INTERVAL '180 days')
     ORDER BY i.name
  `) as any).rows) as IngredientForReading[];
  return rows;
}

async function readInvoiceLines(id: number): Promise<void> {
  const finish = (linesStatus: "done" | "failed") =>
    db.update(finInvoicesTable).set({ linesStatus, linesReadAt: new Date() }).where(eq(finInvoicesTable.id, id));
  const [inv] = await db.select({ blob: finInvoicesTable.fileBlob, mime: finInvoicesTable.fileMime, size: finInvoicesTable.fileSizeBytes, supplierName: finInvoicesTable.supplierName })
    .from(finInvoicesTable).where(eq(finInvoicesTable.id, id));
  if (!inv) return;
  if (!isClaudeConfigured() || !claudeCanRead(inv.mime, inv.size).ok) { await finish("failed"); return; }
  const supplier = matchSupplierForInvoice(inv.supplierName, await suppliersForMatch());
  if (!supplier) { await finish("failed"); return; }
  const ingredients = await supplierIngredients(supplier.supplierId);
  const b64 = (Buffer.isBuffer(inv.blob) ? inv.blob : Buffer.from(inv.blob as any)).toString("base64");
  const block: Anthropic.ContentBlockParam = inv.mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: inv.mime as "image/jpeg" | "image/png" | "image/webp", data: b64 } };
  try {
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 4000,
      tool_choice: { type: "tool", name: INVOICE_LINES_TOOL.name },
      tools: [INVOICE_LINES_TOOL as unknown as Anthropic.Tool],
      messages: [{ role: "user", content: [block, { type: "text", text: invoiceLinesPrompt(supplier.supplierName, ingredients) }] }],
    });
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("no lines returned");
    const lines = normaliseInvoiceLines(toolUse.input, new Map(ingredients.map((i) => [i.id, i.unit])));
    await db.transaction(async (tx) => {
      await tx.delete(finInvoiceLinesTable).where(eq(finInvoiceLinesTable.invoiceId, id));
      if (lines.length) {
        await tx.insert(finInvoiceLinesTable).values(lines.map((l) => ({
          invoiceId: id, position: l.position, code: l.code, description: l.description,
          quantity: l.quantity != null ? String(l.quantity) : null, unit: l.unit,
          unitPrice: l.unitPrice != null ? String(l.unitPrice) : null, lineTotal: l.lineTotal != null ? l.lineTotal.toFixed(2) : null,
          isCharge: l.isCharge, ingredientId: l.ingredientId, nativePerUnit: l.nativePerUnit != null ? String(l.nativePerUnit) : null,
        })));
      }
    });
    await finish("done");
    await logFinEvent("invoice", id, "lines_read", null, { by: CLAUDE_MODELS.sonnet, lines: lines.length });
  } catch (err) {
    console.error(`[finance] invoice ${id} lines read failed:`, err instanceof Error ? err.message : err);
    await finish("failed");
  }
}

/** Read this invoice's lines again (someone asked). */
export async function rereadInvoiceLines(id: number): Promise<void> {
  await db.update(finInvoicesTable).set({ linesStatus: "pending" }).where(eq(finInvoicesTable.id, id));
  void kickLineReader();
}

export function startLineReaderTimer(): void {
  setTimeout(() => { void kickLineReader(); }, 90_000).unref();
  setInterval(() => { void kickLineReader(); }, 10 * 60_000).unref();
}

// ---------------------------------------------------------------------------
// Inventory → Price changes to review: the newest matched invoice for each
// item, when its price per our pack is more than 2% from ours.

export interface PriceReview {
  invoiceLineId: number;
  ingredientId: number;
  ingredientName: string;
  supplierId: number;
  supplierName: string;
  invoiceId: number;
  invoiceNumber: string | null;
  invoiceDate: string;
  lineDescription: string;
  ourCostPerPack: number;
  invoiceCostPerPack: number;
  packLabel: string;
  secondary: boolean;
}

export async function priceReviews(): Promise<PriceReview[]> {
  const bundles = await matchAllSuppliers();
  const matched = bundles.flatMap((b) => b.result.invoices.filter((m) => m.status === "matched").map((m) => ({ b, m })));
  if (matched.length === 0) return [];
  const invoiceIds = matched.map((x) => x.m.invoiceId);
  const lines = await db.select().from(finInvoiceLinesTable)
    .where(sql`${finInvoiceLinesTable.invoiceId} IN (${sql.join(invoiceIds.map((id) => sql`${id}`), sql`, `)}) AND ${finInvoiceLinesTable.ingredientId} IS NOT NULL AND NOT ${finInvoiceLinesTable.isCharge}`);
  const ingredientIds = [...new Set(lines.map((l) => l.ingredientId!))];
  if (ingredientIds.length === 0) return [];
  const [ingredients, decisions, suppliers] = await Promise.all([
    db.select({
      id: ingredientsTable.id, name: ingredientsTable.name, unit: ingredientsTable.unit, packWeight: ingredientsTable.packWeight,
      packName: ingredientsTable.packName, costPerPack: ingredientsTable.costPerPack, secondaryCostPerPack: ingredientsTable.secondaryCostPerPack,
      supplierId: ingredientsTable.supplierId, secondarySupplierId: ingredientsTable.secondarySupplierId,
    }).from(ingredientsTable).where(sql`${ingredientsTable.id} IN (${sql.join(ingredientIds.map((id) => sql`${id}`), sql`, `)})`),
    db.select().from(ingredientPriceReviewsTable),
    db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable),
  ]);
  const invoiceById = new Map(bundles.flatMap((b) => b.invoices.map((i) => [i.id, { inv: i, supplierId: b.supplierId, ratios: b.result.profile.usualRatios }] as const)));

  // Newest invoice line per (ingredient, supplier).
  const newest = new Map<string, typeof lines[number]>();
  for (const l of lines) {
    const key = `${l.ingredientId}:${invoiceById.get(l.invoiceId)!.supplierId}`;
    const cur = newest.get(key);
    const d = invoiceById.get(l.invoiceId)!.inv.invoiceDate;
    if (!cur || d > invoiceById.get(cur.invoiceId)!.inv.invoiceDate || (d === invoiceById.get(cur.invoiceId)!.inv.invoiceDate && l.id > cur.id)) newest.set(key, l);
  }

  const out: PriceReview[] = [];
  for (const l of newest.values()) {
    const { inv, supplierId, ratios } = invoiceById.get(l.invoiceId)!;
    const ing = ingredients.find((i) => i.id === l.ingredientId);
    if (!ing) continue;
    const secondary = ing.supplierId !== supplierId && ing.secondarySupplierId === supplierId;
    if (ing.supplierId !== supplierId && !secondary) continue;
    const packWeight = Number(ing.packWeight) || 0;
    const price = invoicePricePerOurPack({
      lineTotal: l.lineTotal != null ? Number(l.lineTotal) : null,
      quantity: l.quantity != null ? Number(l.quantity) : null,
      nativePerUnit: l.nativePerUnit != null ? Number(l.nativePerUnit) : null,
    }, packWeight, ratios[ing.id] ?? 1);
    if (price == null) continue;
    const ours = Number(secondary ? ing.secondaryCostPerPack : ing.costPerPack) || 0;
    if (!priceDiffers(ours, price)) continue;
    // Answered for this line, or "leave ours" already said to this price.
    if (decisions.some((d) => d.invoiceLineId === l.id)) continue;
    if (decisions.some((d) => d.ingredientId === ing.id && d.decision === "dismissed" && d.newCostPerPack != null
      && !priceDiffers(Number(d.newCostPerPack), price) && d.oldCostPerPack != null && !priceDiffers(Number(d.oldCostPerPack), ours))) continue;
    out.push({
      invoiceLineId: l.id, ingredientId: ing.id, ingredientName: ing.name, supplierId,
      supplierName: suppliers.find((s) => s.id === supplierId)?.name ?? "", invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate, lineDescription: l.description,
      // Pennies to 4 places (a box at £0.5803), everything else to the penny.
      ourCostPerPack: ours, invoiceCostPerPack: price < 1 ? Math.round(price * 10000) / 10000 : Math.round(price * 100) / 100,
      packLabel: packWeight > 0 ? `${ing.packName ?? "pack"} of ${packWeight} ${ing.unit}` : ing.unit, secondary,
    });
  }
  return out.sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.ingredientName.localeCompare(b.ingredientName));
}

/** "Update our price" or "Leave ours". */
export async function decidePriceReview(invoiceLineId: number, decision: "updated" | "dismissed", userId: number | null): Promise<{ ok: boolean; error?: string }> {
  const review = (await priceReviews()).find((r) => r.invoiceLineId === invoiceLineId);
  if (!review) return { ok: false, error: "That price has already been dealt with." };
  await db.transaction(async (tx) => {
    if (decision === "updated") {
      const price = review.invoiceCostPerPack.toFixed(4);
      await tx.update(ingredientsTable)
        .set(review.secondary ? { secondaryCostPerPack: price } : { costPerPack: price })
        .where(eq(ingredientsTable.id, review.ingredientId));
    }
    await tx.insert(ingredientPriceReviewsTable).values({
      invoiceLineId, ingredientId: review.ingredientId, decision,
      oldCostPerPack: review.ourCostPerPack.toFixed(4), newCostPerPack: review.invoiceCostPerPack.toFixed(4), decidedBy: userId,
    }).onConflictDoNothing();
  });
  await logFinEvent("invoice", review.invoiceId, decision === "updated" ? "price_updated_from_invoice" : "price_left", userId, {
    ingredientId: review.ingredientId, ingredient: review.ingredientName, from: review.ourCostPerPack, to: review.invoiceCostPerPack,
  });
  return { ok: true };
}

