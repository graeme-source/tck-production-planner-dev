/**
 * Cook-and-chill records for cooked sub-recipes (issue #244, Objective D) —
 * mounted at /api/cook-chill.
 *
 *   GET  /sub-recipes                 the sub-recipes ticked "cook and chill"
 *   GET  /sub-recipes/:id/flag        that tick on one sub-recipe
 *   PUT  /sub-recipes/:id/flag        set it (managers/admins; autosaved)
 *   GET  /board                       records the Prep and Wrapping cards show
 *   POST /records                     cook-out core temp + hold (Prep)
 *   POST /records/:id/chill-start     "Into blast chiller"
 *   POST /records/:id/chill-end       "Chilling finished" (Wrapping or Prep)
 *   GET  /log?from=&to=               HACCP: cook-chill records + ONE cooling
 *                                     log for calzones and sub-recipes
 *                                     (managers/admins)
 *
 * Which sub-recipes need it is the sub_recipes.cook_chill_required tick
 * (migration 0228), never a name. The cook temperature is judged on screen
 * against the FSA time/temperature table (lib/cook-standards.ts), never a
 * fixed 75°C. Cooling rules: lib/cooling-cycles.ts (shared with the calzone
 * chill timer, #85).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, subRecipesTable, cookChillRecordsTable, usersTable, appSettingsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import * as z from "zod";
import { validate, validateQuery } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { londonDateString, londonDaysWindowUtc } from "../lib/london-time";
import {
  canFinishChill, canStartChill, cookChillStage, onCookChillBoard,
  calzoneCoolingCycle, subRecipeCoolingCycle, coolingLog,
} from "../lib/cooling-cycles";

const router: IRouter = Router();

type RecordRow = typeof cookChillRecordsTable.$inferSelect;

function toApi(r: RecordRow) {
  return {
    id: r.id,
    subRecipeId: r.subRecipeId,
    subRecipeName: r.subRecipeName,
    planId: r.planId,
    cookTempC: Number(r.cookTempC),
    cookHeldForSeconds: r.cookHeldForSeconds,
    cookedByName: r.cookedByName,
    cookedAt: r.cookedAt.toISOString(),
    chillStartAt: r.chillStartAt?.toISOString() ?? null,
    chillStartByName: r.chillStartByName,
    chillEndAt: r.chillEndAt?.toISOString() ?? null,
    chillEndByName: r.chillEndByName,
    chilledVia: r.chilledVia,
    stage: cookChillStage(r),
  };
}

async function userName(req: Request): Promise<string> {
  if (!req.session.userId) return "Unknown";
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId));
  return u?.name ?? "Unknown";
}

function idParam(req: Request, res: Response, what: string): number | null {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: `Invalid ${what}` }); return null; }
  return id;
}

// ─── Which sub-recipes need it ──────────────────────────────────────────

router.get("/sub-recipes", async (_req: Request, res: Response) => {
  const rows = await db.select({ id: subRecipesTable.id, name: subRecipesTable.name })
    .from(subRecipesTable)
    .where(eq(subRecipesTable.cookChillRequired, true))
    .orderBy(asc(subRecipesTable.name));
  res.json({ subRecipes: rows });
});

router.get("/sub-recipes/:id/flag", async (req: Request, res: Response) => {
  const id = idParam(req, res, "sub-recipe");
  if (id == null) return;
  const [row] = await db.select({ cookChillRequired: subRecipesTable.cookChillRequired })
    .from(subRecipesTable).where(eq(subRecipesTable.id, id));
  if (!row) { res.status(404).json({ error: "Sub-recipe not found" }); return; }
  res.json({ cookChillRequired: row.cookChillRequired });
});

const FlagBody = z.object({ cookChillRequired: z.boolean() });

router.put("/sub-recipes/:id/flag", requireManagerOrAdmin, validate(FlagBody), async (req: Request, res: Response) => {
  const id = idParam(req, res, "sub-recipe");
  if (id == null) return;
  const { cookChillRequired } = req.body as z.infer<typeof FlagBody>;
  const [row] = await db.update(subRecipesTable).set({ cookChillRequired })
    .where(eq(subRecipesTable.id, id)).returning({ cookChillRequired: subRecipesTable.cookChillRequired });
  if (!row) { res.status(404).json({ error: "Sub-recipe not found" }); return; }
  res.json({ cookChillRequired: row.cookChillRequired });
});

// ─── The Prep / Wrapping board ──────────────────────────────────────────

router.get("/board", async (_req: Request, res: Response) => {
  const now = new Date();
  const { start: todayStart } = londonDaysWindowUtc(londonDateString(now), londonDateString(now));
  const since = new Date(now.getTime() - 72 * 3_600_000);
  const rows = await db.select().from(cookChillRecordsTable)
    .where(or(
      and(isNull(cookChillRecordsTable.chillEndAt), gte(cookChillRecordsTable.cookedAt, since)),
      gte(cookChillRecordsTable.chillEndAt, todayStart),
    ))
    .orderBy(asc(cookChillRecordsTable.cookedAt));
  const [setting] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable)
    .where(eq(appSettingsTable.key, "chill_target_temp_c"));
  res.json({
    records: rows.filter(r => onCookChillBoard(r, now, todayStart)).map(toApi),
    chillTargetTempC: Number(setting?.value ?? 4),
  });
});

// ─── The steps ──────────────────────────────────────────────────────────

const CookBody = z.object({
  subRecipeId: z.number().int().positive(),
  planId: z.number().int().positive().nullable().optional(),
  cookTempC: z.number().min(0).max(120),
  heldForSeconds: z.number().int().min(1).max(86_400),
});

router.post("/records", validate(CookBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof CookBody>;
  const [sr] = await db.select({ name: subRecipesTable.name, cookChillRequired: subRecipesTable.cookChillRequired })
    .from(subRecipesTable).where(eq(subRecipesTable.id, body.subRecipeId));
  if (!sr) { res.status(404).json({ error: "Sub-recipe not found" }); return; }
  if (!sr.cookChillRequired) { res.status(400).json({ error: `${sr.name} isn't set up for cook and chill` }); return; }
  const [row] = await db.insert(cookChillRecordsTable).values({
    subRecipeId: body.subRecipeId,
    subRecipeName: sr.name,
    planId: body.planId ?? null,
    cookTempC: String(Math.round(body.cookTempC * 10) / 10),
    cookHeldForSeconds: body.heldForSeconds,
    cookedBy: req.session.userId ?? null,
    cookedByName: await userName(req),
  }).returning();
  res.status(201).json({ record: toApi(row!) });
});

// Nothing to send — the time and person come from the server. Optional so
// a bodyless POST isn't refused.
const StartBody = z.object({}).passthrough().optional();

router.post("/records/:id/chill-start", validate(StartBody), async (req: Request, res: Response) => {
  const id = idParam(req, res, "record");
  if (id == null) return;
  const [cur] = await db.select().from(cookChillRecordsTable).where(eq(cookChillRecordsTable.id, id));
  if (!cur) { res.status(404).json({ error: "Record not found" }); return; }
  const verdict = canStartChill(cur);
  if (!verdict.ok) {
    if (verdict.already) { res.json({ record: toApi(cur), already: true }); return; }
    res.status(409).json({ error: verdict.error }); return;
  }
  // Guarded on chill_start_at IS NULL so two taps from two iPads can't
  // overwrite the first time.
  const [row] = await db.update(cookChillRecordsTable).set({
    chillStartAt: sql`NOW()`,
    chillStartBy: req.session.userId ?? null,
    chillStartByName: await userName(req),
  }).where(and(eq(cookChillRecordsTable.id, id), isNull(cookChillRecordsTable.chillStartAt))).returning();
  if (!row) {
    const [now] = await db.select().from(cookChillRecordsTable).where(eq(cookChillRecordsTable.id, id));
    res.json({ record: toApi(now!), already: true }); return;
  }
  res.json({ record: toApi(row), already: false });
});

const EndBody = z.object({ via: z.enum(["prep_station", "wrapping_station"]) });

router.post("/records/:id/chill-end", validate(EndBody), async (req: Request, res: Response) => {
  const id = idParam(req, res, "record");
  if (id == null) return;
  const { via } = req.body as z.infer<typeof EndBody>;
  const [cur] = await db.select().from(cookChillRecordsTable).where(eq(cookChillRecordsTable.id, id));
  if (!cur) { res.status(404).json({ error: "Record not found" }); return; }
  const verdict = canFinishChill(cur);
  if (!verdict.ok) {
    if (verdict.already) { res.json({ record: toApi(cur), already: true }); return; }
    res.status(409).json({ error: verdict.error }); return;
  }
  const [row] = await db.update(cookChillRecordsTable).set({
    chillEndAt: sql`NOW()`,
    chillEndBy: req.session.userId ?? null,
    chillEndByName: await userName(req),
    chilledVia: via,
  }).where(and(eq(cookChillRecordsTable.id, id), isNull(cookChillRecordsTable.chillEndAt))).returning();
  if (!row) {
    const [now] = await db.select().from(cookChillRecordsTable).where(eq(cookChillRecordsTable.id, id));
    res.json({ record: toApi(now!), already: true }); return;
  }
  res.json({ record: toApi(row), already: false });
});

// ─── HACCP log ──────────────────────────────────────────────────────────

const LogQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.get("/log", requireManagerOrAdmin, validateQuery(LogQuery), async (_req: Request, res: Response) => {
  const { from, to } = res.locals["query"] as z.infer<typeof LogQuery>;
  const { start, end } = londonDaysWindowUtc(from, to);

  const records = await db.select().from(cookChillRecordsTable)
    .where(and(gte(cookChillRecordsTable.cookedAt, start), lt(cookChillRecordsTable.cookedAt, end)))
    .orderBy(desc(cookChillRecordsTable.cookedAt));

  // Calzone chills (#85): the last oven batch of each recipe starts the clock.
  const calzone = await db.execute(sql`
    SELECT bwr.id, r.name AS recipe_name, bwr.recorded_at, bwr.chill_end_at, bwr.chilled_via,
           u_weigh.name AS weighed_by_name, u_chill.name AS chilled_by_name
    FROM batch_weight_records bwr
    JOIN recipes r ON r.id = bwr.recipe_id
    LEFT JOIN app_users u_weigh ON u_weigh.id = bwr.user_id
    LEFT JOIN app_users u_chill ON u_chill.id = bwr.chilled_by_user_id
    WHERE bwr.is_last_batch_of_recipe = TRUE
      AND bwr.recorded_at >= ${start} AND bwr.recorded_at < ${end}
  `);

  const cooling = coolingLog([
    ...(calzone.rows as Array<Record<string, unknown>>).map(r => calzoneCoolingCycle({
      id: Number(r["id"]),
      recipeName: (r["recipe_name"] as string) ?? null,
      recordedAt: r["recorded_at"] as string,
      chillEndAt: (r["chill_end_at"] as string) ?? null,
      chilledVia: (r["chilled_via"] as string) ?? null,
      weighedByName: (r["weighed_by_name"] as string) ?? null,
      chilledByName: (r["chilled_by_name"] as string) ?? null,
    })),
    ...records.map(r => subRecipeCoolingCycle(r)),
  ]);

  const [setting] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable)
    .where(eq(appSettingsTable.key, "chill_target_temp_c"));
  res.json({ records: records.map(toApi), cooling, chillTargetTempC: Number(setting?.value ?? 4) });
});

export default router;
