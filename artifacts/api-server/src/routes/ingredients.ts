import { Router, type IRouter } from "express";
import { db, ingredientsTable, suppliersTable, recipeIngredientsTable, subRecipeIngredientsTable, ingredientStorageLocationsTable, storageLocationsTable } from "@workspace/db";
import { eq, sql, inArray, isNull, isNotNull } from "drizzle-orm";
import { CreateIngredientBody, UpdateIngredientBody } from "@workspace/api-zod";
import { detectAllergens, ALLERGEN_DISPLAY } from "@workspace/allergens";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { generateQrCode } from "../lib/qr-code";

const router: IRouter = Router();

function mapRow(r: typeof ingredientsTable.$inferSelect) {
  return {
    ...r,
    packWeight: Number(r.packWeight),
    costPerPack: Number(r.costPerPack),
    processingRatio: r.processingRatio !== null && r.processingRatio !== undefined ? Number(r.processingRatio) : null,
    rawMeatTrayCapacityKg: r.rawMeatTrayCapacityKg !== null && r.rawMeatTrayCapacityKg !== undefined ? Number(r.rawMeatTrayCapacityKg) : null,
    minCookingTempC: r.minCookingTempC !== null && r.minCookingTempC !== undefined ? Number(r.minCookingTempC) : null,
    estimatedCookTimeMin: r.estimatedCookTimeMin ?? null,
    meatProcessMinutes: r.meatProcessMinutes ?? null,
    ovenTempC: r.ovenTempC ?? null,
    steamPct: r.steamPct ?? null,
    surplusPercent: Number(r.surplusPercent),
    surplusMode: ((r as unknown as { surplusMode?: string }).surplusMode ?? "percent"),
    surplusAbsoluteQty: (r as unknown as { surplusAbsoluteQty?: string | null }).surplusAbsoluteQty != null
      ? Number((r as unknown as { surplusAbsoluteQty?: string | null }).surplusAbsoluteQty)
      : null,
    shelfLifeDays: r.shelfLifeDays ?? null,
    requiresUseByDate: r.requiresUseByDate ?? false,
    kanbanEnabled: r.kanbanEnabled ?? false,
    kanbanQuantity: Number(r.kanbanQuantity ?? 0),
    kanbanUnit: r.kanbanUnit ?? "weight",
    kanbanOrderAmount: r.kanbanOrderAmount != null ? Number(r.kanbanOrderAmount) : null,
    shopifyVariantId: r.shopifyVariantId ?? null,
    shopifyProductTitle: r.shopifyProductTitle ?? null,
    shopifyVariantTitle: r.shopifyVariantTitle ?? null,
    shopifyUnitsPerPack: r.shopifyUnitsPerPack != null ? Number(r.shopifyUnitsPerPack) : null,
    perishable: r.perishable ?? true,
    palletSize: r.palletSize ?? null,
    caseSizePacks: (r as unknown as { caseSizePacks?: number | null }).caseSizePacks ?? null,
    energyKj: r.energyKj != null ? Number(r.energyKj) : null,
    energyKcal: r.energyKcal != null ? Number(r.energyKcal) : null,
    fat: r.fat != null ? Number(r.fat) : null,
    saturates: r.saturates != null ? Number(r.saturates) : null,
    carbohydrate: r.carbohydrate != null ? Number(r.carbohydrate) : null,
    sugars: r.sugars != null ? Number(r.sugars) : null,
    protein: r.protein != null ? Number(r.protein) : null,
    fibre: r.fibre != null ? Number(r.fibre) : null,
    salt: r.salt != null ? Number(r.salt) : null,
    labelDeclaration: r.labelDeclaration ?? null,
    nutritionalsAiEstimated: (r as unknown as { nutritionalsAiEstimated?: boolean }).nutritionalsAiEstimated ?? false,
    isBottle: r.isBottle ?? false,
    bottleSize: r.bottleSize != null ? Number(r.bottleSize) : null,
    prepCountPerPortion: (r as unknown as { prepCountPerPortion?: number | null }).prepCountPerPortion ?? null,
    isPasta: (r as unknown as { isPasta?: boolean }).isPasta ?? false,
    stockInPacks: (r as unknown as { stockInPacks?: boolean }).stockInPacks ?? false,
    allergens: (r.allergens as string[] | null) ?? [],
    novaClass: r.novaClass ?? null,
    novaMarkers: (r.novaMarkers as string[] | null) ?? [],
    novaReasoning: r.novaReasoning ?? null,
    novaConfidence: r.novaConfidence ?? null,
    novaSource: r.novaSource ?? null,
    novaAnalyzedAt: r.novaAnalyzedAt != null ? r.novaAnalyzedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// Requires pack size when "count stock in whole packs" is on. Used by create
// and update — stops the caller from saving a config that would divide by
// zero when stock-check / order / goods-in UIs convert packs to native units.
function validateStockInPacks(stockInPacks: unknown, packWeight: unknown): string | null {
  if (stockInPacks !== true) return null;
  const pw = Number(packWeight);
  if (!Number.isFinite(pw) || pw <= 0) {
    return "Set a Pack size greater than 0 before turning on 'Count stock in whole packs'.";
  }
  return null;
}

router.get("/", async (req, res) => {
  const { perishable } = req.query;
  let query = db
    .select({ ing: ingredientsTable, supplierName: suppliersTable.name })
    .from(ingredientsTable)
    .leftJoin(suppliersTable, eq(ingredientsTable.supplierId, suppliersTable.id))
    .orderBy(ingredientsTable.name)
    .$dynamic();
  if (perishable === "true") query = query.where(eq(ingredientsTable.perishable, true));
  else if (perishable === "false") query = query.where(eq(ingredientsTable.perishable, false));
  const joined = await query;
  const rows = joined.map(j => j.ing);
  const supplierNameById = new Map(joined.map(j => [j.ing.id, j.supplierName ?? null]));

  const recipeUsage = await db
    .select({ ingredientId: recipeIngredientsTable.ingredientId, cnt: sql<number>`count(distinct ${recipeIngredientsTable.recipeId})` })
    .from(recipeIngredientsTable)
    .groupBy(recipeIngredientsTable.ingredientId);
  const subRecipeUsage = await db
    .select({ ingredientId: subRecipeIngredientsTable.ingredientId, cnt: sql<number>`count(distinct ${subRecipeIngredientsTable.subRecipeId})` })
    .from(subRecipeIngredientsTable)
    .groupBy(subRecipeIngredientsTable.ingredientId);

  const usageMap: Record<number, { recipes: number; subRecipes: number }> = {};
  for (const r of recipeUsage) {
    if (!usageMap[r.ingredientId]) usageMap[r.ingredientId] = { recipes: 0, subRecipes: 0 };
    usageMap[r.ingredientId].recipes = Number(r.cnt);
  }
  for (const s of subRecipeUsage) {
    if (!usageMap[s.ingredientId]) usageMap[s.ingredientId] = { recipes: 0, subRecipes: 0 };
    usageMap[s.ingredientId].subRecipes = Number(s.cnt);
  }

  res.json(rows.map(r => {
    const usage = usageMap[r.id];
    return {
      ...mapRow(r),
      supplierName: supplierNameById.get(r.id) ?? null,
      usedInRecipes: usage ? usage.recipes : 0,
      usedInSubRecipes: usage ? usage.subRecipes : 0,
    };
  }));
});

function validateProcessingRatio(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (isNaN(n) || n < 0 || n > 1) return "processingRatio must be a number between 0 and 1";
  return null;
}

router.post("/", validate(CreateIngredientBody), async (req, res) => {
  const { name, unit, packWeight, costPerPack, brand, supplierPartNumber, supplierId, secondarySupplierId, orderingUrl, notes, processingRatio, rawMeatTrayCapacityKg, minCookingTempC, estimatedCookTimeMin, meatProcessMinutes, ovenTempC, steamPct, category, prepWeightMode, isBottle, bottleSize, prepCountPerPortion, isPasta, stockInPacks, stockCheckEnabled, stockCheckFrequency, stockCheckDay, surplusPercent, surplusMode, surplusAbsoluteQty, shelfLifeDays, requiresUseByDate, kanbanEnabled, kanbanQuantity, kanbanUnit, kanbanOrderAmount, shopifyVariantId, shopifyProductTitle, shopifyVariantTitle, shopifyUnitsPerPack, perishable, palletSize, caseSizePacks, energyKj, energyKcal, fat, saturates, carbohydrate, sugars, protein, fibre, salt, labelDeclaration, allergens, nutritionalsAiEstimated } = req.body;
  const ratioError = validateProcessingRatio(processingRatio);
  if (ratioError) { res.status(400).json({ error: ratioError }); return; }
  const packsError = validateStockInPacks(stockInPacks, packWeight);
  if (packsError) { res.status(400).json({ error: packsError }); return; }
  const [row] = await db.insert(ingredientsTable).values({
    name,
    unit,
    packWeight: String(packWeight ?? 0),
    costPerPack: String(costPerPack ?? 0),
    brand: brand || null,
    supplierPartNumber: supplierPartNumber || null,
    supplierId: supplierId ? Number(supplierId) : null,
    secondarySupplierId: secondarySupplierId ? Number(secondarySupplierId) : null,
    orderingUrl: orderingUrl || null,
    notes: notes || null,
    category: category || null,
    processingRatio: processingRatio !== null && processingRatio !== undefined ? String(processingRatio) : null,
    prepWeightMode: prepWeightMode ?? (["vegetable", "herb"].includes(category ?? "") ? "processed" : "raw"),
    rawMeatTrayCapacityKg: rawMeatTrayCapacityKg !== null && rawMeatTrayCapacityKg !== undefined ? String(rawMeatTrayCapacityKg) : null,
    minCookingTempC: minCookingTempC !== null && minCookingTempC !== undefined ? String(minCookingTempC) : null,
    estimatedCookTimeMin: estimatedCookTimeMin != null ? Number(estimatedCookTimeMin) : null,
    meatProcessMinutes: meatProcessMinutes != null ? Number(meatProcessMinutes) : null,
    ovenTempC: ovenTempC != null ? Number(ovenTempC) : null,
    steamPct: steamPct != null ? Number(steamPct) : null,
    isBottle: isBottle ?? false,
    bottleSize: bottleSize != null ? String(bottleSize) : null,
    prepCountPerPortion: prepCountPerPortion != null ? Number(prepCountPerPortion) : null,
    isPasta: isPasta ?? false,
    stockInPacks: stockInPacks ?? false,
    stockCheckEnabled: stockCheckEnabled ?? false,
    stockCheckFrequency: stockCheckFrequency ?? "daily",
    stockCheckDay: stockCheckDay || null,
    surplusPercent: surplusPercent != null ? String(surplusPercent) : "10",
    surplusMode: surplusMode === "absolute" ? "absolute" : "percent",
    surplusAbsoluteQty: surplusAbsoluteQty != null ? String(surplusAbsoluteQty) : null,
    shelfLifeDays: shelfLifeDays != null ? Number(shelfLifeDays) : null,
    requiresUseByDate: requiresUseByDate ?? false,
    kanbanEnabled: kanbanEnabled ?? false,
    kanbanQuantity: kanbanQuantity != null ? String(kanbanQuantity) : "0",
    kanbanUnit: kanbanUnit ?? "weight",
    kanbanOrderAmount: kanbanOrderAmount != null ? String(kanbanOrderAmount) : null,
    shopifyVariantId: shopifyVariantId || null,
    shopifyProductTitle: shopifyProductTitle || null,
    shopifyVariantTitle: shopifyVariantTitle || null,
    shopifyUnitsPerPack: shopifyUnitsPerPack != null ? String(shopifyUnitsPerPack) : null,
    perishable: perishable !== false,
    palletSize: palletSize != null ? Number(palletSize) : null,
    caseSizePacks: caseSizePacks != null ? Number(caseSizePacks) : null,
    energyKj: energyKj != null ? String(energyKj) : null,
    energyKcal: energyKcal != null ? String(energyKcal) : null,
    fat: fat != null ? String(fat) : null,
    saturates: saturates != null ? String(saturates) : null,
    carbohydrate: carbohydrate != null ? String(carbohydrate) : null,
    sugars: sugars != null ? String(sugars) : null,
    protein: protein != null ? String(protein) : null,
    fibre: fibre != null ? String(fibre) : null,
    salt: salt != null ? String(salt) : null,
    labelDeclaration: labelDeclaration || null,
    // The declaration is the source of truth for allergens: anything the
    // declaration text implies is auto-added to the ticked list.
    allergens: [...new Set([...(allergens ?? []), ...detectAllergens(labelDeclaration || null)])],
    nutritionalsAiEstimated: !!nutritionalsAiEstimated,
  }).returning();

  generateQrCode("ingredient", row.id)
    .then(async (qrUrl) => {
      await db.update(ingredientsTable).set({ qrCodeUrl: qrUrl }).where(eq(ingredientsTable.id, row.id));
    })
    .catch((err) => console.error(`QR code generation failed for ingredient ${row.id}:`, err));

  res.status(201).json(mapRow(row));
});

// Data-health worklist: every ingredient used by any recipe (directly or
// through nested sub-recipes) that is missing a label declaration or any
// per-100g nutritional value. Powers the Product Hub "Data Health" tab's
// backdating review queue. Declared before "/:id" so the path isn't
// swallowed by the id route.
router.get("/data-health", async (_req, res) => {
  const result = await db.execute<{
    id: number; name: string; brand: string | null; category: string | null;
    label_declaration: string | null; allergens: unknown;
    nutritionals_ai_estimated: boolean; used_by: string[];
    energy_kj: string | null; energy_kcal: string | null; fat: string | null;
    saturates: string | null; carbohydrate: string | null; sugars: string | null;
    protein: string | null; fibre: string | null; salt: string | null;
  }>(sql`
    WITH RECURSIVE subs AS (
      SELECT rsr.recipe_id, rsr.sub_recipe_id FROM recipe_sub_recipes rsr
      UNION
      SELECT s.recipe_id, srs.component_sub_recipe_id
      FROM subs s JOIN sub_recipe_sub_recipes srs ON srs.sub_recipe_id = s.sub_recipe_id
    ),
    used AS (
      SELECT ri.recipe_id, ri.ingredient_id FROM recipe_ingredients ri
      UNION
      SELECT s.recipe_id, sri.ingredient_id
      FROM subs s JOIN sub_recipe_ingredients sri ON sri.sub_recipe_id = s.sub_recipe_id
    )
    SELECT i.id, i.name, i.brand, i.category, i.label_declaration, i.allergens,
      i.nutritionals_ai_estimated,
      i.energy_kj, i.energy_kcal, i.fat, i.saturates, i.carbohydrate,
      i.sugars, i.protein, i.fibre, i.salt,
      array_agg(DISTINCT r.name ORDER BY r.name) AS used_by
    FROM used u
    JOIN ingredients i ON i.id = u.ingredient_id
    JOIN recipes r ON r.id = u.recipe_id
    GROUP BY i.id
    ORDER BY i.name
  `);
  const rows = (result as unknown as { rows: typeof result extends { rows: infer R } ? R : never }).rows
    ?? (result as unknown as Array<Record<string, unknown>>);

  const NUTRIENTS = ["energy_kj", "energy_kcal", "fat", "saturates", "carbohydrate", "sugars", "protein", "fibre", "salt"] as const;
  const NUTRIENT_KEYS: Record<string, string> = {
    energy_kj: "energyKj", energy_kcal: "energyKcal", fat: "fat", saturates: "saturates",
    carbohydrate: "carbohydrate", sugars: "sugars", protein: "protein", fibre: "fibre", salt: "salt",
  };

  const payload = (rows as Array<Record<string, unknown>>)
    .map(r => {
      const missingNutrition = NUTRIENTS.filter(c => r[c] == null).map(c => NUTRIENT_KEYS[c]);
      const missingLabel = r["label_declaration"] == null || r["label_declaration"] === "";
      const allergens = (r["allergens"] as string[] | null) ?? [];
      return {
        id: Number(r["id"]),
        name: String(r["name"]),
        brand: (r["brand"] as string | null) ?? null,
        category: (r["category"] as string | null) ?? null,
        missingLabel,
        missingNutrition,
        emptyAllergens: allergens.length === 0,
        aiEstimated: Boolean(r["nutritionals_ai_estimated"]),
        usedBy: (r["used_by"] as string[] | null) ?? [],
      };
    })
    .filter(r => r.missingLabel || r.missingNutrition.length > 0);

  res.json({ ingredients: payload });
});

// One-off mirror pass over the whole ingredient list: for every ingredient
// with a label declaration, tick any allergen the declaration text implies
// that isn't ticked yet. Add-only — never removes an existing tick. Returns
// exactly what changed so the operator can review.
router.post("/backfill-allergens", async (_req, res) => {
  const rows = await db
    .select({ id: ingredientsTable.id, name: ingredientsTable.name, labelDeclaration: ingredientsTable.labelDeclaration, allergens: ingredientsTable.allergens })
    .from(ingredientsTable)
    .where(isNotNull(ingredientsTable.labelDeclaration));

  const updated: Array<{ id: number; name: string; added: string[] }> = [];
  for (const row of rows) {
    const ticked = (row.allergens as string[] | null) ?? [];
    const missing = detectAllergens(row.labelDeclaration).filter(c => !ticked.includes(c));
    if (missing.length === 0) continue;
    await db.update(ingredientsTable)
      .set({ allergens: [...ticked, ...missing] })
      .where(eq(ingredientsTable.id, row.id));
    updated.push({ id: row.id, name: row.name, added: missing.map(c => ALLERGEN_DISPLAY[c] || c) });
  }
  res.json({ scanned: rows.length, updatedCount: updated.length, updated });
});

router.post("/backfill-qr", async (_req, res) => {
  const rows = await db.select({ id: ingredientsTable.id })
    .from(ingredientsTable)
    .where(isNull(ingredientsTable.qrCodeUrl));

  let success = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const qrUrl = await generateQrCode("ingredient", row.id);
      await db.update(ingredientsTable).set({ qrCodeUrl: qrUrl }).where(eq(ingredientsTable.id, row.id));
      success++;
    } catch (err) {
      console.error(`QR backfill failed for ingredient ${row.id}:`, err);
      failed++;
    }
  }
  res.json({ total: rows.length, success, failed });
});

router.get("/:id/kanban-card", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  let supplierName: string | null = null;
  if (row.supplierId) {
    const [sup] = await db.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, row.supplierId));
    if (sup) supplierName = sup.name;
  }

  const locRows = await db
    .select({ name: storageLocationsTable.name })
    .from(ingredientStorageLocationsTable)
    .innerJoin(storageLocationsTable, eq(ingredientStorageLocationsTable.locationId, storageLocationsTable.id))
    .where(eq(ingredientStorageLocationsTable.ingredientId, id));
  const location = locRows.map(l => l.name).join(", ") || null;

  res.json({
    id: row.id,
    name: row.name,
    unit: row.unit,
    packWeight: Number(row.packWeight),
    kanbanQuantity: Number(row.kanbanQuantity ?? 0),
    kanbanUnit: row.kanbanUnit ?? "weight",
    kanbanOrderAmount: row.kanbanOrderAmount != null ? Number(row.kanbanOrderAmount) : null,
    supplier: supplierName,
    supplierPartNumber: row.supplierPartNumber ?? null,
    location,
    qrCodeUrl: row.qrCodeUrl,
  });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

// Where is this ingredient used? Returns recipes that contain it directly, the
// sub-recipes that contain it, and the recipes that use those sub-recipes
// (transitive). Used by the inventory page's "used in" count to pop a list.
router.get("/:id/usage", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const direct = await db.execute(sql`
    SELECT DISTINCT r.id, r.name
    FROM recipes r
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    WHERE ri.ingredient_id = ${id}
    ORDER BY r.name
  `);
  const directRows = (direct as unknown as { rows: Array<{ id: number; name: string }> }).rows;

  const subs = await db.execute(sql`
    SELECT DISTINCT sr.id, sr.name
    FROM sub_recipes sr
    JOIN sub_recipe_ingredients sri ON sri.sub_recipe_id = sr.id
    WHERE sri.ingredient_id = ${id}
    ORDER BY sr.name
  `);
  const subRows = (subs as unknown as { rows: Array<{ id: number; name: string }> }).rows;

  let viaSubRecipes: Array<{ id: number; name: string; viaSubRecipe: { id: number; name: string } }> = [];
  if (subRows.length > 0) {
    const subIds = subRows.map(s => Number(s.id));
    const transitive = await db.execute(sql`
      SELECT DISTINCT r.id AS recipe_id, r.name AS recipe_name, sr.id AS sub_recipe_id, sr.name AS sub_recipe_name
      FROM recipes r
      JOIN recipe_sub_recipes rsr ON rsr.recipe_id = r.id
      JOIN sub_recipes sr ON sr.id = rsr.sub_recipe_id
      WHERE rsr.sub_recipe_id IN (${sql.join(subIds.map(i => sql`${i}`), sql`, `)})
      ORDER BY r.name
    `);
    const tRows = (transitive as unknown as { rows: Array<{ recipe_id: number; recipe_name: string; sub_recipe_id: number; sub_recipe_name: string }> }).rows;
    viaSubRecipes = tRows.map(t => ({
      id: Number(t.recipe_id),
      name: t.recipe_name,
      viaSubRecipe: { id: Number(t.sub_recipe_id), name: t.sub_recipe_name },
    }));
  }

  res.json({
    recipes: directRows.map(r => ({ id: Number(r.id), name: r.name })),
    subRecipes: subRows.map(s => ({ id: Number(s.id), name: s.name })),
    viaSubRecipes,
  });
});

router.put("/:id", validate(UpdateIngredientBody), async (req, res) => {
  const id = Number(req.params.id);
  const { name, unit, packWeight, costPerPack, brand, supplierPartNumber, supplierId, secondarySupplierId, orderingUrl, notes, processingRatio, rawMeatTrayCapacityKg, minCookingTempC, estimatedCookTimeMin, meatProcessMinutes, ovenTempC, steamPct, category, prepWeightMode, isBottle, bottleSize, prepCountPerPortion, isPasta, stockInPacks, stockCheckEnabled, stockCheckFrequency, stockCheckDay, surplusPercent, surplusMode, surplusAbsoluteQty, shelfLifeDays, requiresUseByDate, kanbanEnabled, kanbanQuantity, kanbanUnit, kanbanOrderAmount, shopifyVariantId, shopifyProductTitle, shopifyVariantTitle, shopifyUnitsPerPack, perishable, palletSize, caseSizePacks, energyKj, energyKcal, fat, saturates, carbohydrate, sugars, protein, fibre, salt, labelDeclaration, allergens, nutritionalsAiEstimated, novaClass } = req.body;
  const ratioError = validateProcessingRatio(processingRatio);
  if (ratioError) { res.status(400).json({ error: ratioError }); return; }
  if (novaClass !== undefined && novaClass !== null && ![1, 2, 3, 4].includes(Number(novaClass))) {
    res.status(400).json({ error: "novaClass must be 1-4 or null" });
    return;
  }
  // The form round-trips novaClass on every save, so only treat it as a
  // manual override when it actually changed — otherwise an untouched AI
  // classification would get relabelled 'manual' and the batch analyzer
  // would skip it forever.
  let novaChanged = false;
  if (novaClass !== undefined) {
    const [current] = await db.select({ novaClass: ingredientsTable.novaClass }).from(ingredientsTable).where(eq(ingredientsTable.id, id));
    novaChanged = current != null && (current.novaClass ?? null) !== (novaClass != null ? Number(novaClass) : null);
  }
  // Need the effective packWeight: explicit override in body or fall back to the
  // stored value so toggling stockInPacks on doesn't require re-entering the pack size.
  let effectivePackWeight = packWeight;
  if (stockInPacks === true && (packWeight === undefined || packWeight === null)) {
    const [existing] = await db.select({ packWeight: ingredientsTable.packWeight }).from(ingredientsTable).where(eq(ingredientsTable.id, id));
    if (existing) effectivePackWeight = Number(existing.packWeight);
  }
  const packsError = validateStockInPacks(stockInPacks, effectivePackWeight);
  if (packsError) { res.status(400).json({ error: packsError }); return; }

  // Declaration → ticks mirroring. When the declaration text is set or
  // changed, allergens implied by the new text are auto-added to the ticks
  // (the deck text is the source of truth). When the declaration is
  // unchanged, the submitted ticks are respected as-is — so a manually
  // removed false positive stays removed until the text itself changes.
  let effectiveAllergens: string[] | undefined = allergens;
  if (labelDeclaration !== undefined && (labelDeclaration || null) !== null) {
    const [cur] = await db
      .select({ labelDeclaration: ingredientsTable.labelDeclaration, allergens: ingredientsTable.allergens })
      .from(ingredientsTable).where(eq(ingredientsTable.id, id));
    if ((cur?.labelDeclaration ?? null) !== labelDeclaration) {
      const base = allergens ?? (cur?.allergens as string[] | null) ?? [];
      effectiveAllergens = [...new Set([...base, ...detectAllergens(labelDeclaration)])];
    }
  }

  const [row] = await db.update(ingredientsTable).set({
    name,
    unit,
    packWeight: String(packWeight ?? 0),
    costPerPack: String(costPerPack ?? 0),
    brand: brand || null,
    supplierPartNumber: supplierPartNumber || null,
    supplierId: supplierId ? Number(supplierId) : null,
    secondarySupplierId: secondarySupplierId ? Number(secondarySupplierId) : null,
    orderingUrl: orderingUrl || null,
    notes: notes || null,
    category: category || null,
    processingRatio: processingRatio !== null && processingRatio !== undefined ? String(processingRatio) : null,
    ...(prepWeightMode !== undefined ? { prepWeightMode } : {}),
    rawMeatTrayCapacityKg: rawMeatTrayCapacityKg !== null && rawMeatTrayCapacityKg !== undefined ? String(rawMeatTrayCapacityKg) : null,
    minCookingTempC: minCookingTempC !== null && minCookingTempC !== undefined ? String(minCookingTempC) : null,
    estimatedCookTimeMin: estimatedCookTimeMin != null ? Number(estimatedCookTimeMin) : null,
    meatProcessMinutes: meatProcessMinutes != null ? Number(meatProcessMinutes) : null,
    ovenTempC: ovenTempC != null ? Number(ovenTempC) : null,
    steamPct: steamPct != null ? Number(steamPct) : null,
    ...(isBottle !== undefined ? { isBottle } : {}),
    ...(bottleSize !== undefined ? { bottleSize: bottleSize != null ? String(bottleSize) : null } : {}),
    ...(prepCountPerPortion !== undefined ? { prepCountPerPortion: prepCountPerPortion != null ? Number(prepCountPerPortion) : null } : {}),
    ...(isPasta !== undefined ? { isPasta } : {}),
    ...(stockInPacks !== undefined ? { stockInPacks: !!stockInPacks } : {}),
    ...(stockCheckEnabled !== undefined ? { stockCheckEnabled } : {}),
    ...(stockCheckFrequency !== undefined ? { stockCheckFrequency } : {}),
    stockCheckDay: stockCheckDay || null,
    ...(surplusPercent !== undefined ? { surplusPercent: String(surplusPercent) } : {}),
    ...(surplusMode !== undefined ? { surplusMode: surplusMode === "absolute" ? "absolute" : "percent" } : {}),
    ...(surplusAbsoluteQty !== undefined ? { surplusAbsoluteQty: surplusAbsoluteQty != null ? String(surplusAbsoluteQty) : null } : {}),
    ...(shelfLifeDays !== undefined ? { shelfLifeDays: shelfLifeDays != null ? Number(shelfLifeDays) : null } : {}),
    ...(requiresUseByDate !== undefined ? { requiresUseByDate: !!requiresUseByDate } : {}),
    ...(kanbanEnabled !== undefined ? { kanbanEnabled } : {}),
    ...(kanbanQuantity !== undefined ? { kanbanQuantity: kanbanQuantity != null ? String(kanbanQuantity) : "0" } : {}),
    ...(kanbanUnit !== undefined ? { kanbanUnit } : {}),
    ...(kanbanOrderAmount !== undefined ? { kanbanOrderAmount: kanbanOrderAmount != null ? String(kanbanOrderAmount) : null } : {}),
    ...(shopifyVariantId !== undefined ? { shopifyVariantId: shopifyVariantId || null } : {}),
    ...(shopifyProductTitle !== undefined ? { shopifyProductTitle: shopifyProductTitle || null } : {}),
    ...(shopifyVariantTitle !== undefined ? { shopifyVariantTitle: shopifyVariantTitle || null } : {}),
    ...(shopifyUnitsPerPack !== undefined ? { shopifyUnitsPerPack: shopifyUnitsPerPack != null ? String(shopifyUnitsPerPack) : null } : {}),
    ...(perishable !== undefined ? { perishable } : {}),
    ...(palletSize !== undefined ? { palletSize: palletSize != null ? Number(palletSize) : null } : {}),
    ...(caseSizePacks !== undefined ? { caseSizePacks: caseSizePacks != null ? Number(caseSizePacks) : null } : {}),
    ...(energyKj !== undefined ? { energyKj: energyKj != null ? String(energyKj) : null } : {}),
    ...(energyKcal !== undefined ? { energyKcal: energyKcal != null ? String(energyKcal) : null } : {}),
    ...(fat !== undefined ? { fat: fat != null ? String(fat) : null } : {}),
    ...(saturates !== undefined ? { saturates: saturates != null ? String(saturates) : null } : {}),
    ...(carbohydrate !== undefined ? { carbohydrate: carbohydrate != null ? String(carbohydrate) : null } : {}),
    ...(sugars !== undefined ? { sugars: sugars != null ? String(sugars) : null } : {}),
    ...(protein !== undefined ? { protein: protein != null ? String(protein) : null } : {}),
    ...(fibre !== undefined ? { fibre: fibre != null ? String(fibre) : null } : {}),
    ...(salt !== undefined ? { salt: salt != null ? String(salt) : null } : {}),
    ...(labelDeclaration !== undefined ? { labelDeclaration: labelDeclaration || null } : {}),
    ...(effectiveAllergens !== undefined ? { allergens: effectiveAllergens ?? [] } : {}),
    ...(nutritionalsAiEstimated !== undefined ? { nutritionalsAiEstimated: !!nutritionalsAiEstimated } : {}),
    // Manual NOVA override from the form. Marked 'manual' so the batch
    // analyzer never overwrites it. Clearing (null) re-opens it to AI.
    ...(novaChanged ? {
      novaClass: novaClass != null ? Number(novaClass) : null,
      novaSource: novaClass != null ? "manual" : null,
      novaConfidence: novaClass != null ? "high" : null,
      novaReasoning: novaClass != null ? "Set manually" : null,
      novaMarkers: [] as string[],
      novaAnalyzedAt: novaClass != null ? new Date() : null,
    } : {}),
  }).where(eq(ingredientsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

// Sixteen tables hold foreign keys into ingredients — recipes and prep the
// operator can unpick, but also history that must never be unpicked
// (purchase orders, stock entries, prep completions). A referenced
// ingredient therefore can't be hard-deleted; explain what's holding it
// instead of surfacing a raw FK error (2026-07-31: duplicate Oregano).
router.delete("/:id", requireManagerOrAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid ingredient id" }); return; }

  try {
    await db.delete(ingredientsTable).where(eq(ingredientsTable.id, id));
    res.status(204).send();
  } catch (err) {
    const pgCode =
      (err as { cause?: { code?: string } }).cause?.code ??
      (err as { code?: string }).code;
    if (pgCode !== "23503") {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ingredients] delete error:", msg);
      res.status(500).json({ error: msg });
      return;
    }

    // Build a human explanation of what still references it.
    const [ing] = await db.select({ name: ingredientsTable.name })
      .from(ingredientsTable).where(eq(ingredientsTable.id, id));
    const name = ing?.name ?? `Ingredient ${id}`;

    const [recipes, subRecipes, historyCounts] = await Promise.all([
      db.execute<{ name: string }>(sql`
        SELECT DISTINCT r.name FROM recipes r
        WHERE r.id IN (
          SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id = ${id} OR marinade_for_ingredient_id = ${id}
          UNION SELECT recipe_id FROM recipe_meat_marinades WHERE raw_meat_ingredient_id = ${id} OR marinade_ingredient_id = ${id}
          UNION SELECT recipe_id FROM recipe_sub_recipes WHERE marinade_for_ingredient_id = ${id}
        ) ORDER BY r.name
      `),
      db.execute<{ name: string }>(sql`
        SELECT DISTINCT s.name FROM sub_recipes s
        JOIN sub_recipe_ingredients si ON si.sub_recipe_id = s.id
        WHERE si.ingredient_id = ${id} ORDER BY s.name
      `),
      db.execute<{ purchase_orders: number; stock_rows: number; prep_rows: number; kanbans: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM purchase_order_lines WHERE ingredient_id = ${id}) AS purchase_orders,
          (SELECT count(*)::int FROM stock_entries WHERE ingredient_id = ${id})
            + (SELECT count(*)::int FROM stock_transfers WHERE ingredient_id = ${id})
            + (SELECT count(*)::int FROM daily_stock_checks WHERE ingredient_id = ${id}) AS stock_rows,
          (SELECT count(*)::int FROM prep_completions WHERE ingredient_id = ${id})
            + (SELECT count(*)::int FROM prep_deferrals WHERE ingredient_id = ${id}) AS prep_rows,
          (SELECT count(*)::int FROM kanban_items WHERE ingredient_id = ${id}) AS kanbans
      `),
    ]);

    const h = historyCounts.rows[0];
    const parts: string[] = [];
    const recipeNames = recipes.rows.map(r => r.name);
    const subNames = subRecipes.rows.map(r => r.name);
    if (recipeNames.length) parts.push(`recipes: ${recipeNames.slice(0, 5).join(", ")}${recipeNames.length > 5 ? ` (+${recipeNames.length - 5} more)` : ""}`);
    if (subNames.length) parts.push(`sub-recipes: ${subNames.slice(0, 5).join(", ")}${subNames.length > 5 ? ` (+${subNames.length - 5} more)` : ""}`);
    if (h && h.purchase_orders > 0) parts.push(`${h.purchase_orders} purchase-order line${h.purchase_orders === 1 ? "" : "s"}`);
    if (h && h.stock_rows > 0) parts.push(`${h.stock_rows} stock record${h.stock_rows === 1 ? "" : "s"}`);
    if (h && h.prep_rows > 0) parts.push(`${h.prep_rows} prep record${h.prep_rows === 1 ? "" : "s"}`);
    if (h && h.kanbans > 0) parts.push(`${h.kanbans} kanban item${h.kanbans === 1 ? "" : "s"}`);

    const usage = parts.length ? parts.join(" · ") : "other records";
    const hasHistory = !!h && (h.purchase_orders > 0 || h.stock_rows > 0 || h.prep_rows > 0);
    res.status(409).json({
      error: `Can't delete "${name}" — still referenced by ${usage}.` +
        (recipeNames.length || subNames.length ? " Remove it from those recipes first." : "") +
        (hasHistory ? " Order/stock history can't be detached — mark the ingredient inactive instead of deleting it." : ""),
      usedBy: {
        recipes: recipeNames,
        subRecipes: subNames,
        purchaseOrderLines: h?.purchase_orders ?? 0,
        stockRecords: h?.stock_rows ?? 0,
        prepRecords: h?.prep_rows ?? 0,
        kanbanItems: h?.kanbans ?? 0,
      },
    });
  }
});

interface ImportRow {
  name?: string;
  unit?: string;
  pack_weight?: string;
  cost_per_pack?: string;
  brand?: string;
  supplier_name?: string;
  secondary_supplier_name?: string;
  supplier_part_number?: string;
  ordering_url?: string;
  notes?: string;
  processing_ratio_percent?: string;
}

interface ImportIssue {
  row: number;
  field: string;
  message: string;
}

router.post("/import", async (req, res) => {
  const { rows, dryRun = false } = req.body as { rows: ImportRow[]; dryRun?: boolean };

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows must be a non-empty array" });
    return;
  }

  const existingSuppliers = await db.select().from(suppliersTable);
  const existingIngredients = await db.select().from(ingredientsTable);

  const supplierByName = new Map(existingSuppliers.map(s => [s.name.toLowerCase().trim(), s]));
  const ingredientByName = new Map(existingIngredients.map(i => [i.name.toLowerCase().trim(), i]));

  const created: { name: string }[] = [];
  const updated: { name: string; changes: string[] }[] = [];
  const issues: ImportIssue[] = [];
  const suppliersCreated: string[] = [];
  const newSupplierIds = new Map<string, number>();

  async function resolveSupplier(nameRaw: string | undefined, rowNum: number, field: string): Promise<number | null> {
    if (!nameRaw?.trim()) return null;
    const key = nameRaw.trim().toLowerCase();
    if (supplierByName.has(key)) return supplierByName.get(key)!.id;
    if (newSupplierIds.has(key)) return newSupplierIds.get(key)!;
    if (!dryRun) {
      const [s] = await db.insert(suppliersTable).values({ name: nameRaw.trim() }).returning();
      supplierByName.set(key, s);
      newSupplierIds.set(key, s.id);
      return s.id;
    }
    if (!suppliersCreated.includes(nameRaw.trim())) suppliersCreated.push(nameRaw.trim());
    newSupplierIds.set(key, -1);
    return null;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    if (!row.name?.trim()) {
      issues.push({ row: rowNum, field: "name", message: "Name is required — row skipped" });
      continue;
    }
    if (!row.unit?.trim()) {
      issues.push({ row: rowNum, field: "unit", message: "Unit is required" });
    }

    const packWeight = row.pack_weight ? Number(row.pack_weight) : 0;
    const costPerPack = row.cost_per_pack ? Number(row.cost_per_pack) : 0;
    let processingRatio: number | null = null;

    if (row.pack_weight && isNaN(packWeight)) {
      issues.push({ row: rowNum, field: "pack_weight", message: `"${row.pack_weight}" is not a valid number` });
    }
    if (row.cost_per_pack && isNaN(costPerPack)) {
      issues.push({ row: rowNum, field: "cost_per_pack", message: `"${row.cost_per_pack}" is not a valid number` });
    }
    if (row.processing_ratio_percent?.trim()) {
      const pct = Number(row.processing_ratio_percent);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        issues.push({ row: rowNum, field: "processing_ratio_percent", message: `"${row.processing_ratio_percent}" must be 0–100` });
      } else {
        processingRatio = pct / 100;
      }
    }

    const supplierId = await resolveSupplier(row.supplier_name, rowNum, "supplier_name");
    const secondarySupplierId = await resolveSupplier(row.secondary_supplier_name, rowNum, "secondary_supplier_name");

    if (row.supplier_name?.trim() && !suppliersCreated.includes(row.supplier_name.trim()) && !supplierByName.has(row.supplier_name.trim().toLowerCase())) {
      suppliersCreated.push(row.supplier_name.trim());
    }
    if (row.secondary_supplier_name?.trim() && !suppliersCreated.includes(row.secondary_supplier_name.trim()) && !supplierByName.has(row.secondary_supplier_name.trim().toLowerCase())) {
      suppliersCreated.push(row.secondary_supplier_name.trim());
    }

    const nameKey = row.name.trim().toLowerCase();
    const values = {
      name: row.name.trim(),
      unit: (row.unit?.trim()) || "kg",
      packWeight: String(isNaN(packWeight) ? 0 : packWeight),
      costPerPack: String(isNaN(costPerPack) ? 0 : costPerPack),
      brand: row.brand?.trim() || null,
      supplierPartNumber: row.supplier_part_number?.trim() || null,
      supplierId: supplierId,
      secondarySupplierId: secondarySupplierId,
      orderingUrl: row.ordering_url?.trim() || null,
      notes: row.notes?.trim() || null,
      processingRatio: processingRatio !== null ? String(processingRatio) : null,
    };

    if (ingredientByName.has(nameKey)) {
      const existing = ingredientByName.get(nameKey)!;
      const changes: string[] = [];
      if (existing.unit !== values.unit) changes.push(`unit: ${existing.unit} → ${values.unit}`);
      if (Number(existing.packWeight) !== (isNaN(packWeight) ? 0 : packWeight)) changes.push(`pack weight updated`);
      if (Number(existing.costPerPack) !== (isNaN(costPerPack) ? 0 : costPerPack)) changes.push(`cost updated`);
      updated.push({ name: row.name.trim(), changes });
      if (!dryRun) {
        await db.update(ingredientsTable).set(values).where(eq(ingredientsTable.id, existing.id));
      }
    } else {
      created.push({ name: row.name.trim() });
      if (!dryRun) {
        const [r] = await db.insert(ingredientsTable).values(values).returning();
        ingredientByName.set(nameKey, r);
      } else {
        ingredientByName.set(nameKey, { id: -1, ...values, createdAt: new Date() } as typeof ingredientsTable.$inferSelect);
      }
    }
  }

  res.json({ created, updated, issues, suppliersCreated, dryRun });
});

export default router;
