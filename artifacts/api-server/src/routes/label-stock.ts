import { Router, type IRouter } from "express";
import {
  db,
  labelRecipesTable,
  labelStockChecksTable,
  recipesTable,
  dptSettingsTable,
  appSettingsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { sendEmail } from "../lib/email";

// ──────────────────────────────────────────────────────────────────────────────
// Label Stock Check tool
// ──────────────────────────────────────────────────────────────────────────────
//
// Calculator that figures out how many of each printed label to order. The
// kitchen weighs each roll set on a scale; the tool subtracts the empty-roll
// weight × num_rolls from the total weight, divides by the per-label weight,
// and surfaces a current stock count. The user then enters a total order
// quantity (default 30k) and the tool water-fills order amounts so all
// flavours run out at the same time (proportional to DPT weights).
//
// Auto-population: every recipe with an active dpt_settings row + packs_sold
// > 0 gets a label_recipes row created lazily on GET, so the operator doesn't
// have to seed the table. Miscellaneous entries (for recipes not yet in the
// system) get a manual misc_dpt_pct and stack on top.
// ──────────────────────────────────────────────────────────────────────────────

const router: IRouter = Router();

const SETTINGS_KEYS = {
  emptyRollWeight: "label_empty_roll_weight_g",
  labelWeight: "label_label_weight_g",
  defaultOrderQty: "label_default_order_qty",
  labelSpec: "label_order_spec",
  orderingEmail: "label_ordering_email",
} as const;

async function readSettingText(key: string): Promise<string> {
  const [row] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key))
    .limit(1);
  return row?.value ?? "";
}

async function writeSettingText(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = now()
  `);
}

async function readSetting(key: string, fallback: number): Promise<number> {
  const [row] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key))
    .limit(1);
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : fallback;
}

async function writeSetting(key: string, value: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${String(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = ${String(value)}, updated_at = now()
  `);
}

// GET /settings — read the globals.
router.get("/settings", async (_req, res) => {
  const [emptyRollWeight, labelWeight, defaultOrderQty, labelSpec, orderingEmail] = await Promise.all([
    readSetting(SETTINGS_KEYS.emptyRollWeight, 0),
    readSetting(SETTINGS_KEYS.labelWeight, 0),
    readSetting(SETTINGS_KEYS.defaultOrderQty, 30000),
    readSettingText(SETTINGS_KEYS.labelSpec),
    readSettingText(SETTINGS_KEYS.orderingEmail),
  ]);
  res.json({ emptyRollWeight, labelWeight, defaultOrderQty, labelSpec, orderingEmail });
});

// PUT /settings — patch any subset of the globals.
router.put("/settings", async (req, res) => {
  const body = req.body as Partial<{
    emptyRollWeight: number;
    labelWeight: number;
    defaultOrderQty: number;
    labelSpec: string;
    orderingEmail: string;
  }>;
  if (body.emptyRollWeight !== undefined) {
    if (typeof body.emptyRollWeight !== "number" || body.emptyRollWeight < 0) {
      res.status(400).json({ error: "emptyRollWeight must be a non-negative number" }); return;
    }
    await writeSetting(SETTINGS_KEYS.emptyRollWeight, body.emptyRollWeight);
  }
  if (body.labelWeight !== undefined) {
    if (typeof body.labelWeight !== "number" || body.labelWeight < 0) {
      res.status(400).json({ error: "labelWeight must be a non-negative number" }); return;
    }
    await writeSetting(SETTINGS_KEYS.labelWeight, body.labelWeight);
  }
  if (body.defaultOrderQty !== undefined) {
    if (typeof body.defaultOrderQty !== "number" || body.defaultOrderQty < 0 || !Number.isInteger(body.defaultOrderQty)) {
      res.status(400).json({ error: "defaultOrderQty must be a non-negative integer" }); return;
    }
    await writeSetting(SETTINGS_KEYS.defaultOrderQty, body.defaultOrderQty);
  }
  if (body.labelSpec !== undefined) {
    if (typeof body.labelSpec !== "string") {
      res.status(400).json({ error: "labelSpec must be a string" }); return;
    }
    await writeSettingText(SETTINGS_KEYS.labelSpec, body.labelSpec);
  }
  if (body.orderingEmail !== undefined) {
    if (typeof body.orderingEmail !== "string") {
      res.status(400).json({ error: "orderingEmail must be a string" }); return;
    }
    const trimmed = body.orderingEmail.trim();
    if (trimmed !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      res.status(400).json({ error: "orderingEmail must be a valid email address" }); return;
    }
    await writeSettingText(SETTINGS_KEYS.orderingEmail, trimmed);
  }
  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// Effective recipe list builder
//
// Pulls every label_recipes row + every active DPT recipe with packs_sold > 0
// (auto-creating label_recipes rows for any DPT recipe that doesn't have one
// yet, so the user doesn't have to seed the table). Computes the effective
// "planning weight" per row:
//   - Real recipe with a mapped real recipe (misc → mapped): use the mapped
//     recipe's packs_sold as the weight.
//   - Real recipe (no mapping): use its own packs_sold.
//   - Misc entry (no mapping): use misc_dpt_pct (as a proportion).
// Weights are then normalised to %s so the rebalance math is independent of
// units — works whether DPT is in packs sold or arbitrary percentages.
// ──────────────────────────────────────────────────────────────────────────────
async function buildEffectiveRecipes() {
  // 1. Auto-create label_recipes rows for any active-DPT recipe missing one.
  await db.execute(sql`
    INSERT INTO label_recipes (recipe_id, created_at, updated_at)
    SELECT ds.recipe_id, now(), now()
    FROM dpt_settings ds
    WHERE ds.is_active = true AND ds.packs_sold > 0
      AND NOT EXISTS (
        SELECT 1 FROM label_recipes lr WHERE lr.recipe_id = ds.recipe_id
      )
  `);

  // 2. Pull every label_recipe joined with the relevant DPT row.
  // For real recipes: own DPT (recipe_id).
  // For misc with mapping: the mapped recipe's DPT (mapped_recipe_id).
  // For misc without mapping: no DPT join, use misc_dpt_pct directly.
  const rows = await db.execute(sql`
    SELECT
      lr.id,
      lr.recipe_id AS "recipeId",
      lr.misc_name AS "miscName",
      lr.misc_dpt_pct AS "miscDptPct",
      lr.mapped_recipe_id AS "mappedRecipeId",
      lr.notes,
      lr.created_at AS "createdAt",
      lr.updated_at AS "updatedAt",
      r.name AS "recipeName",
      r.color AS "recipeColor",
      r.category AS "recipeCategory",
      mr.name AS "mappedRecipeName",
      mr.color AS "mappedRecipeColor",
      COALESCE(
        (SELECT packs_sold::numeric FROM dpt_settings WHERE recipe_id = lr.mapped_recipe_id AND is_active = true),
        (SELECT packs_sold::numeric FROM dpt_settings WHERE recipe_id = lr.recipe_id AND is_active = true)
      ) AS "dptPacks",
      -- Latest stock check, if any.
      (SELECT row_to_json(sc.*) FROM (
        SELECT id, num_rolls AS "numRolls", total_weight_g AS "totalWeightG",
               empty_roll_weight_g_used AS "emptyRollWeightGUsed",
               label_weight_g_used AS "labelWeightGUsed",
               computed_count AS "computedCount", checked_at AS "checkedAt",
               user_id AS "userId"
        FROM label_stock_checks
        WHERE label_recipe_id = lr.id
        ORDER BY checked_at DESC LIMIT 1
      ) sc) AS "latestCheck"
    FROM label_recipes lr
    LEFT JOIN recipes r ON r.id = lr.recipe_id
    LEFT JOIN recipes mr ON mr.id = lr.mapped_recipe_id
    WHERE lr.hidden = false
    ORDER BY COALESCE(r.name, lr.misc_name) ASC
  `);

  return rows.rows as Array<{
    id: number;
    recipeId: number | null;
    miscName: string | null;
    miscDptPct: string | null;
    mappedRecipeId: number | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    recipeName: string | null;
    recipeColor: string | null;
    recipeCategory: string | null;
    mappedRecipeName: string | null;
    mappedRecipeColor: string | null;
    dptPacks: string | null;
    latestCheck: {
      id: number;
      numRolls: number;
      totalWeightG: string;
      emptyRollWeightGUsed: string;
      labelWeightGUsed: string;
      computedCount: number;
      checkedAt: string;
      userId: number | null;
    } | null;
  }>;
}

// GET / — full list of label recipes with computed effective DPT %s + latest
// stock check + current stock count. Drives the calculator table.
router.get("/", async (_req, res) => {
  const recipes = await buildEffectiveRecipes();

  // Build a "planning weight" per row. Resolution order:
  //   1. misc_dpt_pct (column on label_recipes) — explicit override, wins
  //      for any row regardless of kind. Lets the user set a planning %
  //      for a real recipe that has packs_sold=0 in DPT (e.g. mac cheese)
  //      without touching the real DPT setting.
  //   2. Real DPT packs_sold (own or via mapped_recipe_id) — auto-derived
  //      for recipes with an active, non-zero DPT.
  //   3. 0 — no weight, row shows up but gets no order allocation.
  const realPacksTotal = recipes.reduce((s, r) => {
    if (r.miscDptPct == null && r.dptPacks != null) return s + Number(r.dptPacks);
    return s;
  }, 0);
  const weights = recipes.map(r => {
    if (r.miscDptPct != null) {
      // Override pct converts to a packs-equivalent so it's comparable to
      // the real DPT weights (which are in packs_sold units). When there
      // are real recipes in the mix, we anchor against their total; when
      // it's all overrides, we use the pct as the weight directly and let
      // normalisation handle it.
      const pct = Number(r.miscDptPct);
      return realPacksTotal > 0 ? (pct / 100) * realPacksTotal : pct;
    }
    if (r.dptPacks != null) return Number(r.dptPacks);
    return 0;
  });
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const items = recipes.map((r, idx) => {
    const planningWeight = weights[idx];
    const effectiveDptPct = totalWeight > 0 ? (planningWeight / totalWeight) * 100 : 0;
    const currentStock = r.latestCheck?.computedCount ?? null;
    return {
      id: r.id,
      kind: r.recipeId ? "real" : "misc",
      recipeId: r.recipeId,
      recipeName: r.recipeName ?? r.miscName ?? "Recipe",
      recipeColor: r.recipeColor ?? r.mappedRecipeColor ?? null,
      recipeCategory: r.recipeCategory,
      miscName: r.miscName,
      miscDptPct: r.miscDptPct != null ? Number(r.miscDptPct) : null,
      mappedRecipeId: r.mappedRecipeId,
      mappedRecipeName: r.mappedRecipeName,
      planningWeight,
      effectiveDptPct,
      currentStock,
      latestCheck: r.latestCheck,
      notes: r.notes,
    };
  });

  res.json({ items });
});

// GET /menu-recipes — list every recipe in the system that's NOT currently
// visible in the calculator. Hidden rows ARE eligible to re-add (and adding
// them un-hides the existing row rather than creating a duplicate).
router.get("/menu-recipes", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT r.id, r.name, r.category, r.color,
           ds.packs_sold AS "dptPacksSold",
           ds.is_active AS "dptIsActive"
    FROM recipes r
    LEFT JOIN dpt_settings ds ON ds.recipe_id = r.id
    WHERE r.id NOT IN (
      SELECT recipe_id FROM label_recipes
      WHERE recipe_id IS NOT NULL AND hidden = false
    )
    ORDER BY r.category NULLS LAST, r.name ASC
  `);
  res.json({ items: rows.rows });
});

// POST /recipes/from-menu — add a real recipe (by id) to the calculator. If
// the recipe has packs_sold=0 (e.g. mac cheese), the optional dptPctOverride
// gives it a planning weight without touching the canonical dpt_settings.
// If the recipe already has a hidden label_recipes row, this un-hides it
// instead of creating a duplicate (the unique index would block it anyway).
router.post("/recipes/from-menu", async (req, res) => {
  const body = req.body as { recipeId?: number; dptPctOverride?: number; notes?: string };
  if (!body.recipeId || typeof body.recipeId !== "number") {
    res.status(400).json({ error: "recipeId is required" }); return;
  }
  // Confirm the recipe exists before we try to insert (gives a friendlier
  // error than the FK violation).
  const [recipe] = await db.select({ id: recipesTable.id })
    .from(recipesTable)
    .where(eq(recipesTable.id, body.recipeId))
    .limit(1);
  if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }

  // Re-use any existing row for this recipe (hidden or not) so we don't
  // collide with the unique index uq_label_recipe_real.
  const [existing] = await db.select()
    .from(labelRecipesTable)
    .where(eq(labelRecipesTable.recipeId, body.recipeId))
    .limit(1);

  if (existing) {
    if (!existing.hidden) {
      res.status(409).json({ error: "Recipe is already in the calculator" });
      return;
    }
    // Un-hide and apply the new override.
    const [row] = await db.update(labelRecipesTable).set({
      hidden: false,
      miscDptPct: body.dptPctOverride != null ? String(body.dptPctOverride) : null,
      notes: body.notes ?? existing.notes,
      updatedAt: new Date(),
    }).where(eq(labelRecipesTable.id, existing.id)).returning();
    res.status(201).json(row);
    return;
  }

  const [row] = await db.insert(labelRecipesTable).values({
    recipeId: body.recipeId,
    miscDptPct: body.dptPctOverride != null ? String(body.dptPctOverride) : null,
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(row);
});

// POST /recipes — add a misc entry. Body: { miscName, miscDptPct, mappedRecipeId?, notes? }
router.post("/recipes", async (req, res) => {
  const body = req.body as { miscName?: string; miscDptPct?: number; mappedRecipeId?: number | null; notes?: string };
  if (!body.miscName || body.miscName.trim().length === 0) {
    res.status(400).json({ error: "miscName is required" }); return;
  }
  if (body.miscDptPct == null || typeof body.miscDptPct !== "number" || body.miscDptPct < 0) {
    res.status(400).json({ error: "miscDptPct must be a non-negative number" }); return;
  }
  const [row] = await db.insert(labelRecipesTable).values({
    miscName: body.miscName.trim(),
    miscDptPct: String(body.miscDptPct),
    mappedRecipeId: body.mappedRecipeId ?? null,
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(row);
});

// PUT /recipes/:id — update a misc entry's name / dpt / mapping / notes.
// Real-recipe rows are mostly read-only (mapped_recipe_id is misc-only).
router.put("/recipes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as { miscName?: string; miscDptPct?: number; mappedRecipeId?: number | null; notes?: string };
  const updates: Partial<typeof labelRecipesTable.$inferInsert> = { updatedAt: new Date() };
  if (body.miscName !== undefined) updates.miscName = body.miscName.trim();
  if (body.miscDptPct !== undefined) updates.miscDptPct = body.miscDptPct != null ? String(body.miscDptPct) : null;
  if (body.mappedRecipeId !== undefined) updates.mappedRecipeId = body.mappedRecipeId ?? null;
  if (body.notes !== undefined) updates.notes = body.notes ?? null;
  const [row] = await db.update(labelRecipesTable).set(updates).where(eq(labelRecipesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /recipes/:id — remove a row from the calculator.
//   - Real-recipe rows are hidden (soft-delete) so the auto-populate INSERT
//     in buildEffectiveRecipes doesn't immediately re-add them. They can
//     be re-added via the "Add from menu" picker (which un-hides).
//   - Misc rows actual-delete (no chance of auto-recreation, and we want
//     misc_name freed up so the user can re-use it later if they want).
router.delete("/recipes/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select({ recipeId: labelRecipesTable.recipeId })
    .from(labelRecipesTable)
    .where(eq(labelRecipesTable.id, id))
    .limit(1);
  if (!existing) { res.json({ ok: true }); return; }
  if (existing.recipeId != null) {
    await db.update(labelRecipesTable)
      .set({ hidden: true, updatedAt: new Date() })
      .where(eq(labelRecipesTable.id, id));
  } else {
    await db.delete(labelRecipesTable).where(eq(labelRecipesTable.id, id));
  }
  res.json({ ok: true });
});

// POST /recipes/:id/check — record a stock check. Body: { numRolls, totalWeightG }.
// Uses the CURRENT global empty/label weights to compute the count, and
// snapshots them onto the row so historical counts stay stable if the
// operator later recalibrates the scales.
router.post("/recipes/:id/check", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body as { numRolls?: number; totalWeightG?: number };
  if (body.numRolls == null || typeof body.numRolls !== "number" || body.numRolls < 0 || !Number.isInteger(body.numRolls)) {
    res.status(400).json({ error: "numRolls must be a non-negative integer" }); return;
  }
  if (body.totalWeightG == null || typeof body.totalWeightG !== "number" || body.totalWeightG < 0) {
    res.status(400).json({ error: "totalWeightG must be a non-negative number" }); return;
  }
  const [emptyRollWeight, labelWeight] = await Promise.all([
    readSetting(SETTINGS_KEYS.emptyRollWeight, 0),
    readSetting(SETTINGS_KEYS.labelWeight, 0),
  ]);
  if (labelWeight <= 0) {
    res.status(400).json({ error: "label_label_weight_g must be > 0 (set it in Settings first)" }); return;
  }
  const rawCount = (body.totalWeightG - body.numRolls * emptyRollWeight) / labelWeight;
  const computedCount = Math.max(0, Math.round(rawCount));
  const userId = (req.session as any)?.userId ?? null;
  const [row] = await db.insert(labelStockChecksTable).values({
    labelRecipeId: id,
    numRolls: body.numRolls,
    totalWeightG: String(body.totalWeightG),
    emptyRollWeightGUsed: String(emptyRollWeight),
    labelWeightGUsed: String(labelWeight),
    computedCount,
    userId,
  }).returning();
  res.status(201).json(row);
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /calculate-order — water-fill rebalance.
//
// Body: { totalToOrder }  (integer, default = label_default_order_qty)
//
// For each label recipe with a current stock count and a planning weight,
// we want: (currentStock + orderQty) / weight = K, for some common K.
// Recipes that are already over-stocked relative to weight get orderQty = 0
// and are removed from the constraint set; we re-solve until stable.
//
// Returns per-recipe orderQty integers that sum to totalToOrder (rounding
// error is distributed to the recipe with the smallest order > 0 so the
// total comes out exact).
// ──────────────────────────────────────────────────────────────────────────────
router.post("/calculate-order", async (req, res) => {
  const body = req.body as { totalToOrder?: number };
  const defaultQty = await readSetting(SETTINGS_KEYS.defaultOrderQty, 30000);
  const totalToOrder = body.totalToOrder != null && Number.isFinite(body.totalToOrder)
    ? Math.max(0, Math.round(body.totalToOrder))
    : Math.round(defaultQty);

  const recipes = await buildEffectiveRecipes();
  // Same planning-weight resolution as GET / — see comment there.
  const realPacksTotal = recipes.reduce((s, r) => {
    if (r.miscDptPct == null && r.dptPacks != null) return s + Number(r.dptPacks);
    return s;
  }, 0);
  const enriched = recipes.map(r => {
    let planningWeight = 0;
    if (r.miscDptPct != null) {
      const pct = Number(r.miscDptPct);
      planningWeight = realPacksTotal > 0 ? (pct / 100) * realPacksTotal : pct;
    } else if (r.dptPacks != null) {
      planningWeight = Number(r.dptPacks);
    }
    return {
      id: r.id,
      recipeName: r.recipeName ?? r.miscName ?? "Recipe",
      planningWeight,
      currentStock: r.latestCheck?.computedCount ?? 0,
      hasStockCheck: r.latestCheck != null,
    };
  });

  // Only recipes with a non-zero weight participate (zero-weight items
  // would otherwise pull infinite supply when divided).
  const participants = enriched.filter(r => r.planningWeight > 0);
  if (participants.length === 0 || totalToOrder === 0) {
    res.json({
      totalToOrder,
      items: enriched.map(r => ({ ...r, orderQty: 0, targetStock: r.currentStock })),
    });
    return;
  }

  // Water-fill: iteratively shrink the active set until every K-derived
  // target ≥ current stock (no negative orders).
  const active = new Set(participants.map(r => r.id));
  const orderById = new Map<number, number>();
  for (const r of enriched) orderById.set(r.id, 0);

  // Safety cap on iterations — can't loop more than participants.length times
  // (each iter removes at least one row from the active set).
  for (let iter = 0; iter < participants.length + 1; iter++) {
    const activeRows = participants.filter(r => active.has(r.id));
    if (activeRows.length === 0) break;
    const sumWeight = activeRows.reduce((s, r) => s + r.planningWeight, 0);
    const sumStock = activeRows.reduce((s, r) => s + r.currentStock, 0);
    if (sumWeight === 0) break;
    const K = (totalToOrder + sumStock) / sumWeight;

    let removedAny = false;
    for (const r of activeRows) {
      const target = K * r.planningWeight;
      if (target < r.currentStock) {
        active.delete(r.id);
        orderById.set(r.id, 0);
        removedAny = true;
      }
    }
    if (!removedAny) {
      // Active set is stable — record orders and stop.
      for (const r of activeRows) {
        const target = K * r.planningWeight;
        orderById.set(r.id, Math.max(0, target - r.currentStock));
      }
      break;
    }
  }

  // Round each order to the nearest 100 and then balance ±100 adjustments
  // so the final sum equals the snapped total. We snap the requested total
  // to the nearest 100 too — if the user types 30,123 they get a 30,100
  // plan. The "Allocated" stat on the frontend reflects this.
  const itemsWithRaw = enriched.map(r => ({
    ...r,
    rawOrder: orderById.get(r.id) ?? 0,
  }));
  const ROUNDING = 100;
  const snappedTotal = Math.round(totalToOrder / ROUNDING) * ROUNDING;
  const roundedItems = itemsWithRaw.map(r => ({
    ...r,
    orderQty: Math.max(0, Math.round(r.rawOrder / ROUNDING) * ROUNDING),
  }));

  // Drift = (target sum) − (current sum after independent rounding). Walk
  // ±ROUNDING adjustments toward the rows with the most rounding regret in
  // the right direction until the drift hits zero (or we can't move).
  let drift = snappedTotal - roundedItems.reduce((s, r) => s + r.orderQty, 0);
  const SAFETY_CAP = roundedItems.length * 4;
  let iterations = 0;
  while (drift !== 0 && iterations < SAFETY_CAP) {
    iterations += 1;
    if (drift > 0) {
      // Need to add ROUNDING — pick the row that was rounded down the most.
      let bestIdx = -1;
      let bestGap = -Infinity;
      for (let i = 0; i < roundedItems.length; i++) {
        if (roundedItems[i].rawOrder <= 0) continue;
        const gap = roundedItems[i].rawOrder - roundedItems[i].orderQty;
        if (gap > bestGap) { bestGap = gap; bestIdx = i; }
      }
      if (bestIdx === -1) break;
      roundedItems[bestIdx].orderQty += ROUNDING;
      drift -= ROUNDING;
    } else {
      // Need to subtract ROUNDING — pick the row that was rounded up the
      // most. Skip rows that would go below zero.
      let bestIdx = -1;
      let bestExcess = -Infinity;
      for (let i = 0; i < roundedItems.length; i++) {
        if (roundedItems[i].orderQty < ROUNDING) continue;
        const excess = roundedItems[i].orderQty - roundedItems[i].rawOrder;
        if (excess > bestExcess) { bestExcess = excess; bestIdx = i; }
      }
      if (bestIdx === -1) break;
      roundedItems[bestIdx].orderQty -= ROUNDING;
      drift += ROUNDING;
    }
  }

  res.json({
    totalToOrder: snappedTotal,
    items: roundedItems.map(r => ({
      id: r.id,
      recipeName: r.recipeName,
      planningWeight: r.planningWeight,
      currentStock: r.currentStock,
      hasStockCheck: r.hasStockCheck,
      orderQty: r.orderQty,
      targetStock: r.currentStock + r.orderQty,
    })),
  });
});

// POST /send-order — emails the current order quantities to the configured
// supplier address. Body: { items: [{ recipeName, orderQty }], labelSpec?,
// orderingEmail? }. If labelSpec/orderingEmail aren't supplied, the saved
// settings are used. Only rows with orderQty > 0 are included.
router.post("/send-order", async (req, res) => {
  const body = req.body as {
    items?: Array<{ recipeName?: string; orderQty?: number }>;
    labelSpec?: string;
    orderingEmail?: string;
  };

  const items = (body.items ?? [])
    .map(it => ({
      recipeName: typeof it.recipeName === "string" ? it.recipeName.trim() : "",
      orderQty: Number(it.orderQty) || 0,
    }))
    .filter(it => it.recipeName !== "" && it.orderQty > 0);
  if (items.length === 0) {
    res.status(400).json({ error: "No order rows with a quantity > 0 to send" });
    return;
  }

  const labelSpec = (body.labelSpec ?? await readSettingText(SETTINGS_KEYS.labelSpec)).trim();
  const to = (body.orderingEmail ?? await readSettingText(SETTINGS_KEYS.orderingEmail)).trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    res.status(400).json({ error: "Set a valid ordering email address first" });
    return;
  }

  const totalQty = items.reduce((s, it) => s + it.orderQty, 0);
  const textLines = items.map(it => `${it.recipeName} — ${it.orderQty.toLocaleString()}`);
  const text = [
    labelSpec || "Please can you produce the following label quantities:",
    "",
    ...textLines,
    "",
    `Total: ${totalQty.toLocaleString()} labels`,
  ].join("\n");

  const htmlRows = items
    .map(it => `<tr><td style="padding:4px 12px 4px 0;">${escapeHtml(it.recipeName)}</td><td style="padding:4px 0;text-align:right;font-variant-numeric:tabular-nums;">${it.orderQty.toLocaleString()}</td></tr>`)
    .join("");
  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:560px;margin:24px auto;color:#222;">
${labelSpec ? `<div style="white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(labelSpec)}</div>` : ""}
<table style="border-collapse:collapse;">${htmlRows}</table>
<p style="margin-top:16px;font-weight:600;">Total: ${totalQty.toLocaleString()} labels</p>
</body></html>`;

  try {
    await sendEmail({
      to,
      subject: `Label order — ${totalQty.toLocaleString()} labels`,
      text,
      html,
    });
    res.json({ ok: true, to, totalQty, itemCount: items.length });
  } catch (err) {
    console.error("[label-stock] send-order failed:", err);
    res.status(502).json({ error: "Failed to send email", detail: String(err) });
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default router;
