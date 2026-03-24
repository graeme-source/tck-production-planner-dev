import { Router, type IRouter } from "express";
import { db, kanbanItemsTable, ingredientsTable, suppliersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { computeNextOrderDay, formatOrderDayTarget, getOrderDayLabel, isDueToday } from "../lib/order-day-scheduler";

const router: IRouter = Router();

function mapRow(r: any) {
  return {
    id: r.id,
    ingredientId: r.ingredientId,
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
