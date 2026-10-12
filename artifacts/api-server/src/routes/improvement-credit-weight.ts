/**
 * How many credits an improvement is worth on the improvement score
 * (Graeme, 2026-10-12; Objective E).
 *
 *   PUT /api/improvements/:id/credit-weight   { weight: 1 | 2 | 3 }
 *
 * 1 is every improvement's default — labelling a water bottle is still
 * wanted, every day. 2 = "Wow, that's a really good improvement", 3 =
 * "really substantial". Founder only (requireFounder on the route, NOT on
 * the router: this router is mounted at /improvements ahead of the main
 * improvements router, so a router-wide guard would lock everyone else out
 * of the whole page).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireFounder } from "../middleware/founder-access";
import { validate } from "../middleware/validate";
import { CREDIT_WEIGHTS } from "../lib/improvement-score";

const router: IRouter = Router();

const bodySchema = z.object({
  weight: z.number().int().refine(n => (CREDIT_WEIGHTS as readonly number[]).includes(n), "weight must be 1, 2 or 3"),
});

router.put("/:id/credit-weight", requireFounder, validate(bodySchema), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid improvement" }); return; }
  const { weight } = req.body as z.infer<typeof bodySchema>;
  try {
    const result = await db.execute<{ id: number; credit_weight: number }>(sql`
      UPDATE improvement_submissions
         SET credit_weight = ${weight},
             credit_weight_set_at = NOW(),
             credit_weight_set_by = ${req.session.userId ?? null}
       WHERE id = ${id}
       RETURNING id, credit_weight
    `);
    const row = result.rows[0];
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: Number(row.id), creditWeight: Number(row.credit_weight) });
  } catch (err) {
    console.error("[improvement-credit-weight] save failed:", err);
    res.status(500).json({ error: "Couldn't save the credits" });
  }
});

export default router;
