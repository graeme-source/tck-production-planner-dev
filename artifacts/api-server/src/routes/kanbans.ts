import { Router, type IRouter } from "express";
import { db, kanbanItemsTable, ingredientsTable, suppliersTable, usersTable, recipesTable, subRecipesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { computeNextOrderDay, formatOrderDayTarget, getOrderDayLabel, isDueToday } from "../lib/order-day-scheduler";
import { londonDateString } from "../lib/london-time";

const router: IRouter = Router();

function mapRow(r: any) {
  return {
    id: r.id,
    ingredientId: r.ingredientId ?? null,
    sourceType: r.sourceType ?? "ingredient",
    recipeId: r.recipeId ?? null,
    subRecipeId: r.subRecipeId ?? null,
    qrCodeUrl: r.qrCodeUrl ?? null,
    ingredientName: r.ingredientName ?? null,
    ingredientUnit: r.ingredientUnit ?? null,
    kanbanQuantity: r.kanbanQuantity != null ? Number(r.kanbanQuantity) : null,
    kanbanUnit: r.kanbanUnit ?? "weight",
    supplierId: r.supplierId,
    supplierName: r.supplierName ?? null,
    orderFrequency: r.orderFrequency ?? "daily",
    orderDays: r.orderDays ?? null,
    status: r.status,
    pulledAt: r.pulledAt ? r.pulledAt.toISOString() : null,
    pulledByUserId: r.pulledByUserId,
    pulledByName: r.pulledByName ?? null,
    orderDayTarget: r.orderDayTarget ?? null,
    orderDayLabel: getOrderDayLabel(r.orderDayTarget, r.orderFrequency ?? "daily"),
    isDueToday: isDueToday(r.orderDayTarget, r.orderFrequency ?? "daily"),
    notes: r.notes,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
  };
}

router.get("/", async (_req, res) => {
  const rows = await db
    .select({
      id: kanbanItemsTable.id,
      ingredientId: kanbanItemsTable.ingredientId,
      sourceType: kanbanItemsTable.sourceType,
      recipeId: kanbanItemsTable.recipeId,
      subRecipeId: kanbanItemsTable.subRecipeId,
      qrCodeUrl: kanbanItemsTable.qrCodeUrl,
      ingredientName: ingredientsTable.name,
      ingredientUnit: ingredientsTable.unit,
      kanbanQuantity: ingredientsTable.kanbanQuantity,
      kanbanUnit: ingredientsTable.kanbanUnit,
      supplierId: kanbanItemsTable.supplierId,
      supplierName: suppliersTable.name,
      orderFrequency: suppliersTable.orderFrequency,
      orderDays: suppliersTable.orderDays,
      status: kanbanItemsTable.status,
      pulledAt: kanbanItemsTable.pulledAt,
      pulledByUserId: kanbanItemsTable.pulledByUserId,
      pulledByName: usersTable.name,
      orderDayTarget: kanbanItemsTable.orderDayTarget,
      notes: kanbanItemsTable.notes,
      createdAt: kanbanItemsTable.createdAt,
    })
    .from(kanbanItemsTable)
    .leftJoin(ingredientsTable, eq(kanbanItemsTable.ingredientId, ingredientsTable.id))
    .leftJoin(suppliersTable, eq(kanbanItemsTable.supplierId, suppliersTable.id))
    .leftJoin(usersTable, eq(kanbanItemsTable.pulledByUserId, usersTable.id))
    .orderBy(kanbanItemsTable.createdAt);

  res.json(rows.map(mapRow));
});

router.post("/", async (req, res) => {
  const { ingredientId, supplierId, notes } = req.body;
  if (!ingredientId) {
    res.status(400).json({ error: "ingredientId is required" });
    return;
  }

  const [row] = await db.insert(kanbanItemsTable).values({
    ingredientId: Number(ingredientId),
    supplierId: supplierId ? Number(supplierId) : null,
    status: "active",
    notes: notes || null,
  }).returning();

  const [full] = await db
    .select({
      id: kanbanItemsTable.id,
      ingredientId: kanbanItemsTable.ingredientId,
      sourceType: kanbanItemsTable.sourceType,
      recipeId: kanbanItemsTable.recipeId,
      subRecipeId: kanbanItemsTable.subRecipeId,
      qrCodeUrl: kanbanItemsTable.qrCodeUrl,
      ingredientName: ingredientsTable.name,
      ingredientUnit: ingredientsTable.unit,
      kanbanQuantity: ingredientsTable.kanbanQuantity,
      kanbanUnit: ingredientsTable.kanbanUnit,
      supplierId: kanbanItemsTable.supplierId,
      supplierName: suppliersTable.name,
      orderFrequency: suppliersTable.orderFrequency,
      orderDays: suppliersTable.orderDays,
      status: kanbanItemsTable.status,
      pulledAt: kanbanItemsTable.pulledAt,
      pulledByUserId: kanbanItemsTable.pulledByUserId,
      pulledByName: usersTable.name,
      orderDayTarget: kanbanItemsTable.orderDayTarget,
      notes: kanbanItemsTable.notes,
      createdAt: kanbanItemsTable.createdAt,
    })
    .from(kanbanItemsTable)
    .leftJoin(ingredientsTable, eq(kanbanItemsTable.ingredientId, ingredientsTable.id))
    .leftJoin(suppliersTable, eq(kanbanItemsTable.supplierId, suppliersTable.id))
    .leftJoin(usersTable, eq(kanbanItemsTable.pulledByUserId, usersTable.id))
    .where(eq(kanbanItemsTable.id, row.id));

  res.status(201).json(mapRow(full));
});

router.get("/ingredients", async (_req, res) => {
  const rows = await db
    .select({
      ingredientId: ingredientsTable.id,
      ingredientName: ingredientsTable.name,
      ingredientUnit: ingredientsTable.unit,
      kanbanQuantity: ingredientsTable.kanbanQuantity,
      kanbanOrderAmount: ingredientsTable.kanbanOrderAmount,
      kanbanUnit: ingredientsTable.kanbanUnit,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
      supplierId: ingredientsTable.supplierId,
      supplierName: suppliersTable.name,
      secondarySupplierId: ingredientsTable.secondarySupplierId,
      // Carried through to order lines built from the Add Kanbans dialog so
      // they show the ordering link + part number like calc-generated lines.
      supplierPartNumber: ingredientsTable.supplierPartNumber,
      orderingUrl: ingredientsTable.orderingUrl,
    })
    .from(ingredientsTable)
    .leftJoin(suppliersTable, eq(ingredientsTable.supplierId, suppliersTable.id))
    .where(eq(ingredientsTable.kanbanEnabled, true))
    .orderBy(ingredientsTable.name);

  res.json(rows.map(r => ({
    ingredientId: r.ingredientId,
    ingredientName: r.ingredientName,
    ingredientUnit: r.ingredientUnit,
    kanbanQuantity: r.kanbanQuantity != null ? Number(r.kanbanQuantity) : null,
    kanbanOrderAmount: r.kanbanOrderAmount != null ? Number(r.kanbanOrderAmount) : null,
    kanbanUnit: r.kanbanUnit ?? "weight",
    packWeight: r.packWeight != null ? Number(r.packWeight) : null,
    costPerPack: r.costPerPack != null ? Number(r.costPerPack) : null,
    supplierId: r.supplierId,
    supplierName: r.supplierName ?? null,
    secondarySupplierId: r.secondarySupplierId,
    supplierPartNumber: r.supplierPartNumber ?? null,
    orderingUrl: r.orderingUrl ?? null,
  })));
});

router.get("/lookup", async (req, res) => {
  const { type, id } = req.query;
  if (!type || !id) {
    res.status(400).json({ error: "type and id query parameters are required" });
    return;
  }

  const itemId = Number(id);
  if (isNaN(itemId)) {
    res.status(400).json({ error: "id must be a number" });
    return;
  }

  const supportedTypes = ["ingredient", "recipe", "sub-recipe", "sub_recipe"];
  if (!supportedTypes.includes(type as string)) {
    res.status(400).json({ error: `Unsupported type. Supported: ${supportedTypes.join(", ")}` });
    return;
  }

  const kanbanSelect = {
    id: kanbanItemsTable.id,
    ingredientId: kanbanItemsTable.ingredientId,
    ingredientName: ingredientsTable.name,
    ingredientUnit: ingredientsTable.unit,
    kanbanQuantity: ingredientsTable.kanbanQuantity,
    kanbanUnit: ingredientsTable.kanbanUnit,
    sourceType: kanbanItemsTable.sourceType,
    recipeId: kanbanItemsTable.recipeId,
    subRecipeId: kanbanItemsTable.subRecipeId,
    supplierId: kanbanItemsTable.supplierId,
    supplierName: suppliersTable.name,
    orderFrequency: suppliersTable.orderFrequency,
    orderDays: suppliersTable.orderDays,
    status: kanbanItemsTable.status,
    pulledAt: kanbanItemsTable.pulledAt,
    pulledByUserId: kanbanItemsTable.pulledByUserId,
    pulledByName: usersTable.name,
    orderDayTarget: kanbanItemsTable.orderDayTarget,
    notes: kanbanItemsTable.notes,
    createdAt: kanbanItemsTable.createdAt,
  };

  const kanbanQuery = () =>
    db
      .select(kanbanSelect)
      .from(kanbanItemsTable)
      .leftJoin(ingredientsTable, eq(kanbanItemsTable.ingredientId, ingredientsTable.id))
      .leftJoin(suppliersTable, eq(kanbanItemsTable.supplierId, suppliersTable.id))
      .leftJoin(usersTable, eq(kanbanItemsTable.pulledByUserId, usersTable.id));

  if (type === "ingredient") {
    const rows = await kanbanQuery().where(
      and(
        eq(kanbanItemsTable.sourceType, "ingredient"),
        eq(kanbanItemsTable.ingredientId, itemId)
      )
    );
    const activeKanban = rows.find(r => r.status === "active");

    if (!activeKanban) {
      const ingredientRows = await db
        .select({ id: ingredientsTable.id, name: ingredientsTable.name })
        .from(ingredientsTable)
        .where(eq(ingredientsTable.id, itemId));

      if (ingredientRows.length === 0) {
        res.status(404).json({ error: "Ingredient not found", found: false });
        return;
      }

      res.json({
        found: false,
        ingredientName: ingredientRows[0].name,
        message: "No active kanban found for this ingredient",
        allKanbans: rows.map(mapRow),
      });
      return;
    }

    res.json({ found: true, kanban: mapRow(activeKanban) });
    return;
  }

  if (type === "recipe") {
    const [recipe] = await db
      .select({ id: recipesTable.id, name: recipesTable.name })
      .from(recipesTable)
      .where(eq(recipesTable.id, itemId));

    if (!recipe) {
      res.status(404).json({ error: "Recipe not found", found: false });
      return;
    }

    const rows = await kanbanQuery().where(
      and(
        eq(kanbanItemsTable.sourceType, "recipe"),
        eq(kanbanItemsTable.recipeId, itemId)
      )
    );
    const activeKanban = rows.find(r => r.status === "active");

    if (!activeKanban) {
      res.json({
        found: false,
        sourceType: "recipe",
        sourceName: recipe.name,
        message: "No active kanban found for this recipe",
        allKanbans: rows.map(mapRow),
      });
      return;
    }

    res.json({
      found: true,
      sourceType: "recipe",
      sourceName: recipe.name,
      kanban: mapRow(activeKanban),
    });
    return;
  }

  if (type === "sub-recipe" || type === "sub_recipe") {
    const [subRecipe] = await db
      .select({ id: subRecipesTable.id, name: subRecipesTable.name })
      .from(subRecipesTable)
      .where(eq(subRecipesTable.id, itemId));

    if (!subRecipe) {
      res.status(404).json({ error: "Sub-recipe not found", found: false });
      return;
    }

    const rows = await kanbanQuery().where(
      and(
        eq(kanbanItemsTable.sourceType, "sub_recipe"),
        eq(kanbanItemsTable.subRecipeId, itemId)
      )
    );
    const activeKanban = rows.find(r => r.status === "active");

    if (!activeKanban) {
      res.json({
        found: false,
        sourceType: "sub-recipe",
        sourceName: subRecipe.name,
        message: "No active kanban found for this sub-recipe",
        allKanbans: rows.map(mapRow),
      });
      return;
    }

    res.json({
      found: true,
      sourceType: "sub-recipe",
      sourceName: subRecipe.name,
      kanban: mapRow(activeKanban),
    });
    return;
  }
});

router.post("/sync", async (_req, res) => {
  const enabledIngredients = await db
    .select({ id: ingredientsTable.id, supplierId: ingredientsTable.supplierId })
    .from(ingredientsTable)
    .where(eq(ingredientsTable.kanbanEnabled, true));

  if (enabledIngredients.length === 0) {
    res.json({ created: 0 });
    return;
  }

  const existing = await db
    .select({ ingredientId: kanbanItemsTable.ingredientId })
    .from(kanbanItemsTable);

  const existingIds = new Set(existing.map(r => r.ingredientId));
  const toCreate = enabledIngredients.filter(i => !existingIds.has(i.id));

  if (toCreate.length === 0) {
    res.json({ created: 0 });
    return;
  }

  await db.insert(kanbanItemsTable).values(
    toCreate.map(i => ({
      ingredientId: i.id,
      supplierId: i.supplierId ?? null,
      status: "active",
    }))
  );

  res.json({ created: toCreate.length });
});

// POST /scan — a kanban card QR was scanned on any device: queue the
// ingredient for TODAY's order, exactly like ticking it in the orders page's
// "Add Kanbans" dialog. Replaces the old lookup→pull two-step, which
// (a) silently failed unless a kanban_items row had been hand-created on the
// old Kanbans board, and (b) targeted the supplier's NEXT order day, so a
// scan rarely surfaced in the day's order list. kanban_items still carries
// the state, but it's auto-created here — a scan ledger, not a hand-managed
// board. The ingredient's kanban settings are the single source of truth.
router.post("/scan", async (req, res) => {
  const { type, id } = (req.body ?? {}) as { type?: string; id?: number | string };
  if (type !== "ingredient" || !Number.isInteger(Number(id))) {
    res.status(400).json({ error: "Not an ingredient kanban QR code" });
    return;
  }
  const ingredientId = Number(id);
  const [ing] = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      unit: ingredientsTable.unit,
      kanbanEnabled: ingredientsTable.kanbanEnabled,
      kanbanQuantity: ingredientsTable.kanbanQuantity,
      kanbanUnit: ingredientsTable.kanbanUnit,
      kanbanOrderAmount: ingredientsTable.kanbanOrderAmount,
      supplierId: ingredientsTable.supplierId,
    })
    .from(ingredientsTable)
    .where(eq(ingredientsTable.id, ingredientId));
  if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }
  if (!ing.kanbanEnabled) {
    res.status(400).json({ error: `${ing.name} doesn't have kanban enabled — turn it on in the ingredient's settings first.` });
    return;
  }

  const today = londonDateString();
  const userId = req.session.userId ?? null;

  // One live state row per ingredient — reuse the latest if present.
  const [existing] = await db
    .select({ id: kanbanItemsTable.id, status: kanbanItemsTable.status, orderDayTarget: kanbanItemsTable.orderDayTarget })
    .from(kanbanItemsTable)
    .where(eq(kanbanItemsTable.ingredientId, ingredientId))
    .orderBy(desc(kanbanItemsTable.id))
    .limit(1);

  const alreadyQueued = existing?.status === "pulled" && existing.orderDayTarget != null && existing.orderDayTarget <= today;
  if (existing) {
    await db.update(kanbanItemsTable)
      .set({ status: "pulled", pulledAt: new Date(), pulledByUserId: userId, orderDayTarget: today, supplierId: ing.supplierId ?? null })
      .where(eq(kanbanItemsTable.id, existing.id));
  } else {
    await db.insert(kanbanItemsTable).values({
      ingredientId,
      sourceType: "ingredient",
      supplierId: ing.supplierId ?? null,
      status: "pulled",
      pulledAt: new Date(),
      pulledByUserId: userId,
      orderDayTarget: today,
    });
  }

  const orderQty = ing.kanbanOrderAmount != null ? Number(ing.kanbanOrderAmount)
    : ing.kanbanQuantity != null ? Number(ing.kanbanQuantity) : 1;
  const unitLabel =
    ing.kanbanUnit === "pack" || ing.kanbanUnit === "packs" ? (orderQty === 1 ? "pack" : "packs")
    : ing.kanbanUnit === "bottle" ? (orderQty === 1 ? "bottle" : "bottles")
    : ing.kanbanUnit === "pallet" ? (orderQty === 1 ? "pallet" : "pallets")
    : ing.unit;
  let supplierName: string | null = null;
  if (ing.supplierId) {
    const [sup] = await db.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, ing.supplierId));
    supplierName = sup?.name ?? null;
  }

  res.json({
    ok: true,
    alreadyQueued,
    ingredientId,
    ingredientName: ing.name,
    orderQty,
    unitLabel,
    supplierName,
    orderDayTarget: today,
  });
});

// ── Orders-page kanban queue ───────────────────────────────────────────────
// The Add Kanbans dialog used to build order lines in browser state only —
// navigating away wiped a round of pulls minutes before cutoff (2026-08-06).
// These two endpoints give the dialog the same persistence as scanning a
// physical card: a pulled kanban_items row queued for TODAY, which
// /api/orders/calculate re-emits onto the page on every load until it's
// un-queued here or the order is placed (which flips it to 'ordered').

router.post("/queue", async (req, res) => {
  const { ingredientId, supplierId } = (req.body ?? {}) as { ingredientId?: number; supplierId?: number | null };
  if (!Number.isInteger(Number(ingredientId))) {
    res.status(400).json({ error: "ingredientId is required" });
    return;
  }
  const iid = Number(ingredientId);
  const [ing] = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      kanbanEnabled: ingredientsTable.kanbanEnabled,
      supplierId: ingredientsTable.supplierId,
    })
    .from(ingredientsTable)
    .where(eq(ingredientsTable.id, iid));
  if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }
  if (!ing.kanbanEnabled) {
    res.status(400).json({ error: `${ing.name} doesn't have kanban enabled — turn it on in the ingredient's settings first.` });
    return;
  }

  const today = londonDateString();
  const userId = req.session.userId ?? null;
  // The dialog lets the operator order from a secondary supplier, so the
  // chosen supplier wins over the ingredient's default.
  const effectiveSupplierId = supplierId != null ? Number(supplierId) : (ing.supplierId ?? null);

  // One live state row per ingredient — reuse the latest if present.
  const [existing] = await db
    .select({ id: kanbanItemsTable.id, status: kanbanItemsTable.status, orderDayTarget: kanbanItemsTable.orderDayTarget })
    .from(kanbanItemsTable)
    .where(eq(kanbanItemsTable.ingredientId, iid))
    .orderBy(desc(kanbanItemsTable.id))
    .limit(1);

  const alreadyQueued = existing?.status === "pulled" && existing.orderDayTarget != null && existing.orderDayTarget <= today;
  if (existing) {
    await db.update(kanbanItemsTable)
      .set({ status: "pulled", pulledAt: new Date(), pulledByUserId: userId, orderDayTarget: today, supplierId: effectiveSupplierId })
      .where(eq(kanbanItemsTable.id, existing.id));
  } else {
    await db.insert(kanbanItemsTable).values({
      ingredientId: iid,
      sourceType: "ingredient",
      supplierId: effectiveSupplierId,
      status: "pulled",
      pulledAt: new Date(),
      pulledByUserId: userId,
      orderDayTarget: today,
    });
  }
  res.json({ ok: true, alreadyQueued });
});

// Put the card back: the operator deleted the kanban line from the pending
// order (or un-pulled in the scan dialog), so the queued row must not
// resurrect it on the next page load.
router.post("/unqueue", async (req, res) => {
  const { ingredientId } = (req.body ?? {}) as { ingredientId?: number };
  if (!Number.isInteger(Number(ingredientId))) {
    res.status(400).json({ error: "ingredientId is required" });
    return;
  }
  const [existing] = await db
    .select({ id: kanbanItemsTable.id, status: kanbanItemsTable.status })
    .from(kanbanItemsTable)
    .where(eq(kanbanItemsTable.ingredientId, Number(ingredientId)))
    .orderBy(desc(kanbanItemsTable.id))
    .limit(1);
  if (existing && existing.status === "pulled") {
    await db.update(kanbanItemsTable).set({
      status: "active",
      pulledAt: null,
      pulledByUserId: null,
      orderDayTarget: null,
    }).where(eq(kanbanItemsTable.id, existing.id));
  }
  res.json({ ok: true });
});

router.post("/:id/pull", async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.session.userId;

  const [existing] = await db
    .select({
      id: kanbanItemsTable.id,
      supplierId: kanbanItemsTable.supplierId,
    })
    .from(kanbanItemsTable)
    .where(eq(kanbanItemsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Kanban not found" });
    return;
  }

  let orderDayTarget: string | null = null;
  if (existing.supplierId) {
    const [supplier] = await db
      .select({ orderFrequency: suppliersTable.orderFrequency, orderDays: suppliersTable.orderDays })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, existing.supplierId));
    if (supplier) {
      const nextDay = computeNextOrderDay(supplier.orderFrequency, supplier.orderDays);
      orderDayTarget = formatOrderDayTarget(nextDay);
    }
  }

  const [updated] = await db.update(kanbanItemsTable).set({
    status: "pulled",
    pulledAt: new Date(),
    pulledByUserId: userId ?? null,
    orderDayTarget,
  }).where(eq(kanbanItemsTable.id, id)).returning();

  const [full] = await db
    .select({
      id: kanbanItemsTable.id,
      ingredientId: kanbanItemsTable.ingredientId,
      sourceType: kanbanItemsTable.sourceType,
      recipeId: kanbanItemsTable.recipeId,
      subRecipeId: kanbanItemsTable.subRecipeId,
      qrCodeUrl: kanbanItemsTable.qrCodeUrl,
      ingredientName: ingredientsTable.name,
      ingredientUnit: ingredientsTable.unit,
      kanbanQuantity: ingredientsTable.kanbanQuantity,
      kanbanUnit: ingredientsTable.kanbanUnit,
      supplierId: kanbanItemsTable.supplierId,
      supplierName: suppliersTable.name,
      orderFrequency: suppliersTable.orderFrequency,
      orderDays: suppliersTable.orderDays,
      status: kanbanItemsTable.status,
      pulledAt: kanbanItemsTable.pulledAt,
      pulledByUserId: kanbanItemsTable.pulledByUserId,
      pulledByName: usersTable.name,
      orderDayTarget: kanbanItemsTable.orderDayTarget,
      notes: kanbanItemsTable.notes,
      createdAt: kanbanItemsTable.createdAt,
    })
    .from(kanbanItemsTable)
    .leftJoin(ingredientsTable, eq(kanbanItemsTable.ingredientId, ingredientsTable.id))
    .leftJoin(suppliersTable, eq(kanbanItemsTable.supplierId, suppliersTable.id))
    .leftJoin(usersTable, eq(kanbanItemsTable.pulledByUserId, usersTable.id))
    .where(eq(kanbanItemsTable.id, id));

  res.json(mapRow(full));
});

// Undo a pull (e.g. scanned by mistake during testing) — back to active,
// clear the pull metadata and order-day target so it drops out of ordering.
router.post("/:id/unpull", async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select({ id: kanbanItemsTable.id }).from(kanbanItemsTable).where(eq(kanbanItemsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Kanban not found" }); return; }
  await db.update(kanbanItemsTable).set({
    status: "active",
    pulledAt: null,
    pulledByUserId: null,
    orderDayTarget: null,
  }).where(eq(kanbanItemsTable.id, id));
  res.json({ ok: true });
});

router.post("/:id/order", async (req, res) => {
  const id = Number(req.params.id);

  const [updated] = await db.update(kanbanItemsTable).set({
    status: "ordered",
  }).where(eq(kanbanItemsTable.id, id)).returning();

  if (!updated) {
    res.status(404).json({ error: "Kanban not found" });
    return;
  }

  const [full] = await db
    .select({
      id: kanbanItemsTable.id,
      ingredientId: kanbanItemsTable.ingredientId,
      sourceType: kanbanItemsTable.sourceType,
      recipeId: kanbanItemsTable.recipeId,
      subRecipeId: kanbanItemsTable.subRecipeId,
      qrCodeUrl: kanbanItemsTable.qrCodeUrl,
      ingredientName: ingredientsTable.name,
      ingredientUnit: ingredientsTable.unit,
      kanbanQuantity: ingredientsTable.kanbanQuantity,
      kanbanUnit: ingredientsTable.kanbanUnit,
      supplierId: kanbanItemsTable.supplierId,
      supplierName: suppliersTable.name,
      orderFrequency: suppliersTable.orderFrequency,
      orderDays: suppliersTable.orderDays,
      status: kanbanItemsTable.status,
      pulledAt: kanbanItemsTable.pulledAt,
      pulledByUserId: kanbanItemsTable.pulledByUserId,
      pulledByName: usersTable.name,
      orderDayTarget: kanbanItemsTable.orderDayTarget,
      notes: kanbanItemsTable.notes,
      createdAt: kanbanItemsTable.createdAt,
    })
    .from(kanbanItemsTable)
    .leftJoin(ingredientsTable, eq(kanbanItemsTable.ingredientId, ingredientsTable.id))
    .leftJoin(suppliersTable, eq(kanbanItemsTable.supplierId, suppliersTable.id))
    .leftJoin(usersTable, eq(kanbanItemsTable.pulledByUserId, usersTable.id))
    .where(eq(kanbanItemsTable.id, id));

  res.json(mapRow(full));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(kanbanItemsTable).where(eq(kanbanItemsTable.id, id));
  res.status(204).send();
});

export default router;
