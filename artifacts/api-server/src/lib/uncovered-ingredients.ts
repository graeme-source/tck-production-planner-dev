/**
 * The stored side of the uncovered-ingredients warning (rules:
 * uncovered-ingredients-rules.ts): the list of ingredients a manager has
 * said are never ordered (app_settings, one list), and switching an
 * ingredient's stock check on from the warning.
 */
import { db, appSettingsTable, ingredientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { withNotOrdered, withoutNotOrdered, type NotOrderedIngredient } from "./uncovered-ingredients-rules";

const KEY = "ingredients_not_ordered";

export async function readNotOrderedIngredients(): Promise<NotOrderedIngredient[]> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, KEY));
  if (!row?.value) return [];
  try {
    const list = JSON.parse(row.value) as unknown;
    return Array.isArray(list) ? (list as NotOrderedIngredient[]) : [];
  } catch { return []; }
}

async function writeNotOrdered(list: NotOrderedIngredient[]): Promise<void> {
  const value = JSON.stringify(list);
  await db.insert(appSettingsTable).values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

async function ingredientName(ingredientId: number): Promise<string | null> {
  const [row] = await db.select({ name: ingredientsTable.name }).from(ingredientsTable).where(eq(ingredientsTable.id, ingredientId));
  return row?.name ?? null;
}

/** "We don't order this": stop naming it. Returns its name, or null if there's no such ingredient. */
export async function markIngredientNotOrdered(ingredientId: number, by: string | null): Promise<string | null> {
  const name = await ingredientName(ingredientId);
  if (name == null) return null;
  await writeNotOrdered(withNotOrdered(await readNotOrderedIngredients(), { id: ingredientId, name, by, at: new Date().toISOString() }));
  return name;
}

/** Put it back on the warning. */
export async function unmarkIngredientNotOrdered(ingredientId: number): Promise<string | null> {
  const name = await ingredientName(ingredientId);
  await writeNotOrdered(withoutNotOrdered(await readNotOrderedIngredients(), ingredientId));
  return name;
}

/** Switch the ingredient's stock check on, so it is counted and the orders
 *  page orders for it. Returns its name, or null if there's no such ingredient. */
export async function enableIngredientStockCheck(ingredientId: number): Promise<string | null> {
  const [row] = await db.update(ingredientsTable).set({ stockCheckEnabled: true })
    .where(eq(ingredientsTable.id, ingredientId)).returning({ name: ingredientsTable.name });
  return row?.name ?? null;
}
