/**
 * Recipe archive (Graeme, 2026-10-02; migration 0141). Objectives A and F:
 * recipes we no longer make are switched off — hidden from the Recipes list
 * and every "choose a recipe" picker — without deleting anything.
 *
 *   GET  /api/recipes/:id/archive-check  what archiving would affect (upcoming
 *                                        plans, core-menu / special flags)
 *   POST /api/recipes/:id/archive        managers + admins; records who/when
 *   POST /api/recipes/:id/restore        managers + admins
 *
 * Archiving writes the three archived_* columns — plus, for a core-menu or
 * special recipe, unticks those flags, but only when the person chose
 * "untick and archive" (otherwise 409 ON_MENU). Recipe lines, costs,
 * Shopify mappings, labels, DPT settings and every plan that used the recipe
 * are untouched, and GET /api/recipes keeps returning it (with archivedAt)
 * so existing plans, history and stations still show it. The warnings never
 * block: an archived recipe already on a plan is still made.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, recipesTable, productionPlansTable, productionPlanItemsTable, usersTable } from "@workspace/db";
import { and, asc, eq, gte, ne } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { londonDateString } from "../lib/london-time";
import { decideArchive } from "../lib/recipe-archive-rules";

const router: IRouter = Router();

const IdParams = z.object({ id: z.coerce.number().int().positive() });
// clearMenuFlags: the person chose "untick Core menu / Special and archive".
const ArchiveBody = z.object({ clearMenuFlags: z.boolean().optional() });
const RestoreBody = z.object({});

function recipeId(req: Request, res: Response): number | null {
  const parsed = IdParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return null; }
  return parsed.data.id;
}

const archiveColumns = {
  id: recipesTable.id,
  name: recipesTable.name,
  archivedAt: recipesTable.archivedAt,
  archivedById: recipesTable.archivedById,
  archivedByName: recipesTable.archivedByName,
};

function toDto(r: { id: number; name: string; archivedAt: Date | null; archivedById: number | null; archivedByName: string | null }) {
  return { ...r, archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null };
}

/** Plans for today or later, not yet complete, that include this recipe. */
async function upcomingPlansFor(id: number) {
  return db
    .selectDistinct({ planId: productionPlansTable.id, planDate: productionPlansTable.planDate, name: productionPlansTable.name, status: productionPlansTable.status })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .where(and(
      eq(productionPlanItemsTable.recipeId, id),
      gte(productionPlansTable.planDate, londonDateString()),
      ne(productionPlansTable.status, "complete"),
    ))
    .orderBy(asc(productionPlansTable.planDate));
}

router.get("/:id/archive-check", async (req: Request, res: Response) => {
  const id = recipeId(req, res);
  if (id == null) return;
  const [recipe] = await db
    .select({ ...archiveColumns, isCoreMenu: recipesTable.isCoreMenu, isCurrentSpecial: recipesTable.isCurrentSpecial })
    .from(recipesTable).where(eq(recipesTable.id, id));
  if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
  const upcomingPlans = await upcomingPlansFor(id);
  res.json({
    recipe: { ...toDto(recipe), isCoreMenu: recipe.isCoreMenu, isCurrentSpecial: recipe.isCurrentSpecial },
    upcomingPlans,
    today: londonDateString(),
  });
});

router.post("/:id/archive", requireManagerOrAdmin, validate(ArchiveBody), async (req: Request, res: Response) => {
  const id = recipeId(req, res);
  if (id == null) return;
  const [existing] = await db
    .select({ ...archiveColumns, isCoreMenu: recipesTable.isCoreMenu, isCurrentSpecial: recipesTable.isCurrentSpecial })
    .from(recipesTable).where(eq(recipesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Recipe not found" }); return; }
  // Already archived: leave the original who/when alone (idempotent).
  if (existing.archivedAt) { res.json({ recipe: toDto(existing) }); return; }
  // Never archived while still on the menu (Graeme, 2026-10-02).
  const decision = decideArchive(
    { isCoreMenu: !!existing.isCoreMenu, isCurrentSpecial: !!existing.isCurrentSpecial },
    (req.body as { clearMenuFlags?: boolean }).clearMenuFlags === true,
  );
  if (!decision.ok) {
    res.status(409).json({ error: decision.message, code: "ON_MENU", ...decision.flags });
    return;
  }

  const userId = req.session.userId ?? null;
  const [user] = userId != null
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId))
    : [];
  const [row] = await db.update(recipesTable)
    .set({ archivedAt: new Date(), archivedById: userId, archivedByName: user?.name ?? null, ...(decision.clear ?? {}) })
    .where(eq(recipesTable.id, id))
    .returning(archiveColumns);
  res.json({ recipe: toDto(row) });
});

// Restore only un-archives: it never re-ticks Core menu or Special, so it
// can't overwrite whatever is the special now (Graeme, 2026-10-02).
router.post("/:id/restore", requireManagerOrAdmin, validate(RestoreBody), async (req: Request, res: Response) => {
  const id = recipeId(req, res);
  if (id == null) return;
  const [row] = await db.update(recipesTable)
    .set({ archivedAt: null, archivedById: null, archivedByName: null })
    .where(eq(recipesTable.id, id))
    .returning(archiveColumns);
  if (!row) { res.status(404).json({ error: "Recipe not found" }); return; }
  res.json({ recipe: toDto(row) });
});

export default router;
