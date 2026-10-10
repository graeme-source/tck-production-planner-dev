/**
 * Automatic QUID (Graeme, 2026-10-10). Objectives A and D.
 *
 *   GET  /api/recipes/:id/quid      the recipe's QUID panel: every line, ticked
 *                                   or not and who decided, what the name
 *                                   names, open questions, the deck now
 *   PUT  /api/recipes/:id/quid      managers + admins: a person's answer for
 *                                   one line { key, quid: true | false | null }
 *                                   (null = back to automatic)
 *   GET  /api/quid-terms            the QUID words list (anyone signed in)
 *   POST /api/quid-terms            admins: add a word
 *   PUT  /api/quid-terms/:id        admins: change one
 *   DELETE /api/quid-terms/:id      admins: remove one
 *   POST /api/quid-backfill         admins: run the matcher over every
 *                                   non-archived recipe; { apply: false }
 *                                   (the default) writes nothing
 *
 * The rules: lib/quid-matcher.ts and lib/quid-plan.ts (pure, tested). The
 * database half: lib/quid-store.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, quidTermsTable, usersTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireAdmin, requireManagerOrAdmin } from "../middleware/roles";
import { parseQuidKey } from "../lib/quid-matcher";
import { formatBackfill, quidBackfill, recipeQuidView, setQuidDecision } from "../lib/quid-store";

const router: IRouter = Router();

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const DecisionBody = z.object({
  key: z.string().refine(k => parseQuidKey(k) != null, "Not a QUID line key"),
  quid: z.boolean().nullable(),
});
const TermBody = z.object({
  phrase: z.string().trim().min(1, "Type a word").max(60),
  mode: z.enum(["auto", "suggest", "ignore", "guard"]),
  targets: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  categories: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  isCategory: z.boolean().optional(),
});
const BackfillBody = z.object({ apply: z.boolean().optional() });

async function actorName(req: Request): Promise<string | null> {
  const id = req.session.userId;
  if (!id) return null;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return u?.name ?? null;
}

function idOf(req: Request, res: Response): number | null {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid id" }); return null; }
  return p.data.id;
}

router.get("/recipes/:id/quid", async (req, res) => {
  const id = idOf(req, res); if (id == null) return;
  const view = await recipeQuidView(id);
  if (!view) { res.status(404).json({ error: "Recipe not found" }); return; }
  res.json(view);
});

router.put("/recipes/:id/quid", requireManagerOrAdmin, validate(DecisionBody), async (req, res) => {
  const id = idOf(req, res); if (id == null) return;
  const { key, quid } = req.body as z.infer<typeof DecisionBody>;
  await setQuidDecision(id, key, quid, await actorName(req));
  const view = await recipeQuidView(id);
  if (!view) { res.status(404).json({ error: "Recipe not found" }); return; }
  res.json(view);
});

router.get("/quid-terms", async (_req, res) => {
  const rows = await db.select().from(quidTermsTable).orderBy(asc(quidTermsTable.mode), asc(quidTermsTable.phrase));
  res.json({ terms: rows });
});

const termValues = (b: z.infer<typeof TermBody>, by: string | null) => ({
  phrase: b.phrase.toLowerCase(),
  mode: b.mode,
  targets: (b.targets ?? []).map(t => t.toLowerCase()),
  categories: (b.categories ?? []).map(c => c.toLowerCase()),
  isCategory: b.isCategory === true,
  updatedAt: new Date(),
  updatedByName: by,
});

const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === "23505"
  || (err as { cause?: { code?: string } })?.cause?.code === "23505";

router.post("/quid-terms", requireAdmin, validate(TermBody), async (req, res) => {
  try {
    const [row] = await db.insert(quidTermsTable).values(termValues(req.body, await actorName(req))).returning();
    res.status(201).json(row);
  } catch (err) {
    if (isUniqueClash(err)) { res.status(409).json({ error: "That word is already on the list" }); return; }
    throw err;
  }
});

router.put("/quid-terms/:id", requireAdmin, validate(TermBody), async (req, res) => {
  const id = idOf(req, res); if (id == null) return;
  try {
    const [row] = await db.update(quidTermsTable).set(termValues(req.body, await actorName(req))).where(eq(quidTermsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    if (isUniqueClash(err)) { res.status(409).json({ error: "That word is already on the list" }); return; }
    throw err;
  }
});

router.delete("/quid-terms/:id", requireAdmin, async (req, res) => {
  const id = idOf(req, res); if (id == null) return;
  const [row] = await db.delete(quidTermsTable).where(eq(quidTermsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

router.post("/quid-backfill", requireAdmin, validate(BackfillBody), async (req, res) => {
  const apply = (req.body as z.infer<typeof BackfillBody>).apply === true;
  const report = await quidBackfill({ apply, actorName: (await actorName(req)) ?? "QUID backfill" });
  res.json({ ...report, text: formatBackfill(report) });
});

export default router;
