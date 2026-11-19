/**
 * A pulled kanban is a stock count (Graeme, 19 Nov 2026): the card sits at
 * the safety stock, so when it's pulled that's what's left, less the pack
 * they've started. Recorded like a count typed on the Orders page (a
 * daily_stock_checks row + a stock_entries row), so the Orders page and the
 * running-stock ledger both use it. A count someone typed today wins: it's
 * never overwritten. Never fails the pull. Maths: lib/kanban-stock-left.ts.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { db, dailyStockChecksTable, ingredientsTable, stockEntriesTable } from "@workspace/db";
import { londonDateString } from "./london-time";
import { kanbanLeftQty } from "./kanban-stock-left";
import { ingredientStockLocation } from "./ingredient-stock-location";

export const KANBAN_PULL_NOTE = "Kanban pulled: safety stock left (automatic count)";

export async function recordKanbanPullCount(ingredientId: number, userId: number | null): Promise<void> {
  try {
    const [ing] = await db.select({
      unit: ingredientsTable.unit, category: ingredientsTable.category, packWeight: ingredientsTable.packWeight,
      palletSize: ingredientsTable.palletSize, kanbanQuantity: ingredientsTable.kanbanQuantity, kanbanUnit: ingredientsTable.kanbanUnit,
    }).from(ingredientsTable).where(eq(ingredientsTable.id, ingredientId));
    if (!ing) return;
    const qty = kanbanLeftQty(ing);
    if (qty == null) return;
    const today = londonDateString();
    const [counted] = await db.select({ id: dailyStockChecksTable.id }).from(dailyStockChecksTable)
      .where(and(eq(dailyStockChecksTable.ingredientId, ingredientId), eq(dailyStockChecksTable.checkDate, today)));
    if (counted) return;
    await db.insert(dailyStockChecksTable).values({ ingredientId, checkDate: today, quantity: String(qty), userId }).onConflictDoNothing();
    // Where its stock already lives (tape's in the dry store whatever its
    // category says); the category's place only for a first ever count.
    const [last] = await db.select({ location: stockEntriesTable.location }).from(stockEntriesTable)
      .where(and(eq(stockEntriesTable.ingredientId, ingredientId), ne(stockEntriesTable.location, "production_freezer")))
      .orderBy(desc(stockEntriesTable.checkedAt)).limit(1);
    await db.insert(stockEntriesTable).values({
      ingredientId, itemType: "ingredient", quantity: String(qty), unit: ing.unit ?? "kg",
      location: last?.location ?? ingredientStockLocation(ing.category), checkedAt: new Date(), notes: KANBAN_PULL_NOTE,
    });
  } catch (err) {
    console.error("[kanban] pull count not recorded:", err instanceof Error ? err.message : String(err));
  }
}
