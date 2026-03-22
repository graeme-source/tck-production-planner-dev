import { Router, type IRouter } from "express";
import { db, ingredientsTable, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateIngredientBody, UpdateIngredientBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

function mapRow(r: typeof ingredientsTable.$inferSelect) {
  return {
    ...r,
    packWeight: Number(r.packWeight),
    costPerPack: Number(r.costPerPack),
    processingRatio: r.processingRatio !== null && r.processingRatio !== undefined ? Number(r.processingRatio) : null,
    rawMeatTrayCapacityKg: r.rawMeatTrayCapacityKg !== null && r.rawMeatTrayCapacityKg !== undefined ? Number(r.rawMeatTrayCapacityKg) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(ingredientsTable).orderBy(ingredientsTable.name);
  res.json(rows.map(mapRow));
});

function validateProcessingRatio(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (isNaN(n) || n < 0 || n > 1) return "processingRatio must be a number between 0 and 1";
  return null;
}

router.post("/", validate(CreateIngredientBody), async (req, res) => {
  const { name, unit, packWeight, costPerPack, brand, supplierPartNumber, supplierId, secondarySupplierId, orderingUrl, notes, processingRatio, rawMeatTrayCapacityKg, category, stockCheckEnabled } = req.body;
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
    rawMeatTrayCapacityKg: rawMeatTrayCapacityKg !== null && rawMeatTrayCapacityKg !== undefined ? String(rawMeatTrayCapacityKg) : null,
    stockCheckEnabled: stockCheckEnabled ?? false,
  }).returning();
  res.status(201).json(mapRow(row));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.put("/:id", validate(UpdateIngredientBody), async (req, res) => {
  const id = Number(req.params.id);
  const { name, unit, packWeight, costPerPack, brand, supplierPartNumber, supplierId, secondarySupplierId, orderingUrl, notes, processingRatio, rawMeatTrayCapacityKg, category, stockCheckEnabled } = req.body;
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
    rawMeatTrayCapacityKg: rawMeatTrayCapacityKg !== null && rawMeatTrayCapacityKg !== undefined ? String(rawMeatTrayCapacityKg) : null,
    ...(stockCheckEnabled !== undefined ? { stockCheckEnabled } : {}),
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
