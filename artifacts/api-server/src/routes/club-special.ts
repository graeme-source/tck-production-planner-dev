/**
 * Club Special changeovers API (migration 0148). Objectives F (the website
 * changes over without a checklist to remember) and I (the founder schedules
 * it once, in advance).
 *
 * Schedule a changeover — recipe, first delivery date, optional new Club
 * Special price and announcement line — and the app switches the planner and
 * the website on the switch day (lib/club-special-changeover.ts). The two
 * Zapiet date steps can't be automated (no API for product date
 * restrictions), so they become dated to-dos on the owner's list here.
 *
 * Same access as Sales & Marketing: the founder, or anyone granted
 * "founder.sales". Every change is stamped with who made it.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, appSettingsTable, clubSpecialChangeoversTable, recipesTable, usersTable } from "@workspace/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { salesAreaPeople } from "../lib/sales-area-people";
import { londonDateString } from "../lib/london-time";
import { defaultSwitchOn, scheduleProblem, zapietTodos } from "../lib/club-special-rules";
import { currentClubPricePence, runDueChangeovers } from "../lib/club-special-changeover";
import { syncSpecialToShopify } from "../lib/special-shopify-sync";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const DEFAULT_OFFSET_DAYS = 7;

interface Actor { id: number; name: string }

async function sessionUser(req: Request): Promise<Actor> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Days between a renewal's billing and its delivery (Loop charge offset). */
async function billingOffsetDays(): Promise<number> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable)
    .where(eq(appSettingsTable.key, "club_special_billing_offset_days"));
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 0 && n <= 21 ? n : DEFAULT_OFFSET_DAYS;
}

/** Recipes that can be the special: on the menu, not archived, mapped to Shopify. */
async function recipeOptions() {
  const rows = await db.execute<{ id: number; name: string; rrp: string }>(sql`
    SELECT r.id, r.name, r.rrp::text AS rrp
    FROM recipes r
    WHERE r.is_draft = FALSE AND r.archived_at IS NULL
      AND EXISTS (SELECT 1 FROM recipe_shopify_mappings m WHERE m.recipe_id = r.id AND m.shopify_variant_id IS NOT NULL)
    ORDER BY r.name
  `);
  return rows.rows.map(r => ({ id: Number(r.id), name: r.name, rrpPence: Math.round(Number(r.rrp) * 100) || null }));
}

async function todoDone(ids: number[]): Promise<Map<number, boolean>> {
  if (!ids.length) return new Map();
  const r = await db.execute<{ id: number; status: string }>(sql`SELECT id, status FROM todo_tasks WHERE id = ANY(${`{${ids.join(",")}}`}::int[])`);
  return new Map(r.rows.map(t => [Number(t.id), t.status !== "open"]));
}

router.get("/", async (_req: Request, res: Response) => {
  const today = londonDateString();
  const rows = await db
    .select({ c: clubSpecialChangeoversTable, recipeName: recipesTable.name })
    .from(clubSpecialChangeoversTable)
    .innerJoin(recipesTable, eq(recipesTable.id, clubSpecialChangeoversTable.recipeId))
    .where(ne(clubSpecialChangeoversTable.status, "cancelled"))
    .orderBy(desc(clubSpecialChangeoversTable.deliveringFrom));

  const ownerIds = rows.map(r => r.c.ownerId).filter((x): x is number => x != null);
  const owners = ownerIds.length
    ? new Map((await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, ownerIds))).map(u => [u.id, u.name]))
    : new Map<number, string>();
  const done = await todoDone(rows.flatMap(r => [r.c.zapietEndTodoId, r.c.zapietStartTodoId]).filter((x): x is number => x != null));

  const [special] = await db.select({ id: recipesTable.id, name: recipesTable.name })
    .from(recipesTable).where(eq(recipesTable.isCurrentSpecial, true)).limit(1);

  const toDto = (r: (typeof rows)[number]) => ({
    id: r.c.id,
    recipeId: r.c.recipeId,
    recipeName: r.recipeName,
    deliveringFrom: r.c.deliveringFrom,
    switchOn: r.c.switchOn,
    clubPricePence: r.c.clubPricePence,
    announcement: r.c.announcement,
    status: r.c.status,
    switchedAt: r.c.switchedAt,
    shopifyError: r.c.shopifyError,
    owner: r.c.ownerId != null ? { id: r.c.ownerId, name: owners.get(r.c.ownerId) ?? "Someone" } : null,
    zapiet: [
      { key: "end", todoId: r.c.zapietEndTodoId, done: r.c.zapietEndTodoId != null ? done.get(r.c.zapietEndTodoId) ?? true : null },
      { key: "start", todoId: r.c.zapietStartTodoId, done: r.c.zapietStartTodoId != null ? done.get(r.c.zapietStartTodoId) ?? true : null },
    ],
    createdBy: r.c.createdByName,
  });

  const switched = rows.filter(r => r.c.status === "switched");
  const current = special ? switched.find(r => r.c.recipeId === special.id) : undefined;

  let clubPricePence: number | null = null;
  try { clubPricePence = await currentClubPricePence(); } catch (err) {
    console.error("[club-special] couldn't read the Club Special price:", err);
  }

  res.json({
    today,
    offsetDays: await billingOffsetDays(),
    clubPricePence,
    current: special ? { recipeId: special.id, name: special.name, changeover: current ? toDto(current) : null } : null,
    scheduled: rows.filter(r => r.c.status === "scheduled").reverse().map(toDto),
    history: switched.slice(0, 6).map(toDto),
    recipes: await recipeOptions(),
    people: await salesAreaPeople(),
  });
});

const CreateBody = z.object({
  recipeId: z.number().int().positive(),
  deliveringFrom: IsoDate,
  switchOn: IsoDate.optional(),
  clubPricePence: z.number().int().min(100).max(100000).nullable().optional(),
  announcement: z.string().trim().max(140).nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
});

router.post("/", validate(CreateBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof CreateBody>;
  const user = await sessionUser(req);
  const today = londonDateString();

  const options = await recipeOptions();
  const recipe = options.find(r => r.id === body.recipeId);
  if (!recipe) { res.status(400).json({ error: "That recipe can't be the special — it needs to be on the menu and linked to its Shopify product." }); return; }

  const switchOn = body.switchOn ?? defaultSwitchOn(body.deliveringFrom, await billingOffsetDays(), today);
  const live = await db.select({ d: clubSpecialChangeoversTable.deliveringFrom }).from(clubSpecialChangeoversTable)
    .where(ne(clubSpecialChangeoversTable.status, "cancelled"));
  const problem = scheduleProblem({ deliveringFrom: body.deliveringFrom, switchOn, today, liveDeliveringFrom: live.map(r => r.d) });
  if (problem) { res.status(400).json({ error: problem }); return; }

  const ownerId = body.ownerId ?? user.id;
  const created = await db.transaction(async tx => {
    const [row] = await tx.insert(clubSpecialChangeoversTable).values({
      recipeId: recipe.id,
      deliveringFrom: body.deliveringFrom,
      switchOn,
      clubPricePence: body.clubPricePence ?? null,
      announcement: body.announcement?.trim() || null,
      ownerId,
      createdById: user.id,
      createdByName: user.name,
    }).returning();

    // The manual Zapiet steps, as dated to-dos on the owner's list.
    const ids: Record<string, number> = {};
    for (const t of zapietTodos({ recipeName: recipe.name, deliveringFrom: body.deliveringFrom, switchOn, today, clubPricePence: body.clubPricePence ?? null })) {
      const r = await tx.execute<{ id: number }>(sql`
        INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status, acknowledged_at)
        VALUES (${ownerId}, ${user.id}, ${user.name}, ${t.title}, ${t.notes}, '/club-special', 'high', ${t.dueDate}, 'open', NOW())
        RETURNING id
      `);
      ids[t.key] = Number(r.rows[0].id);
      await tx.execute(sql`
        INSERT INTO todo_task_comments (task_id, user_id, user_name, kind, body)
        VALUES (${ids[t.key]}, ${user.id}, ${user.name}, 'event', ${`Added from the Club Special changeover to ${recipe.name}`})
      `);
    }
    const [withTodos] = await tx.update(clubSpecialChangeoversTable)
      .set({ zapietEndTodoId: ids["end"], zapietStartTodoId: ids["start"] })
      .where(eq(clubSpecialChangeoversTable.id, row.id))
      .returning();
    return withTodos;
  });

  // "What's next" on the website follows straight away.
  void syncSpecialToShopify().catch(err => console.error("[club-special] sync after scheduling failed:", err));
  // Switch day already here (a short-notice changeover)? Do it now.
  if (switchOn <= today) await runDueChangeovers(today);

  res.status(201).json({ changeover: created });
});

/** Cancel a changeover that hasn't switched yet; its open to-dos go too. */
router.post("/:id/cancel", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const done = await db.transaction(async tx => {
    const [row] = await tx.update(clubSpecialChangeoversTable)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledByName: user.name })
      .where(and(eq(clubSpecialChangeoversTable.id, id), eq(clubSpecialChangeoversTable.status, "scheduled")))
      .returning();
    if (!row) return null;
    const todoIds = [row.zapietEndTodoId, row.zapietStartTodoId].filter((x): x is number => x != null);
    if (todoIds.length) await tx.execute(sql`DELETE FROM todo_tasks WHERE id = ANY(${`{${todoIds.join(",")}}`}::int[]) AND status = 'open'`);
    return row;
  });
  if (!done) { res.status(409).json({ error: "Only a changeover that hasn't switched yet can be cancelled." }); return; }
  void syncSpecialToShopify().catch(err => console.error("[club-special] sync after cancel failed:", err));
  res.json({ ok: true });
});

/** Switch a scheduled changeover today instead of waiting for its day. */
router.post("/:id/switch-now", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const today = londonDateString();
  const [row] = await db.update(clubSpecialChangeoversTable)
    .set({ switchOn: today })
    .where(and(eq(clubSpecialChangeoversTable.id, id), eq(clubSpecialChangeoversTable.status, "scheduled")))
    .returning();
  if (!row) { res.status(409).json({ error: "That changeover has already switched or was cancelled." }); return; }
  await runDueChangeovers(today);
  const [after] = await db.select().from(clubSpecialChangeoversTable).where(eq(clubSpecialChangeoversTable.id, id));
  res.json({ changeover: after });
});

export default router;

