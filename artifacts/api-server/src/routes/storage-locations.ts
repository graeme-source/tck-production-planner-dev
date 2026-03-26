import { Router, type IRouter } from "express";
import { db, storageLocationsTable, storageRacksTable, ingredientStorageLocationsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

const CreateLocationBody = z.object({
  name: z.string().min(1),
  zone: z.enum(["fridge", "freezer", "ambient"]),
});

const UpdateLocationBody = z.object({
  name: z.string().min(1),
  zone: z.enum(["fridge", "freezer", "ambient"]),
});

const CreateRackBody = z.object({
  locationId: z.number().int().positive(),
  label: z.string().min(1),
});

router.get("/", async (_req, res) => {
  const locations = await db.select().from(storageLocationsTable).orderBy(asc(storageLocationsTable.name));
  const racks = await db.select().from(storageRacksTable).orderBy(asc(storageRacksTable.label));

  const result = locations.map(loc => ({
    ...loc,
    createdAt: loc.createdAt.toISOString(),
    racks: racks.filter(r => r.locationId === loc.id),
  }));

  res.json(result);
});

router.post("/", validate(CreateLocationBody), async (req, res) => {
  const { name, zone } = req.body;
  const [row] = await db.insert(storageLocationsTable).values({ name, zone, isSystem: false }).returning();
  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString(), racks: [] });
});

router.put("/:id", validate(UpdateLocationBody), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.select().from(storageLocationsTable).where(eq(storageLocationsTable.id, id));
  if (!existing.length) { res.status(404).json({ error: "Not found" }); return; }
  const { name, zone } = req.body;
  const [row] = await db.update(storageLocationsTable).set({ name, zone }).where(eq(storageLocationsTable.id, id)).returning();
  const racks = await db.select().from(storageRacksTable).where(eq(storageRacksTable.locationId, id));
  res.json({ ...row, createdAt: row.createdAt.toISOString(), racks });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.select().from(storageLocationsTable).where(eq(storageLocationsTable.id, id));
  if (!existing.length) { res.status(404).json({ error: "Not found" }); return; }
  if (existing[0].isSystem) { res.status(400).json({ error: "Cannot delete system storage locations" }); return; }
  await db.delete(storageLocationsTable).where(eq(storageLocationsTable.id, id));
  res.status(204).send();
});

router.post("/racks", validate(CreateRackBody), async (req, res) => {
  const { locationId, label } = req.body;
  const [row] = await db.insert(storageRacksTable).values({ locationId, label }).returning();
  res.status(201).json(row);
});

router.delete("/racks/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(storageRacksTable).where(eq(storageRacksTable.id, id));
  res.status(204).send();
});

router.get("/ingredient-assignments", async (_req, res) => {
  const rows = await db.select().from(ingredientStorageLocationsTable);
  res.json(rows);
});

const AssignIngredientBody = z.object({
  ingredientId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  rackLabel: z.string().nullish(),
  shelfLabel: z.string().nullish(),
});

router.post("/ingredient-assignments", validate(AssignIngredientBody), async (req, res) => {
  const { ingredientId, locationId, rackLabel, shelfLabel } = req.body;
  const [row] = await db.insert(ingredientStorageLocationsTable).values({
    ingredientId,
    locationId,
    rackLabel: rackLabel || null,
    shelfLabel: shelfLabel || null,
  }).returning();
  res.status(201).json(row);
});

router.delete("/ingredient-assignments/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(ingredientStorageLocationsTable).where(eq(ingredientStorageLocationsTable.id, id));
  res.status(204).send();
});

export default router;
