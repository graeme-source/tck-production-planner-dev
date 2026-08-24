import { Router, type IRouter } from "express";
import { db, dptSettingsTable, recipesTable, appSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { computeSalesPacksByRecipe, weeklyAverage, type VariantMapRow } from "../lib/dpt-suggestion";
import { recalculateDptRequirements } from "./dpt-ingredient-requirements";
import { getCachedOrders } from "../lib/orders-cache";

// Weekly DPT refresh (Objective B): once a week, managers/admins are shown
// packs-sold numbers derived from the last 30 days of actual Shopify sales
// (rotating special excluded — see lib/dpt-suggestion.ts) and asked to
// confirm. Nothing is ever applied silently; confirming quiets the prompt
// for a week, "not now" for a day. State lives in app_settings.

const KEY_CONFIRMED = "dpt_suggestion_confirmed_at";
const KEY_SNOOZED = "dpt_suggestion_snoozed_until";
const WINDOW_DAYS = 30;
const CADENCE_MS = 7 * 24 * 60 * 60 * 1000;

const router: IRouter = Router();

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(appSettingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

router.get("/", requireManagerOrAdmin, async (req, res) => {
  try {
    const preview = req.query["preview"] === "1";
    const confirmedAt = await getSetting(KEY_CONFIRMED);
    const snoozedUntil = await getSetting(KEY_SNOOZED);
    const now = Date.now();

    const confirmedRecently = confirmedAt ? now - Date.parse(confirmedAt) < CADENCE_MS : false;
    const snoozed = snoozedUntil ? now < Date.parse(snoozedUntil) : false;
    const due = !confirmedRecently && !snoozed;

    if (!due && !preview) {
      res.json({ due: false, confirmedAt, snoozedUntil });
      return;
    }

    const windowEnd = isoDaysAgo(0);
    const windowStart = isoDaysAgo(WINDOW_DAYS);
    const orders = await getCachedOrders(windowStart, windowEnd);

    const mappingRes = await db.execute<{
      recipe_id: number;
      shopify_variant_id: string | null;
      wonky_variant_id: string | null;
      eight_pack_variant_id: string | null;
      is_current_special: boolean;
    }>(sql`
      SELECT m.recipe_id, m.shopify_variant_id, m.wonky_variant_id,
             m.eight_pack_variant_id, r.is_current_special
      FROM recipe_shopify_mappings m
      JOIN recipes r ON r.id = m.recipe_id
    `);
    const mappings: VariantMapRow[] = mappingRes.rows.map(m => ({
      recipeId: m.recipe_id,
      shopifyVariantId: m.shopify_variant_id,
      wonkyVariantId: m.wonky_variant_id,
      eightPackVariantId: m.eight_pack_variant_id,
      isCurrentSpecial: m.is_current_special,
    }));

    const salesByRecipe = computeSalesPacksByRecipe(orders, mappings);

    const dptRows = await db
      .select({
        recipeId: dptSettingsTable.recipeId,
        packsSold: dptSettingsTable.packsSold,
        isActive: dptSettingsTable.isActive,
        name: recipesTable.name,
        isCurrentSpecial: recipesTable.isCurrentSpecial,
      })
      .from(dptSettingsTable)
      .innerJoin(recipesTable, eq(dptSettingsTable.recipeId, recipesTable.id));

    const excludedSpecials = dptRows.filter(r => r.isCurrentSpecial).map(r => r.name);
    const rows = dptRows
      .filter(r => r.isActive && !r.isCurrentSpecial)
      .map(r => {
        const salesPacks30d = salesByRecipe.get(r.recipeId) ?? 0;
        return {
          recipeId: r.recipeId,
          name: r.name,
          currentPacksSold: r.packsSold,
          suggestedPacksSold: weeklyAverage(salesPacks30d, WINDOW_DAYS),
          salesPacks30d,
        };
      })
      .sort((a, b) => b.suggestedPacksSold - a.suggestedPacksSold);

    res.json({ due: true, windowStart, windowEnd, windowDays: WINDOW_DAYS, rows, excludedSpecials, confirmedAt });
  } catch (err) {
    console.error("[dpt-suggestions] error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Could not compute the DPT suggestion" });
  }
});

const ConfirmBody = z.object({
  rows: z.array(z.object({
    recipeId: z.number().int().positive(),
    packsSold: z.number().int().min(0),
  })).min(1),
});

router.post("/confirm", requireManagerOrAdmin, validate(ConfirmBody), async (req, res) => {
  try {
    const { rows } = req.body as z.infer<typeof ConfirmBody>;
    for (const row of rows) {
      await db.update(dptSettingsTable)
        .set({ packsSold: row.packsSold, updatedAt: new Date() })
        .where(eq(dptSettingsTable.recipeId, row.recipeId));
    }
    await setSetting(KEY_CONFIRMED, new Date().toISOString());
    await setSetting(KEY_SNOOZED, "");
    // Ingredient requirements (and through them the ordering surplus) follow
    // the new split immediately, same as a hand-edit in settings would.
    await recalculateDptRequirements();
    res.json({ ok: true, updated: rows.length });
  } catch (err) {
    console.error("[dpt-suggestions] confirm error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Could not apply the DPT update" });
  }
});

router.post("/snooze", requireManagerOrAdmin, async (_req, res) => {
  try {
    await setSetting(KEY_SNOOZED, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Could not snooze" });
  }
});

export default router;
