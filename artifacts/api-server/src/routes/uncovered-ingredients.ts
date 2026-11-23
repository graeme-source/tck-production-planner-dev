/**
 * Actions on the orders page's "not covered by a kanban or a stock check"
 * warning (Graeme, 23 Nov 2026). The list itself comes with
 * GET /api/orders/calculate. Rules: lib/uncovered-ingredients-rules.ts.
 *
 *   POST   /api/uncovered-ingredients/:id/stock-check   switch its stock check on
 *   POST   /api/uncovered-ingredients/:id/not-ordered   we never order this: stop naming it
 *   DELETE /api/uncovered-ingredients/:id/not-ordered   put it back on the warning
 *
 * Managers and admins only (guarded where the router is mounted).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { enableIngredientStockCheck, markIngredientNotOrdered, unmarkIngredientNotOrdered } from "../lib/uncovered-ingredients";
import { recordWarningAction, userNameOf } from "../lib/warning-log";

const router: IRouter = Router();
const noBody = z.object({});

const ingredientIdOf = (req: Request): number | null => {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** Runs one action, answers, and logs who did it. */
async function act(req: Request, res: Response, action: string, run: (ingredientId: number) => Promise<string | null>, said: (name: string) => string) {
  const ingredientId = ingredientIdOf(req);
  if (ingredientId == null) { res.status(400).json({ error: "That isn't an ingredient." }); return; }
  try {
    const name = await run(ingredientId);
    if (name == null) { res.status(404).json({ error: "That ingredient no longer exists." }); return; }
    await recordWarningAction({
      warning: "uncovered_ingredient", action, page: req.get("referer") ?? null, userId: req.session.userId, detail: said(name),
    });
    res.json({ ok: true, name });
  } catch (err) {
    console.error(`[uncovered-ingredients] ${action} failed:`, err);
    res.status(500).json({ error: "That didn't save. Try again." });
  }
}

router.post("/:id/stock-check", validate(noBody), (req: Request, res: Response) =>
  act(req, res, "stock_check_on", enableIngredientStockCheck, name => `Stock check switched on for ${name}`));

router.post("/:id/not-ordered", validate(noBody), (req: Request, res: Response) =>
  act(req, res, "not_ordered", async id => markIngredientNotOrdered(id, await userNameOf(req.session.userId)), name => `${name} marked as never ordered`));

router.delete("/:id/not-ordered", (req: Request, res: Response) =>
  act(req, res, "ordered_again", unmarkIngredientNotOrdered, name => `${name} put back on the warning`));

export default router;
