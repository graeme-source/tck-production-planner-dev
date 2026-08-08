// Recipe collections — named groups of recipes the Create Plan picker can add
// in one click (e.g. "August Test Box" = its three test calzones). Purely a
// planning convenience; not to be confused with /collections (goods leaving
// the unit, the mirror of a delivery).

import { Router, type IRouter } from "express";
import { db, recipeCollectionsTable, recipeCollectionItemsTable, recipesTable } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import * as z from "zod";

const router: IRouter = Router();

const CollectionBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  recipeIds: z.array(z.number().int().positive()).min(1, "A collection needs at least one recipe"),
});

async function listWithItems() {
  const collections = await db
    .select()
    .from(recipeCollectionsTable)
    .orderBy(asc(recipeCollectionsTable.name));
  const items = collections.length
    ? await db
        .select({
          collectionId: recipeCollectionItemsTable.collectionId,
          recipeId: recipeCollectionItemsTable.recipeId,
          position: recipeCollectionItemsTable.position,
          recipeName: recipesTable.name,
          recipeColor: recipesTable.color,
        })
        .from(recipeCollectionItemsTable)
        .innerJoin(recipesTable, eq(recipeCollectionItemsTable.recipeId, recipesTable.id))
        .where(inArray(recipeCollectionItemsTable.collectionId, collections.map(c => c.id)))
        .orderBy(asc(recipeCollectionItemsTable.position))
    : [];
  return collections.map(c => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt.toISOString(),
    recipes: items
      .filter(i => i.collectionId === c.id)
      .map(i => ({ recipeId: i.recipeId, recipeName: i.recipeName, recipeColor: i.recipeColor ?? null })),
  }));
}

router.get("/", async (_req, res) => {
  res.json(await listWithItems());
});

router.post("/", async (req, res) => {
  const parsed = CollectionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const { name, recipeIds } = parsed.data;
  const created = await db.transaction(async (tx) => {
    const [collection] = await tx.insert(recipeCollectionsTable).values({ name }).returning();
    await tx.insert(recipeCollectionItemsTable).values(
      recipeIds.map((recipeId, idx) => ({ collectionId: collection.id, recipeId, position: idx }))
    );
    return collection;
  });
  const all = await listWithItems();
  res.status(201).json(all.find(c => c.id === created.id) ?? { id: created.id, name, recipes: [] });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = CollectionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const { name, recipeIds } = parsed.data;
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(recipeCollectionsTable)
      .set({ name })
      .where(eq(recipeCollectionsTable.id, id))
      .returning();
    if (!row) return null;
    await tx.delete(recipeCollectionItemsTable).where(eq(recipeCollectionItemsTable.collectionId, id));
    await tx.insert(recipeCollectionItemsTable).values(
      recipeIds.map((recipeId, idx) => ({ collectionId: id, recipeId, position: idx }))
    );
    return row;
  });
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  const all = await listWithItems();
  res.json(all.find(c => c.id === id));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(recipeCollectionsTable)
    .where(eq(recipeCollectionsTable.id, id))
    .returning({ id: recipeCollectionsTable.id });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

export default router;
