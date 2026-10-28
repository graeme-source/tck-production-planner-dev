/**
 * One production plan per day — merge a new calzone plan into the day's
 * existing plan (Graeme, 2026-10-28).
 *
 *   POST /plan-merge/:planId   body = the Create Plan screen's save
 *
 * Fried chicken (or mac cheese) can now be planned onto a day before the
 * calzone plan exists, which makes that day's plan. When Create Plan is then
 * saved for the same date it comes here instead of POST /production-plans:
 * the calzone lines are added INTO the existing plan, exactly as if
 * everything had been added at the same time, and the fried chicken already
 * there (and anything counted against it) is left untouched.
 *
 * The rule itself — which plan is mergeable, how the merged plan is laid out,
 * which status wins — is @workspace/production-schedule plan-merge.ts
 * (tested). This file is only the database side. Lives in its own router
 * because the charter forbids new code in routes/production-plans.ts; reuses
 * its exported date resolvers so prep/dough dates follow the create rules.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, productionPlansTable, productionPlanItemsTable, recipesTable, queuedProductionTable,
} from "@workspace/db";
import { mergeBlock, mergedNotes, mergedStatus, planMergeLayout, isRepeatMerge, kitchenLine } from "@workspace/production-schedule";
import { validate } from "../middleware/validate";
import { resolveRole } from "../middleware/roles";
import { londonDateString } from "../lib/london-time";
import { resolveDefaultPrepDate, resolveDefaultDoughDate } from "./production-plans";
import { slowMeatNewLinesGuard } from "./slow-meat";

const router: IRouter = Router();

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");

// Same shape as a Create Plan save, so the screen sends one body either way.
const MergeBody = z.object({
  planDate: DATE,
  prepDate: DATE.nullish(),
  doughDate: DATE.nullish(),
  name: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).nullish(),
  status: z.enum(["draft", "active", "prep", "building"]).optional(),
  items: z.array(z.object({
    recipeId: z.number().int().positive(),
    batchesTarget: z.number().int().min(0).max(10_000).default(0),
    orderPosition: z.number().int().optional(),
    tinSize: z.string().nullish(),
    maxBatchesPerTin: z.number().int().nullish(),
    sopUrl: z.string().nullish(),
    notes: z.string().nullish(),
  })).min(1, "Nothing to add"),
});

router.post("/:planId", slowMeatNewLinesGuard, validate(MergeBody), async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId) || planId <= 0) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const body = req.body as z.infer<typeof MergeBody>;

  // The create route's date rule for real production, unchanged: managers and
  // admins can plan any day; everyone else weekdays from today on.
  const role = await resolveRole(req);
  if (role !== "admin" && role !== "manager") {
    const dow = new Date(`${body.planDate}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) {
      res.status(400).json({ error: "Production plans can only be scheduled on weekdays (Monday–Friday)." });
      return;
    }
    if (body.planDate < londonDateString()) {
      res.status(400).json({ error: "Production plans cannot be scheduled for past dates." });
      return;
    }
  }

  try {
    const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

    const existing = await db
      .select({
        id: productionPlanItemsTable.id,
        recipeId: productionPlanItemsTable.recipeId,
        orderPosition: productionPlanItemsTable.orderPosition,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        recipeCategory: recipesTable.category,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(recipesTable.id, productionPlanItemsTable.recipeId))
      .where(eq(productionPlanItemsTable.planId, planId));

    const block = mergeBlock(plan, existing, body.planDate);
    if (block === "has-calzones") {
      // A double tap: the first request already merged these lines.
      const calzones = existing.filter(e => kitchenLine(e.recipeCategory) === "calzone");
      if (isRepeatMerge(calzones, body.items)) {
        res.json({ ...plan, createdAt: plan.createdAt.toISOString(), merged: true, addedCount: 0, skippedRecipeIds: [] });
        return;
      }
      res.status(409).json({
        error: "That day's plan already has calzones on it — open it to change it.",
        code: "PLAN_HAS_CALZONES",
      });
      return;
    }
    if (block === "wrong-date") {
      res.status(400).json({ error: "That plan is for a different day." });
      return;
    }
    if (block === "complete") {
      res.status(409).json({ error: "That day's plan is already complete.", code: "PLAN_COMPLETE" });
      return;
    }

    const recipeIds = [...new Set(body.items.map(i => i.recipeId))];
    const recipes = await db
      .select({ id: recipesTable.id, tinSize: recipesTable.tinSize, maxBatchesPerTin: recipesTable.maxBatchesPerTin })
      .from(recipesTable)
      .where(inArray(recipesTable.id, recipeIds));
    const recipeById = new Map(recipes.map(r => [r.id, r]));
    const missing = recipeIds.filter(id => !recipeById.has(id));
    if (missing.length > 0) {
      res.status(400).json({ error: `Recipe ${missing.join(", ")} not found` });
      return;
    }

    // Items arrive in the planner's order; orderPosition breaks ties if sent.
    const incoming = [...body.items].sort((a, b) => (a.orderPosition ?? 0) - (b.orderPosition ?? 0));
    const layout = planMergeLayout(existing, incoming);

    const [prepDate, doughDate] = await Promise.all([
      body.prepDate ?? resolveDefaultPrepDate(body.planDate),
      body.doughDate ?? resolveDefaultDoughDate(body.planDate),
    ]);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(productionPlansTable)
        .set({
          // The calzone plan's name, dates and status lead — the same as if
          // it had been created with the fried chicken already in it. The
          // status never steps backwards (a draft save can't take an active
          // chicken run off the stations).
          name: body.name,
          prepDate,
          doughDate,
          notes: mergedNotes(plan.notes, body.notes),
          status: mergedStatus(plan.status, body.status),
        })
        .where(eq(productionPlansTable.id, planId))
        .returning();

      for (const m of layout.moves) {
        await tx.update(productionPlanItemsTable)
          .set({ orderPosition: m.orderPosition })
          .where(eq(productionPlanItemsTable.id, m.id));
      }

      if (layout.inserts.length > 0) {
        await tx.insert(productionPlanItemsTable).values(layout.inserts.map(({ incomingIndex, orderPosition }) => {
          const i = incoming[incomingIndex]!;
          const r = recipeById.get(i.recipeId);
          return {
            planId,
            recipeId: i.recipeId,
            batchesTarget: i.batchesTarget ?? 0,
            orderPosition,
            tinSize: i.tinSize ?? r?.tinSize ?? null,
            maxBatchesPerTin: i.maxBatchesPerTin ?? r?.maxBatchesPerTin ?? null,
            sopUrl: i.sopUrl ?? null,
            notes: i.notes ?? null,
            status: "pending",
          };
        }));

        // Queued test production for this date lands on the plan, as on create.
        const added = layout.inserts.map(x => incoming[x.incomingIndex]!.recipeId);
        await tx.update(queuedProductionTable)
          .set({ status: "planned", planId })
          .where(and(
            eq(queuedProductionTable.productionDate, body.planDate),
            eq(queuedProductionTable.status, "queued"),
            inArray(queuedProductionTable.recipeId, added),
          ));
      }
      return row!;
    });

    res.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      merged: true,
      addedCount: layout.inserts.length,
      skippedRecipeIds: layout.skippedRecipeIds,
    });
  } catch (err) {
    console.error("[plan-merge] merge failed:", err);
    res.status(500).json({ error: "Couldn't add the calzones to that day's plan" });
  }
});

export default router;
