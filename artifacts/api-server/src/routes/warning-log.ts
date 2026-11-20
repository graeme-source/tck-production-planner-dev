/**
 * The record of dismissed warnings (Graeme, 20 Nov 2026): screens post the
 * ones they keep on the iPad; managers read the last fortnight.
 * Shape and wording: lib/warning-log.ts and the client's lib/warning-log.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { desc, gte } from "drizzle-orm";
import { db, warningDismissalsTable } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { recordWarningAction } from "../lib/warning-log";

const router: IRouter = Router();

const PostBody = z.object({
  warning: z.string().regex(/^[a-z_]{1,40}$/),
  action: z.string().regex(/^[a-z_]{1,40}$/),
  detail: z.string().max(2000).nullable().optional(),
  page: z.string().max(200).nullable().optional(),
});

router.post("/", validate(PostBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof PostBody>;
  await recordWarningAction({ ...b, userId: req.session.userId });
  res.json({ ok: true });
});

const ListQuery = z.object({ days: z.coerce.number().int().min(1).max(90).optional() });

router.get("/", requireManagerOrAdmin, validateQuery(ListQuery), async (_req: Request, res: Response) => {
  const { days } = res.locals.query as z.infer<typeof ListQuery>;
  const since = new Date(Date.now() - (days ?? 14) * 86_400_000);
  const items = await db.select().from(warningDismissalsTable)
    .where(gte(warningDismissalsTable.createdAt, since))
    .orderBy(desc(warningDismissalsTable.createdAt)).limit(500);
  res.json({ items });
});

export default router;
