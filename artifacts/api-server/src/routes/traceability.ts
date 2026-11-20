/**
 * Traceability, stage 1 (Graeme, 19 Nov 2026). Objectives B and D.
 *
 * Stations: "Opened a new pack?" → pick the traced ingredient → photograph
 * its label → the AI reads the batch code and use-by (anyone can correct
 * them) → that batch is in use until a pack is opened on a later day.
 * "New pack, same batch" copies the last batch without a photo.
 *
 * Who sees the station button: anyone granted "Photograph opened packs"
 * (Team & Access), or everyone once the Traceability page's "Everyone"
 * switch is on. The lookup and the list of traced items are managers'.
 *
 * Rules (in use, production windows): lib/traceability.ts.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, usersTable, ingredientsTable, suppliersTable, tracedIngredientsTable, ingredientLotOpensTable, productionPlansTable } from "@workspace/db";
import { eq, desc, asc, and, inArray, sql, gte, lt, lte } from "drizzle-orm";
import * as z from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { requireManagerOrAdmin, resolveRole } from "../middleware/roles";
import { validate, validateQuery } from "../middleware/validate";
import { singleFileUpload } from "../middleware/upload";
import { userCan } from "../lib/feature-access";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { aiMaxTokens, callToolInstruction, pickToolUse, strictTool, toolChoiceFor } from "../lib/ai/claude-calls";
import { londonDateString, addDaysToDateString } from "../lib/london-time";
import {
  inUseIntervals, productionWindow, lotsInWindow, plansTouchedBy, normaliseBatchCode, looksLikeOurPackCode,
  LOT_LABEL_TOOL, lotLabelPrompt, parseLotLabel,
} from "../lib/traceability";

const router: IRouter = Router();

const EVERYONE_KEY = "traceability_photos_everyone";
const FEATURE = "traceability.photos";
const PHOTO_MAX_MB = 12;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
/** Claude reads jpeg/png/webp/gif; iPad photos arrive as jpeg. */
const AI_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function sessionUser(req: Request): Promise<{ id: number; name: string } | null> {
  const id = req.session.userId ?? null;
  if (!id) return null;
  const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return u ?? null;
}

async function everyoneOn(): Promise<boolean> {
  const r = await db.execute<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = ${EVERYONE_KEY}`);
  return r.rows[0]?.value === "true";
}

/** Granted "Photograph opened packs", or the Everyone switch is on. */
async function canPhotograph(req: Request): Promise<boolean> {
  const userId = req.session.userId;
  if (!userId) return false;
  if (await everyoneOn()) return true;
  const role = await resolveRole(req);
  return !!role && (await userCan(userId, role, FEATURE));
}

async function requirePhotograph(req: Request, res: Response, next: NextFunction) {
  if (await canPhotograph(req)) { next(); return; }
  res.status(403).json({ error: "Pack photos aren't switched on for you yet. A manager can turn them on in Settings → Team & Access." });
}

/** The traced ingredients with the batch currently in use for each. */
async function tracedItems() {
  const items = await db
    .select({ id: ingredientsTable.id, name: ingredientsTable.name, supplierName: suppliersTable.name, unit: ingredientsTable.unit, packWeight: ingredientsTable.packWeight })
    .from(tracedIngredientsTable)
    .innerJoin(ingredientsTable, eq(ingredientsTable.id, tracedIngredientsTable.ingredientId))
    .leftJoin(suppliersTable, eq(suppliersTable.id, ingredientsTable.supplierId))
    .orderBy(asc(ingredientsTable.name));
  if (items.length === 0) return [];
  const latest = await db
    .selectDistinctOn([ingredientLotOpensTable.ingredientId], {
      ingredientId: ingredientLotOpensTable.ingredientId,
      id: ingredientLotOpensTable.id,
      batchCode: ingredientLotOpensTable.batchCode,
      useBy: ingredientLotOpensTable.useBy,
      openedAt: ingredientLotOpensTable.openedAt,
      openedByName: ingredientLotOpensTable.openedByName,
      hasPhoto: sql<boolean>`${ingredientLotOpensTable.photo} IS NOT NULL`,
    })
    .from(ingredientLotOpensTable)
    .where(inArray(ingredientLotOpensTable.ingredientId, items.map(i => i.id)))
    .orderBy(ingredientLotOpensTable.ingredientId, desc(ingredientLotOpensTable.openedAt), desc(ingredientLotOpensTable.id));
  const byIng = new Map(latest.map(l => [l.ingredientId, l]));
  // Every pack recorded today (London day), so prep can show "2 packs done"
  // while they photograph each one (Graeme, 2026-11-19).
  const todays = await db
    .select({ id: ingredientLotOpensTable.id, ingredientId: ingredientLotOpensTable.ingredientId, batchCode: ingredientLotOpensTable.batchCode, useBy: ingredientLotOpensTable.useBy })
    .from(ingredientLotOpensTable)
    .where(and(
      inArray(ingredientLotOpensTable.ingredientId, items.map(i => i.id)),
      sql`(${ingredientLotOpensTable.openedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date = ${londonDateString()}::date`,
    ))
    .orderBy(asc(ingredientLotOpensTable.openedAt), asc(ingredientLotOpensTable.id));
  return items.map(i => ({
    ...i,
    packWeight: Number(i.packWeight) > 0 ? Number(i.packWeight) : null,
    current: byIng.get(i.id) ?? null,
    today: todays.filter(t => t.ingredientId === i.id).map(({ ingredientId: _i, ...t }) => t),
  }));
}

const openColumns = {
  id: ingredientLotOpensTable.id,
  ingredientId: ingredientLotOpensTable.ingredientId,
  batchCode: ingredientLotOpensTable.batchCode,
  useBy: ingredientLotOpensTable.useBy,
  readBy: ingredientLotOpensTable.readBy,
  station: ingredientLotOpensTable.station,
  openedByUserId: ingredientLotOpensTable.openedByUserId,
  openedByName: ingredientLotOpensTable.openedByName,
  openedAt: ingredientLotOpensTable.openedAt,
  hasPhoto: sql<boolean>`${ingredientLotOpensTable.photo} IS NOT NULL`,
};

async function readLabel(photo: Buffer, mime: string): Promise<{ batchCode: string | null; useBy: string | null } | null> {
  if (!isClaudeConfigured() || !AI_MIMES.has(mime)) return null;
  try {
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: aiMaxTokens(300, "low"),
      output_config: { effort: "low" },
      system: callToolInstruction(LOT_LABEL_TOOL.name),
      tool_choice: toolChoiceFor(CLAUDE_MODELS.haiku, LOT_LABEL_TOOL.name),
      tools: [strictTool(LOT_LABEL_TOOL as unknown as Anthropic.Tool)],
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp", data: photo.toString("base64") } },
          { type: "text", text: lotLabelPrompt(londonDateString()) },
        ],
      }],
    }, { timeout: 30_000 });
    // No call (or a refusal) → null: they type the code in, as before.
    const tool = pickToolUse(response, LOT_LABEL_TOOL.name);
    return tool ? parseLotLabel(tool.input) : null;
  } catch (err) {
    console.error("[traceability] label read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Stations ───────────────────────────────────────────────────────────────

// GET /me — should this person see the station button?
router.get("/me", async (req: Request, res: Response) => {
  try {
    res.json({ canPhotograph: await canPhotograph(req) });
  } catch (err) {
    console.error("[traceability] me failed:", err);
    res.json({ canPhotograph: false });
  }
});

// GET /items — traced ingredients and the batch in use for each.
router.get("/items", requirePhotograph, async (_req: Request, res: Response) => {
  try {
    res.json(await tracedItems());
  } catch (err) {
    console.error("[traceability] items failed:", err);
    res.status(500).json({ error: "Couldn't load the traced items" });
  }
});

const StationBody = z.object({ station: z.string().max(40).optional() });

// POST /items/:ingredientId/photo — a new pack opened: the label photo.
router.post("/items/:ingredientId/photo", requirePhotograph, singleFileUpload("photo", PHOTO_MAX_MB), async (req: Request, res: Response) => {
  try {
    const ingredientId = Number(req.params.ingredientId);
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in" }); return; }
    const [traced] = await db.select().from(tracedIngredientsTable).where(eq(tracedIngredientsTable.ingredientId, ingredientId));
    if (!traced) { res.status(404).json({ error: "That ingredient isn't traced" }); return; }
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No photo came through — try again" }); return; }
    const mime = file.mimetype.toLowerCase();
    if (!IMAGE_MIMES.has(mime)) { res.status(400).json({ error: "That isn't a photo" }); return; }
    const station = typeof req.body?.station === "string" ? req.body.station.slice(0, 40) : null;
    const read = await readLabel(file.buffer, mime);
    const [row] = await db.insert(ingredientLotOpensTable).values({
      ingredientId, photo: file.buffer, photoMime: mime,
      batchCode: read?.batchCode ?? null, useBy: read?.useBy ?? null,
      readBy: read && (read.batchCode || read.useBy) ? "ai" : null,
      station, openedByUserId: user.id, openedByName: user.name,
    }).returning({ id: ingredientLotOpensTable.id });
    const [out] = await db.select(openColumns).from(ingredientLotOpensTable).where(eq(ingredientLotOpensTable.id, row!.id));
    res.status(201).json(out);
  } catch (err) {
    console.error("[traceability] photo failed:", err);
    res.status(500).json({ error: "The photo didn't save — try again" });
  }
});

// POST /items/:ingredientId/same — a new pack from the same batch as last time.
router.post("/items/:ingredientId/same", requirePhotograph, validate(StationBody), async (req: Request, res: Response) => {
  try {
    const ingredientId = Number(req.params.ingredientId);
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in" }); return; }
    const [last] = await db.select().from(ingredientLotOpensTable)
      .where(eq(ingredientLotOpensTable.ingredientId, ingredientId))
      .orderBy(desc(ingredientLotOpensTable.openedAt), desc(ingredientLotOpensTable.id)).limit(1);
    if (!last) { res.status(409).json({ error: "There's no earlier pack to copy — take a photo of this one" }); return; }
    const [row] = await db.insert(ingredientLotOpensTable).values({
      ingredientId, batchCode: last.batchCode, useBy: last.useBy, readBy: "copied", sameAsId: last.id,
      station: (req.body as z.infer<typeof StationBody>).station ?? null,
      openedByUserId: user.id, openedByName: user.name,
    }).returning({ id: ingredientLotOpensTable.id });
    const [out] = await db.select(openColumns).from(ingredientLotOpensTable).where(eq(ingredientLotOpensTable.id, row!.id));
    res.status(201).json(out);
  } catch (err) {
    console.error("[traceability] same failed:", err);
    res.status(500).json({ error: "That didn't save — try again" });
  }
});

const FixBody = z.object({
  batchCode: z.string().trim().max(60).nullable().optional(),
  useBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** The person who opened it (today) or a manager can correct it. */
async function canFix(req: Request, openedByUserId: number | null, openedAt: Date): Promise<boolean> {
  const role = await resolveRole(req);
  if (role === "admin" || role === "manager") return true;
  return openedByUserId === req.session.userId && londonDateString(openedAt) === londonDateString();
}

// PATCH /opens/:id — correct the batch code or use-by (autosaves).
router.patch("/opens/:id", validate(FixBody), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [row] = await db.select({ openedByUserId: ingredientLotOpensTable.openedByUserId, openedAt: ingredientLotOpensTable.openedAt })
      .from(ingredientLotOpensTable).where(eq(ingredientLotOpensTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await canFix(req, row.openedByUserId, row.openedAt))) { res.status(403).json({ error: "Only the person who opened it (on the day) or a manager can change this" }); return; }
    const body = req.body as z.infer<typeof FixBody>;
    const set: Partial<typeof ingredientLotOpensTable.$inferInsert> = { readBy: "person" };
    if (body.batchCode !== undefined) set.batchCode = body.batchCode || null;
    if (body.useBy !== undefined) set.useBy = body.useBy;
    await db.update(ingredientLotOpensTable).set(set).where(eq(ingredientLotOpensTable.id, id));
    const [out] = await db.select(openColumns).from(ingredientLotOpensTable).where(eq(ingredientLotOpensTable.id, id));
    res.json(out);
  } catch (err) {
    console.error("[traceability] fix failed:", err);
    res.status(500).json({ error: "That didn't save — try again" });
  }
});

// GET /opens/:id/photo — the label photo.
router.get("/opens/:id/photo", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [row] = await db.select({ photo: ingredientLotOpensTable.photo, mime: ingredientLotOpensTable.photoMime, openedByUserId: ingredientLotOpensTable.openedByUserId })
      .from(ingredientLotOpensTable).where(eq(ingredientLotOpensTable.id, id));
    if (!row?.photo || !row.mime) { res.status(404).end(); return; }
    const role = await resolveRole(req);
    if (role !== "admin" && role !== "manager" && row.openedByUserId !== req.session.userId) { res.status(403).end(); return; }
    res.setHeader("Content-Type", row.mime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(row.photo);
  } catch (err) {
    console.error("[traceability] photo read failed:", err);
    res.status(500).end();
  }
});

// ── Managers: the Traceability page ────────────────────────────────────────

router.get("/settings", requireManagerOrAdmin, async (_req: Request, res: Response) => {
  try {
    const all = await db.select({ id: ingredientsTable.id, name: ingredientsTable.name }).from(ingredientsTable).orderBy(asc(ingredientsTable.name));
    const traced = await db.select({ id: tracedIngredientsTable.ingredientId }).from(tracedIngredientsTable);
    res.json({ everyone: await everyoneOn(), tracedIds: traced.map(t => t.id), ingredients: all });
  } catch (err) {
    console.error("[traceability] settings failed:", err);
    res.status(500).json({ error: "Couldn't load the settings" });
  }
});

router.patch("/settings", requireManagerOrAdmin, validate(z.object({ everyone: z.boolean() })), async (req: Request, res: Response) => {
  try {
    const { everyone } = req.body as { everyone: boolean };
    await db.execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${EVERYONE_KEY}, ${everyone ? "true" : "false"}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`);
    res.json({ everyone });
  } catch (err) {
    console.error("[traceability] switch failed:", err);
    res.status(500).json({ error: "That didn't save" });
  }
});

router.put("/traced/:ingredientId", requireManagerOrAdmin, validate(z.object({ traced: z.boolean() })), async (req: Request, res: Response) => {
  try {
    const ingredientId = Number(req.params.ingredientId);
    const user = await sessionUser(req);
    if ((req.body as { traced: boolean }).traced) {
      await db.insert(tracedIngredientsTable).values({ ingredientId, addedByName: user?.name ?? null }).onConflictDoNothing();
    } else {
      await db.delete(tracedIngredientsTable).where(eq(tracedIngredientsTable.ingredientId, ingredientId));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[traceability] traced change failed:", err);
    res.status(500).json({ error: "That didn't save" });
  }
});

/** Every plan with the plan before it, for production windows. */
async function plansWithPrevious(from: string, to: string) {
  const rows = await db.select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate, batchNumber: productionPlansTable.batchNumber })
    .from(productionPlansTable)
    .where(and(gte(productionPlansTable.planDate, addDaysToDateString(from, -8)), lte(productionPlansTable.planDate, to)))
    .orderBy(asc(productionPlansTable.planDate));
  return rows.map((p, i) => ({ ...p, planDate: String(p.planDate), previousPlanDate: i > 0 ? String(rows[i - 1]!.planDate) : null }))
    .filter(p => p.planDate >= from);
}

const LookupQuery = z.object({ q: z.string().trim().min(1).max(60) });

// GET /lookup?q= — a pack code (our julian day number) → the batches in it;
// anything else → the supplier batches matching it → the pack codes they
// could be in.
router.get("/lookup", requireManagerOrAdmin, validateQuery(LookupQuery), async (_req: Request, res: Response) => {
  try {
    const { q } = res.locals["query"] as z.infer<typeof LookupQuery>;
    const names = new Map((await db.select({ id: ingredientsTable.id, name: ingredientsTable.name }).from(ingredientsTable)).map(i => [i.id, i.name]));
    const describe = (iv: { open: { id: number; ingredientId: number; batchCode: string | null; useBy: string | null; openedAt: Date; openedByName: string | null; hasPhoto: boolean; readBy: string | null }; end: Date | null }) => ({
      ...iv.open, ingredientName: names.get(iv.open.ingredientId) ?? "Unknown", inUseUntil: iv.end,
    });

    if (looksLikeOurPackCode(q)) {
      const [plan] = await db.select({ planDate: productionPlansTable.planDate, batchNumber: productionPlansTable.batchNumber })
        .from(productionPlansTable).where(eq(productionPlansTable.batchNumber, Number(q)));
      if (!plan) { res.json({ kind: "pack", found: false, q }); return; }
      const planDate = String(plan.planDate);
      const [prev] = await db.select({ planDate: productionPlansTable.planDate }).from(productionPlansTable)
        .where(lt(productionPlansTable.planDate, planDate)).orderBy(desc(productionPlansTable.planDate)).limit(1);
      const w = productionWindow(planDate, prev ? String(prev.planDate) : null);
      // Everything opened before the window ends, for the in-use rule.
      const opens = await db.select(openColumns).from(ingredientLotOpensTable).where(lt(ingredientLotOpensTable.openedAt, w.end));
      const lots = lotsInWindow(inUseIntervals(opens), w.start, w.end).map(describe)
        .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName) || a.openedAt.getTime() - b.openedAt.getTime());
      const traced = await tracedItems();
      const missing = traced.filter(t => !lots.some(l => l.ingredientId === t.id)).map(t => t.name);
      res.json({ kind: "pack", found: true, q, planDate, windowStart: w.start, windowEnd: w.end, lots, notRecorded: missing });
      return;
    }

    const key = normaliseBatchCode(q);
    const all = await db.select(openColumns).from(ingredientLotOpensTable);
    const intervals = inUseIntervals(all);
    const matches = intervals.filter(iv => iv.open.batchCode && normaliseBatchCode(iv.open.batchCode).includes(key));
    if (matches.length === 0) { res.json({ kind: "supplier", found: false, q }); return; }
    const earliest = londonDateString(new Date(Math.min(...matches.map(m => m.start.getTime()))));
    const plans = await plansWithPrevious(addDaysToDateString(earliest, -1), addDaysToDateString(londonDateString(), 14));
    const results = matches.map(m => ({
      ...describe(m),
      packCodes: plansTouchedBy(m, plans).map(p => ({ planDate: p.planDate, batchNumber: p.batchNumber })),
    }));
    res.json({ kind: "supplier", found: true, q, results });
  } catch (err) {
    console.error("[traceability] lookup failed:", err);
    res.status(500).json({ error: "The lookup failed" });
  }
});

// GET /recent — the last fortnight's opened packs, newest first.
router.get("/recent", requireManagerOrAdmin, async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const names = new Map((await db.select({ id: ingredientsTable.id, name: ingredientsTable.name }).from(ingredientsTable)).map(i => [i.id, i.name]));
    const rows = await db.select(openColumns).from(ingredientLotOpensTable)
      .where(gte(ingredientLotOpensTable.openedAt, since)).orderBy(desc(ingredientLotOpensTable.openedAt)).limit(300);
    res.json(rows.map(r => ({ ...r, ingredientName: names.get(r.ingredientId) ?? "Unknown" })));
  } catch (err) {
    console.error("[traceability] recent failed:", err);
    res.status(500).json({ error: "Couldn't load the recent packs" });
  }
});

export default router;
