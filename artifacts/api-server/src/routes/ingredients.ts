import { Router, type IRouter } from "express";
import { db, ingredientsTable, suppliersTable, recipeIngredientsTable, subRecipeIngredientsTable, ingredientStorageLocationsTable, storageLocationsTable } from "@workspace/db";
import { eq, sql, inArray, isNull } from "drizzle-orm";
import { CreateIngredientBody, UpdateIngredientBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
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
    ovenTempC: r.ovenTempC ?? null,
    steamPct: r.steamPct ?? null,
    surplusPercent: Number(r.surplusPercent),
    shelfLifeDays: r.shelfLifeDays ?? null,
    kanbanEnabled: r.kanbanEnabled ?? false,
    kanbanQuantity: Number(r.kanbanQuantity ?? 0),
    kanbanUnit: r.kanbanUnit ?? "weight",
    kanbanOrderAmount: r.kanbanOrderAmount != null ? Number(r.kanbanOrderAmount) : null,
    perishable: r.perishable ?? true,
    palletSize: r.palletSize ?? null,
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
    isBottle: r.isBottle ?? false,
    bottleSize: r.bottleSize != null ? Number(r.bottleSize) : null,
    allergens: (r.allergens as string[] | null) ?? [],
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/", async (req, res) => {
  const { perishable } = req.query;
  let query = db.select().from(ingredientsTable).orderBy(ingredientsTable.name).$dynamic();
  if (perishable === "true") query = query.where(eq(ingredientsTable.perishable, true));
  else if (perishable === "false") query = query.where(eq(ingredientsTable.perishable, false));
  const rows = await query;

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
  const { name, unit, packWeight, costPerPack, brand, supplierPartNumber, supplierId, secondarySupplierId, orderingUrl, notes, processingRatio, rawMeatTrayCapacityKg, minCookingTempC, estimatedCookTimeMin, ovenTempC, steamPct, category, prepWeightMode, isBottle, bottleSize, stockCheckEnabled, stockCheckFrequency, stockCheckDay, surplusPercent, shelfLifeDays, kanbanEnabled, kanbanQuantity, kanbanUnit, kanbanOrderAmount, perishable, palletSize, energyKj, energyKcal, fat, saturates, carbohydrate, sugars, protein, fibre, salt, labelDeclaration, allergens } = req.body;
  const ratioError = validateProcessingRatio(processingRatio);
  if (ratioError) { res.status(400).json({ error: ratioError }); return; }
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
    ovenTempC: ovenTempC != null ? Number(ovenTempC) : null,
    steamPct: steamPct != null ? Number(steamPct) : null,
    isBottle: isBottle ?? false,
    bottleSize: bottleSize != null ? String(bottleSize) : null,
    stockCheckEnabled: stockCheckEnabled ?? false,
    stockCheckFrequency: stockCheckFrequency ?? "daily",
    stockCheckDay: stockCheckDay || null,
    surplusPercent: surplusPercent != null ? String(surplusPercent) : "10",
    shelfLifeDays: shelfLifeDays != null ? Number(shelfLifeDays) : null,
    kanbanEnabled: kanbanEnabled ?? false,
    kanbanQuantity: kanbanQuantity != null ? String(kanbanQuantity) : "0",
    kanbanUnit: kanbanUnit ?? "weight",
    kanbanOrderAmount: kanbanOrderAmount != null ? String(kanbanOrderAmount) : null,
    perishable: perishable !== false,
    palletSize: palletSize != null ? Number(palletSize) : null,
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
    allergens: allergens ?? [],
  }).returning();

  generateQrCode("ingredient", row.id)
    .then(async (qrUrl) => {
      await db.update(ingredientsTable).set({ qrCodeUrl: qrUrl }).where(eq(ingredientsTable.id, row.id));
    })
    .catch((err) => console.error(`QR code generation failed for ingredient ${row.id}:`, err));

  res.status(201).json(mapRow(row));
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

router.put("/:id", validate(UpdateIngredientBody), async (req, res) => {
  const id = Number(req.params.id);
  const { name, unit, packWeight, costPerPack, brand, supplierPartNumber, supplierId, secondarySupplierId, orderingUrl, notes, processingRatio, rawMeatTrayCapacityKg, minCookingTempC, estimatedCookTimeMin, ovenTempC, steamPct, category, prepWeightMode, isBottle, bottleSize, stockCheckEnabled, stockCheckFrequency, stockCheckDay, surplusPercent, shelfLifeDays, kanbanEnabled, kanbanQuantity, kanbanUnit, kanbanOrderAmount, perishable, palletSize, energyKj, energyKcal, fat, saturates, carbohydrate, sugars, protein, fibre, salt, labelDeclaration, allergens } = req.body;
  const ratioError = validateProcessingRatio(processingRatio);
  if (ratioError) { res.status(400).json({ error: ratioError }); return; }
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
    ovenTempC: ovenTempC != null ? Number(ovenTempC) : null,
    steamPct: steamPct != null ? Number(steamPct) : null,
    ...(isBottle !== undefined ? { isBottle } : {}),
    ...(bottleSize !== undefined ? { bottleSize: bottleSize != null ? String(bottleSize) : null } : {}),
    ...(stockCheckEnabled !== undefined ? { stockCheckEnabled } : {}),
    ...(stockCheckFrequency !== undefined ? { stockCheckFrequency } : {}),
    stockCheckDay: stockCheckDay || null,
    ...(surplusPercent !== undefined ? { surplusPercent: String(surplusPercent) } : {}),
    ...(shelfLifeDays !== undefined ? { shelfLifeDays: shelfLifeDays != null ? Number(shelfLifeDays) : null } : {}),
    ...(kanbanEnabled !== undefined ? { kanbanEnabled } : {}),
    ...(kanbanQuantity !== undefined ? { kanbanQuantity: kanbanQuantity != null ? String(kanbanQuantity) : "0" } : {}),
    ...(kanbanUnit !== undefined ? { kanbanUnit } : {}),
    ...(kanbanOrderAmount !== undefined ? { kanbanOrderAmount: kanbanOrderAmount != null ? String(kanbanOrderAmount) : null } : {}),
    ...(perishable !== undefined ? { perishable } : {}),
    ...(palletSize !== undefined ? { palletSize: palletSize != null ? Number(palletSize) : null } : {}),
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
    ...(allergens !== undefined ? { allergens: allergens ?? [] } : {}),
  }).where(eq(ingredientsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(ingredientsTable).where(eq(ingredientsTable.id, id));
  res.status(204).send();
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
