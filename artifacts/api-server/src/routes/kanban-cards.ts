/**
 * Printable kanban cards as a PDF — /api/kanban-cards (objective C).
 *
 *   GET /pdf?ids=12,40,41&sheet=a5|a4
 *
 * One page per card, each page the A5 fold sheet (front top, back bottom
 * upside down, dashed fold line) at the exact physical size — see
 * lib/kanban-card-layout.ts. sheet=a4 puts the same A5 card on A4 with crop
 * marks for printers that only have A4 in.
 *
 * Replaces the inventory page's old print popup (Graeme, 23 Oct 2026: the
 * button wasn't opening on desktop / printed at the wrong size, so the team
 * were screenshotting cards and printing those at random sizes). Served
 * inline so it opens in the browser's own PDF viewer in a new tab, from a
 * plain link — nothing for a pop-up blocker to stop.
 *
 * Same access as the card data it replaces (GET /ingredients/:id/kanban-card):
 * anyone signed in. Read-only.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, ingredientsTable, suppliersTable, storageLocationsTable, ingredientStorageLocationsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { validateQuery } from "../middleware/validate";
import { KANBAN_SHEETS, type KanbanSheet } from "../lib/kanban-card-layout";
import { kanbanCardText } from "../lib/kanban-card-text";
import { qrPayload } from "../lib/qr-code";

const router: IRouter = Router();

export const MAX_KANBAN_CARDS_PER_PDF = 200;

const PdfQuery = z.object({
  ids: z
    .string()
    .regex(/^\d+(,\d+)*$/, "ids must be a comma-separated list of ingredient ids")
    .transform((v) => [...new Set(v.split(",").map(Number))].filter((n) => n > 0))
    .refine((a) => a.length >= 1 && a.length <= MAX_KANBAN_CARDS_PER_PDF, `Between 1 and ${MAX_KANBAN_CARDS_PER_PDF} cards`),
  sheet: z.enum(KANBAN_SHEETS as [KanbanSheet, ...KanbanSheet[]]).default("a5"),
});

router.get("/pdf", validateQuery(PdfQuery), async (_req, res) => {
  const { ids, sheet } = res.locals["query"] as z.infer<typeof PdfQuery>;
  try {
    const t = ingredientsTable;
    const rows = await db
      .select({
        id: t.id, name: t.name, unit: t.unit, supplierId: t.supplierId, supplierPartNumber: t.supplierPartNumber,
        kanbanQuantity: t.kanbanQuantity, kanbanUnit: t.kanbanUnit, kanbanOrderAmount: t.kanbanOrderAmount, packName: t.packName,
      })
      .from(t)
      .where(inArray(t.id, ids));
    if (rows.length === 0) { res.status(404).json({ error: "No matching items" }); return; }

    const supplierIds = [...new Set(rows.map((r) => r.supplierId).filter((v): v is number => v != null))];
    const suppliers = supplierIds.length
      ? await db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(inArray(suppliersTable.id, supplierIds))
      : [];
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

    const locRows = await db
      .select({ ingredientId: ingredientStorageLocationsTable.ingredientId, name: storageLocationsTable.name })
      .from(ingredientStorageLocationsTable)
      .innerJoin(storageLocationsTable, eq(storageLocationsTable.id, ingredientStorageLocationsTable.locationId))
      .where(inArray(ingredientStorageLocationsTable.ingredientId, ids));
    const locations = new Map<number, string[]>();
    for (const l of locRows) locations.set(l.ingredientId, [...(locations.get(l.ingredientId) ?? []), l.name]);

    const byId = new Map(rows.map((r) => [r.id, r]));
    // Cards come out in the order asked for (the page's own sort order).
    const cards = ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const text = kanbanCardText({
        id: row.id,
        name: row.name,
        unit: row.unit,
        kanbanQuantity: Number(row.kanbanQuantity ?? 0),
        kanbanUnit: row.kanbanUnit ?? "weight",
        kanbanOrderAmount: row.kanbanOrderAmount != null ? Number(row.kanbanOrderAmount) : null,
        supplier: row.supplierId != null ? supplierName.get(row.supplierId) ?? null : null,
        supplierPartNumber: row.supplierPartNumber ?? null,
        location: locations.get(row.id)?.join(", ") || null,
        packName: row.packName ?? null,
      });
      return [{ ...text, qrText: qrPayload("ingredient", row.id) }];
    });

    const { renderKanbanCardsPdf } = await import("../pdf/kanban-card-pdf.js");
    const pdf = await renderKanbanCardsPdf(cards, sheet);
    const base = cards.length === 1 ? cards[0].name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() : `${cards.length}-cards`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="kanban-${base || "card"}-${sheet}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);
  } catch (err) {
    console.error("kanban-cards pdf error:", err);
    res.status(500).json({ error: "Could not make the kanban PDF" });
  }
});

export default router;
