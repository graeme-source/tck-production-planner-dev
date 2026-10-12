/**
 * POST /api/ingredients/wrap-declarations — the one-off tidy for label
 * declarations stored as a bare component list before saves auto-wrapped
 * them (2026-10-12), and for anything a future bulk import writes directly.
 * Same rule as every ingredient save: "Butter (MILK), Salt" on Salted Butter
 * becomes "Salted Butter (Butter (MILK), Salt)".
 *
 * Admin only. DRY RUN unless the body says { "apply": true } — the dry run
 * lists exactly what would change, before → after.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { db, ingredientsTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { detectAllergens, planDeclarationWraps } from "@workspace/allergens";
import { validate } from "../middleware/validate";
import { requireAdmin } from "../middleware/roles";
import { reconcileRecipesUsing } from "../lib/quid-store";

const router: IRouter = Router();

const WrapBody = z.object({ apply: z.boolean().optional() });

router.post("/wrap-declarations", requireAdmin, validate(WrapBody), async (req, res) => {
  try {
    const apply = (req.body as z.infer<typeof WrapBody>).apply === true;
    const rows = await db
      .select({ id: ingredientsTable.id, name: ingredientsTable.name, labelDeclaration: ingredientsTable.labelDeclaration, allergens: ingredientsTable.allergens })
      .from(ingredientsTable)
      .where(isNotNull(ingredientsTable.labelDeclaration));
    const changes = planDeclarationWraps(rows);

    if (apply) {
      for (const c of changes) {
        const row = rows.find(r => r.id === c.id);
        const ticked = (row?.allergens as string[] | null) ?? [];
        // Same mirroring as a normal save: allergens the new text implies are ticked.
        const allergens = [...new Set([...ticked, ...detectAllergens(c.after)])];
        await db.update(ingredientsTable).set({ labelDeclaration: c.after, allergens }).where(eq(ingredientsTable.id, c.id));
        reconcileRecipesUsing({ ingredientId: c.id }, "Automatic QUID").catch(err =>
          console.error(`Automatic QUID recheck after wrapping ingredient ${c.id} failed:`, err));
      }
    }

    res.json({ dryRun: !apply, count: changes.length, changes });
  } catch (err) {
    console.error("POST /ingredients/wrap-declarations failed:", err);
    res.status(500).json({ error: "Couldn't check the declarations" });
  }
});

export default router;
