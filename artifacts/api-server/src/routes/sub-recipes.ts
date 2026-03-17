import { Router, type IRouter } from "express";
import { db, subRecipesTable, subRecipeIngredientsTable, ingredientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(subRecipesTable).orderBy(subRecipesTable.name);
  res.json(rows.map(r => ({ ...r, yield: Number(r.yield), createdAt: r.createdAt.toISOString() })));
});

router.post("/", async (req, res) => {
  const { name, description, yield: yieldAmt, yieldUnit, notes, ingredients } = req.body;
  const [subRecipe] = await db.insert(subRecipesTable).values({ name, description, yield: String(yieldAmt), yieldUnit, notes }).returning();
  if (ingredients?.length) {
    await db.insert(subRecipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number }) => ({
        subRecipeId: subRecipe.id,
        ingredientId: i.ingredientId,
        quantity: String(i.quantity),
      }))
    );
  }
  res.status(201).json({ ...subRecipe, yield: Number(subRecipe.yield), createdAt: subRecipe.createdAt.toISOString() });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(subRecipesTable).where(eq(subRecipesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const items = await db
    .select({
      id: subRecipeIngredientsTable.id,
      ingredientId: subRecipeIngredientsTable.ingredientId,
      ingredientName: ingredientsTable.name,
      unit: ingredientsTable.unit,
      quantity: subRecipeIngredientsTable.quantity,
    })
    .from(subRecipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(subRecipeIngredientsTable.subRecipeId, id));
  res.json({
    ...row,
    yield: Number(row.yield),
    createdAt: row.createdAt.toISOString(),
    ingredients: items.map(i => ({ ...i, quantity: Number(i.quantity) })),
  });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, yield: yieldAmt, yieldUnit, notes, ingredients } = req.body;
  const [updated] = await db.update(subRecipesTable).set({ name, description, yield: String(yieldAmt), yieldUnit, notes }).where(eq(subRecipesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(subRecipeIngredientsTable).where(eq(subRecipeIngredientsTable.subRecipeId, id));
  if (ingredients?.length) {
    await db.insert(subRecipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number }) => ({
        subRecipeId: id,
        ingredientId: i.ingredientId,
        quantity: String(i.quantity),
      }))
    );
  }
  res.json({ ...updated, yield: Number(updated.yield), createdAt: updated.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(subRecipesTable).where(eq(subRecipesTable.id, id));
  res.status(204).send();
});

export default router;
