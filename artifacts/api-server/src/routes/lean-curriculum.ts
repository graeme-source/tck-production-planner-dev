/**
 * The lean curriculum planner (Objective E — Graeme, 2026-08-26).
 *
 * Above the existing two levels (lean_principles = the weekly theme,
 * lean_examples = the five daily angles) sits the layer this file serves:
 * a BACKLOG of lean subjects, and a PLAN that says which subject each week
 * teaches, in what order.
 *
 * The working loop it exists to support:
 *   1. Look at the backlog — every concept from the verified corpus.
 *   2. Drag a subject into the plan, saying how many weeks it needs
 *      (3S becomes four: the idea, then Sweep, Sort, Standardise).
 *   3. Ask for that week's five lessons to be written.
 *   4. Read them, fix anything wrong, then lock the week in.
 *
 * Two rules hold the whole thing together:
 *   - Only LOCKED weeks reach the team. A half-written week can sit in the
 *     plan for months without ever appearing in a morning meeting.
 *   - The Lean training matrix mirrors the plan, always, in the same
 *     transaction (see lib/lean-matrix-sync.ts). There is no seeder script
 *     to remember to run.
 *
 * Manager/admin only — mounted behind requireManagerOrAdmin in routes/index.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  leanSubjectsTable,
  leanPrinciplesTable,
  leanExamplesTable,
  trainingMatricesTable,
  trainingMatrixItemsTable,
  trainingRecordsTable,
} from "@workspace/db";
import { validate } from "../middleware/validate";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { leanCorpusPrompt, LMS_BACKLOG_SUBJECTS } from "../lib/lean-corpus";
import { planMatrixSync, matrixLabelFor, isNoopPlan, type MatrixItemRow } from "../lib/lean-matrix-sync";
import type Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

/** The catch-all principle that holds one-off generated lessons — it is not
 *  part of the weekly plan and must never appear in the planner. Matches the
 *  constant in routes/morning-meetings.ts. */
const ON_DEMAND_PRINCIPLE_TITLE = "On-demand lessons";

/** Positions at or above this are parked rows (the on-demand catch-all),
 *  never scheduled weeks. Same convention the rotation and the old seeder use. */
const PARKED_POSITION_FLOOR = 1000;

const MATRIX_NAME = "Lean — Lean Made Simple";

// ─── The plan ────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Every scheduled week, in plan order. Excludes the on-demand catch-all. */
async function scheduledWeeks(tx: Tx | typeof db = db) {
  return tx
    .select()
    .from(leanPrinciplesTable)
    .where(and(
      ne(leanPrinciplesTable.title, ON_DEMAND_PRINCIPLE_TITLE),
      sql`${leanPrinciplesTable.weekPosition} < ${PARKED_POSITION_FLOOR}`,
    ))
    .orderBy(asc(leanPrinciplesTable.weekPosition));
}

/**
 * Bring the Lean training matrix in line with the plan. Called inside the
 * same transaction as every change to the plan, so the two can't drift.
 * Returns the ids of columns kept as history (a week left the plan but
 * people had already been signed off on it) so the caller can say so.
 */
async function syncMatrix(tx: Tx): Promise<{ keptAsHistory: number[] }> {
  const weeks = await scheduledWeeks(tx);

  let [matrix] = await tx.select({ id: trainingMatricesTable.id })
    .from(trainingMatricesTable)
    .where(eq(trainingMatricesTable.name, MATRIX_NAME));
  if (!matrix) {
    if (weeks.length === 0) return { keptAsHistory: [] };
    [matrix] = await tx.insert(trainingMatricesTable).values({
      name: MATRIX_NAME,
      description: "The weekly lean curriculum. Columns follow the curriculum planner, and a cell ticks itself when someone completes that week's in-app lesson review.",
    }).returning({ id: trainingMatricesTable.id });
  }

  const existing = await tx
    .select({
      id: trainingMatrixItemsTable.id,
      label: trainingMatrixItemsTable.label,
      principleId: trainingMatrixItemsTable.principleId,
      sortOrder: trainingMatrixItemsTable.sortOrder,
      signOffs: sql<number>`(
        SELECT COUNT(*) FROM ${trainingRecordsTable}
        WHERE ${trainingRecordsTable.itemId} = ${trainingMatrixItemsTable.id}
          AND ${trainingRecordsTable.trained} = TRUE
      )`,
    })
    .from(trainingMatrixItemsTable)
    .where(eq(trainingMatrixItemsTable.matrixId, matrix.id));

  const items: MatrixItemRow[] = existing.map(row => ({
    id: row.id,
    label: row.label,
    principleId: row.principleId,
    sortOrder: row.sortOrder,
    hasSignOffs: Number(row.signOffs) > 0,
  }));

  const plan = planMatrixSync(
    weeks.map((w, i) => ({
      principleId: w.id,
      title: w.title,
      partLabel: w.partLabel,
      position: i + 1,
    })),
    items,
  );

  if (isNoopPlan(plan)) return { keptAsHistory: plan.keepAsHistory };

  for (const c of plan.create) {
    await tx.insert(trainingMatrixItemsTable).values({
      matrixId: matrix.id,
      label: c.label,
      principleId: c.principleId,
      sortOrder: c.sortOrder,
    });
  }
  for (const u of plan.update) {
    await tx.update(trainingMatrixItemsTable)
      .set({ label: u.label, sortOrder: u.sortOrder })
      .where(eq(trainingMatrixItemsTable.id, u.id));
  }
  for (const id of plan.remove) {
    await tx.delete(trainingMatrixItemsTable).where(eq(trainingMatrixItemsTable.id, id));
  }

  return { keptAsHistory: plan.keepAsHistory };
}

/**
 * Renumber the plan to 1..N in the given order.
 *
 * week_position carries a UNIQUE constraint, so a naive "set each row to its
 * new number" collides the moment two weeks swap. Both passes therefore run
 * through a temporary negative range that nothing else can occupy.
 */
async function renumber(tx: Tx, orderedIds: number[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await tx.update(leanPrinciplesTable)
      .set({ weekPosition: -(i + 1), updatedAt: new Date() })
      .where(eq(leanPrinciplesTable.id, orderedIds[i]!));
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await tx.update(leanPrinciplesTable)
      .set({ weekPosition: i + 1, updatedAt: new Date() })
      .where(eq(leanPrinciplesTable.id, orderedIds[i]!));
  }
}

/** Seed the backlog from the verified corpus the first time the planner is
 *  opened. Idempotent: existing titles are left exactly as they are, so a
 *  subject Graeme has edited is never overwritten by a later top-up. */
async function ensureBacklogSeeded() {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(leanSubjectsTable);
  if (Number(count) > 0) return;

  await db.insert(leanSubjectsTable).values(
    LMS_BACKLOG_SUBJECTS.map((s, i) => ({
      title: s.title,
      nutshell: s.nutshell,
      source: s.source,
      audience: s.audience,
      defaultWeeks: s.defaultWeeks,
      suggestedParts: s.suggestedParts ?? null,
      sortOrder: i + 1,
    })),
  ).onConflictDoNothing();
}

// GET / — the whole planner in one payload: the plan (scheduled weeks, with
// enough per-week detail to see what's ready to teach) and the backlog.
router.get("/", async (_req: Request, res: Response) => {
  try {
    await ensureBacklogSeeded();

    const weeks = await db
      .select({
        id: leanPrinciplesTable.id,
        weekPosition: leanPrinciplesTable.weekPosition,
        title: leanPrinciplesTable.title,
        summary: leanPrinciplesTable.summary,
        status: leanPrinciplesTable.status,
        isActive: leanPrinciplesTable.isActive,
        subjectId: leanPrinciplesTable.subjectId,
        partLabel: leanPrinciplesTable.partLabel,
        partIndex: leanPrinciplesTable.partIndex,
        quizJson: leanPrinciplesTable.quizJson,
        lessonCount: sql<number>`(
          SELECT COUNT(*) FROM ${leanExamplesTable}
          WHERE ${leanExamplesTable.principleId} = ${leanPrinciplesTable.id}
            AND ${leanExamplesTable.isActive} = TRUE
        )`,
        videoCount: sql<number>`(
          SELECT COUNT(*) FROM ${leanExamplesTable}
          WHERE ${leanExamplesTable.principleId} = ${leanPrinciplesTable.id}
            AND ${leanExamplesTable.isActive} = TRUE
            AND ${leanExamplesTable.videoUrl} IS NOT NULL
            AND ${leanExamplesTable.videoUrl} <> ''
        )`,
      })
      .from(leanPrinciplesTable)
      .where(and(
        ne(leanPrinciplesTable.title, ON_DEMAND_PRINCIPLE_TITLE),
        sql`${leanPrinciplesTable.weekPosition} < ${PARKED_POSITION_FLOOR}`,
      ))
      .orderBy(asc(leanPrinciplesTable.weekPosition));

    const subjects = await db
      .select()
      .from(leanSubjectsTable)
      .where(eq(leanSubjectsTable.isArchived, false))
      .orderBy(asc(leanSubjectsTable.sortOrder), asc(leanSubjectsTable.id));

    res.json({
      weeks: weeks.map(w => {
        let quizCount = 0;
        try {
          const parsed = w.quizJson ? JSON.parse(w.quizJson) : null;
          if (Array.isArray(parsed)) quizCount = parsed.length;
        } catch { /* malformed quiz reads as none, same as the review flow */ }
        return {
          id: w.id,
          weekPosition: w.weekPosition,
          title: w.title,
          summary: w.summary,
          status: w.status,
          isActive: w.isActive,
          subjectId: w.subjectId,
          partLabel: w.partLabel,
          partIndex: w.partIndex,
          lessonCount: Number(w.lessonCount),
          videoCount: Number(w.videoCount),
          quizCount,
          matrixLabel: matrixLabelFor({ title: w.title, partLabel: w.partLabel }),
        };
      }),
      subjects,
    });
  } catch (err) {
    console.error("[lean-curriculum] load failed:", err);
    res.status(500).json({ error: "Failed to load the curriculum" });
  }
});

// ─── Backlog subjects ────────────────────────────────────────────────────────

const subjectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  nutshell: z.string().trim().min(1).max(1000),
  audience: z.enum(["team", "leaders"]).default("team"),
  defaultWeeks: z.number().int().min(1).max(12).default(1),
  suggestedParts: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
});

router.post("/subjects", validate(subjectSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof subjectSchema>;
  try {
    const [{ maxOrder }] = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${leanSubjectsTable.sortOrder}), 0)` })
      .from(leanSubjectsTable);
    const [created] = await db.insert(leanSubjectsTable).values({
      title: body.title,
      nutshell: body.nutshell,
      source: "custom",
      audience: body.audience,
      defaultWeeks: body.defaultWeeks,
      suggestedParts: body.suggestedParts ?? null,
      sortOrder: Number(maxOrder) + 1,
    }).returning();
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A subject with that name is already in the backlog" });
      return;
    }
    console.error("[lean-curriculum] create subject failed:", err);
    res.status(500).json({ error: "Failed to add the subject" });
  }
});

const subjectPatchSchema = subjectSchema.partial().extend({
  isArchived: z.boolean().optional(),
});

router.patch("/subjects/:id", validate(subjectPatchSchema), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as z.infer<typeof subjectPatchSchema>;
  try {
    const [updated] = await db.update(leanSubjectsTable)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.nutshell !== undefined ? { nutshell: body.nutshell } : {}),
        ...(body.audience !== undefined ? { audience: body.audience } : {}),
        ...(body.defaultWeeks !== undefined ? { defaultWeeks: body.defaultWeeks } : {}),
        ...(body.suggestedParts !== undefined ? { suggestedParts: body.suggestedParts } : {}),
        ...(body.isArchived !== undefined ? { isArchived: body.isArchived } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leanSubjectsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Subject not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("[lean-curriculum] update subject failed:", err);
    res.status(500).json({ error: "Failed to update the subject" });
  }
});

// ─── The plan: adding, re-ordering and removing weeks ────────────────────────

const addWeeksSchema = z.object({
  subjectId: z.number().int().positive(),
  /** How many weeks this subject should occupy. */
  weeks: z.number().int().min(1).max(12).default(1),
  /** Names for the split weeks. When the subject runs over several weeks the
   *  first is the overview (no part label) and these name the rest. */
  parts: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  /** 1-based slot to drop them at; default is the end of the plan. */
  position: z.number().int().min(1).optional(),
});

router.post("/weeks", validate(addWeeksSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof addWeeksSchema>;
  try {
    const result = await db.transaction(async (tx) => {
      const [subject] = await tx.select().from(leanSubjectsTable).where(eq(leanSubjectsTable.id, body.subjectId));
      if (!subject) return { error: "Subject not found" as const };

      const parts = body.parts ?? (subject.suggestedParts ?? []);
      const existing = await scheduledWeeks(tx);

      // Park the new weeks above everything first, then renumber the whole
      // plan into the requested order — keeps the UNIQUE position happy.
      const [{ maxPos }] = await tx
        .select({ maxPos: sql<number>`COALESCE(MAX(${leanPrinciplesTable.weekPosition}), 0)` })
        .from(leanPrinciplesTable)
        .where(sql`${leanPrinciplesTable.weekPosition} < ${PARKED_POSITION_FLOOR}`);

      const createdIds: number[] = [];
      for (let i = 0; i < body.weeks; i++) {
        // A single-week subject is just the subject. A multi-week subject
        // opens with an overview week and then takes one part per week.
        const partLabel = body.weeks > 1 && i > 0 ? (parts[i - 1] ?? `Part ${i}`) : null;
        const [created] = await tx.insert(leanPrinciplesTable).values({
          weekPosition: Number(maxPos) + i + 1,
          title: subject.title,
          summary: subject.nutshell,
          subjectId: subject.id,
          partLabel,
          partIndex: body.weeks > 1 ? i + 1 : null,
          // Nothing is written yet — it must not reach a morning meeting.
          status: "draft",
          isActive: true,
        }).returning({ id: leanPrinciplesTable.id });
        createdIds.push(created!.id);
      }

      const existingIds = existing.map(w => w.id);
      const at = body.position ? Math.min(body.position - 1, existingIds.length) : existingIds.length;
      const ordered = [...existingIds.slice(0, at), ...createdIds, ...existingIds.slice(at)];
      await renumber(tx, ordered);

      const { keptAsHistory } = await syncMatrix(tx);
      return { createdIds, keptAsHistory };
    });

    if ("error" in result) { res.status(404).json({ error: result.error }); return; }
    res.status(201).json(result);
  } catch (err) {
    console.error("[lean-curriculum] add weeks failed:", err);
    res.status(500).json({ error: "Failed to add the subject to the plan" });
  }
});

const reorderSchema = z.object({
  orderedIds: z.array(z.number().int().positive()).min(1).max(500),
});

router.put("/weeks/order", validate(reorderSchema), async (req: Request, res: Response) => {
  const { orderedIds } = req.body as z.infer<typeof reorderSchema>;
  try {
    const result = await db.transaction(async (tx) => {
      const current = await scheduledWeeks(tx);
      const currentIds = new Set(current.map(w => w.id));
      // The client must send the whole plan back — a partial list would
      // silently drop weeks out of the ordering.
      if (orderedIds.length !== currentIds.size || orderedIds.some(id => !currentIds.has(id))) {
        return { error: "The order sent doesn't match the current plan — reload and try again" as const };
      }
      await renumber(tx, orderedIds);
      return await syncMatrix(tx);
    });
    if ("error" in result) { res.status(409).json({ error: result.error }); return; }
    res.json(result);
  } catch (err) {
    console.error("[lean-curriculum] reorder failed:", err);
    res.status(500).json({ error: "Failed to save the new order" });
  }
});

const weekPatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  summary: z.string().trim().min(1).max(1000).optional(),
  partLabel: z.string().trim().max(80).nullable().optional(),
  status: z.enum(["draft", "locked"]).optional(),
});

router.patch("/weeks/:id", validate(weekPatchSchema), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as z.infer<typeof weekPatchSchema>;
  try {
    const result = await db.transaction(async (tx) => {
      // Locking a week is a promise that it's ready to teach, so it has to
      // actually have lessons in it. Everything else can be saved freely.
      if (body.status === "locked") {
        const [{ lessons }] = await tx
          .select({ lessons: sql<number>`COUNT(*)` })
          .from(leanExamplesTable)
          .where(and(eq(leanExamplesTable.principleId, id), eq(leanExamplesTable.isActive, true)));
        if (Number(lessons) === 0) {
          return { error: "This week has no lessons yet — write them before locking it in" as const };
        }
      }
      const [updated] = await tx.update(leanPrinciplesTable)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.summary !== undefined ? { summary: body.summary } : {}),
          ...(body.partLabel !== undefined ? { partLabel: body.partLabel } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(leanPrinciplesTable.id, id))
        .returning();
      if (!updated) return { error: "Week not found" as const };
      await syncMatrix(tx);
      return { week: updated };
    });
    if ("error" in result) {
      res.status(result.error === "Week not found" ? 404 : 409).json({ error: result.error });
      return;
    }
    res.json(result.week);
  } catch (err) {
    console.error("[lean-curriculum] update week failed:", err);
    res.status(500).json({ error: "Failed to update the week" });
  }
});

router.delete("/weeks/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const deleted = await tx.delete(leanPrinciplesTable)
        .where(eq(leanPrinciplesTable.id, id))
        .returning({ id: leanPrinciplesTable.id });
      if (deleted.length === 0) return { error: "Week not found" as const };
      const remaining = await scheduledWeeks(tx);
      await renumber(tx, remaining.map(w => w.id));
      return await syncMatrix(tx);
    });
    if ("error" in result) { res.status(404).json({ error: result.error }); return; }
    res.json(result);
  } catch (err) {
    console.error("[lean-curriculum] delete week failed:", err);
    res.status(500).json({ error: "Failed to remove the week" });
  }
});

// ─── Writing a week's lessons ────────────────────────────────────────────────

/**
 * The video rule (Graeme, 2026-08-26: "I only want videos if they're
 * relevant and make sense and really need to demonstrate the point").
 *
 * An earlier pass gave all 45 existing lessons a clip so no morning played
 * nothing — which turned into everyone watching a video every single day.
 * The generator now treats a video as something a day has to earn: normally
 * the Monday, where a new concept is being introduced, and otherwise only
 * where seeing it beats being told it.
 */
const WEEK_TOOL: Anthropic.Tool = {
  name: "emit_week",
  description: "Return the finished week: five daily lessons plus the week's review quiz.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One sentence capturing what the team will be able to do by Friday." },
      lessons: {
        type: "array",
        minItems: 5,
        maxItems: 5,
        description: "Monday to Friday, in order.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short lesson title. No week or day number." },
            summary: { type: "string", description: "One punchy sentence capturing this day's angle." },
            explanationMd: { type: "string", description: "Markdown for the host's own prep — what this means, 2-4 short paragraphs. Never shown to the team. No headings (#)." },
            whatToShowMd: { type: "string", description: "THE SLIDE THE TEAM SEES. Speak TO them ('we', 'you'). A short **bold heading**, then 3-5 tight bullets, then a line starting '**Today:**' or '**Today's question:**'. Never instructions to the host. No headings (#)." },
            deliveryNotesMd: { type: "string", description: "Host directions — a '**Talking points:**' list of 2-3 bullets then a '**Prompt:**' line. Never shown to the team. No headings (#)." },
            wantsVideo: { type: "boolean", description: "True ONLY if watching something would teach this day better than talking about it — typically the Monday introduction. Most days should be false; the team should not watch a video every morning." },
            videoRationale: { type: "string", description: "If wantsVideo is true, one line on what the clip needs to show." },
          },
          required: ["title", "summary", "explanationMd", "whatToShowMd", "deliveryNotesMd", "wantsVideo"],
        },
      },
      quiz: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        description: "The week's review questions — understanding, not trivia.",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            options: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 4 },
            answer: { type: "number", description: "0-based index of the correct option." },
          },
          required: ["question", "options", "answer"],
        },
      },
    },
    required: ["summary", "lessons", "quiz"],
  },
};

function weekSystemPrompt(): string {
  return `You write the weekly lean curriculum for the morning stand-up at The Calzone Kitchen, a UK artisan food business making calzones and macaroni cheese. The team practises Two Second Lean (Paul Akers) and learned lean from Lean Made Simple by Ryan Tierney, so terminology consistency with it is non-negotiable.

${leanCorpusPrompt()}

WHO YOU ARE WRITING FOR — this matters more than anything else here.
Lean Made Simple is written for a business owner transforming a company. You are NOT writing for that person. You are writing for a team member learning lean inside a business that is already transforming: someone stretching dough, wrapping calzones, packing boxes. Teach them how to see waste, how to make an improvement, what a concept means and why it's worth their time. Never teach them how to set up a lean transformation, and never address them as if they ran the business.

THE SHAPE OF A WEEK — one subject, five angles, never five different topics:
- Monday: meet the idea. What it is, in plain words.
- Tuesday and Wednesday: see it here, at TCK, in concrete kitchen detail.
- Thursday: why it pays — what the team personally gets out of it.
- Friday: go and find one, live. Something they DO before they clock off.

THE THREE FIELDS — this contract is not negotiable:
- whatToShowMd is the slide the ROOM sees. Short. Speaks to them. Big idea, few words.
- explanationMd and deliveryNotesMd are for the HOST only and never render on the slide. Never write "point at this" or "ask the room" inside whatToShowMd.

VIDEO: most days should have wantsVideo false. A video is for when seeing something beats being told it — usually the Monday introduction. Do not give every day a video; the team should not sit through a clip every morning.

VOICE: simple, warm, plain British English. Short sentences. No corporate jargon. No blame — waste is in the process, never the person. Always at least one concrete TCK example.

Return the week by calling the emit_week tool. Do not write anything outside the tool call.`;
}

interface GeneratedLesson {
  title: string;
  summary: string;
  explanationMd: string;
  whatToShowMd: string;
  deliveryNotesMd: string;
  wantsVideo?: boolean;
  videoRationale?: string;
}

// POST /weeks/:id/generate — write (or rewrite) this week's five lessons and
// its quiz. Always lands as a DRAFT: nothing reaches the team until it has
// been read and locked. Refuses to overwrite a locked week by accident.
const generateSchema = z.object({
  /** Extra steer for this week's lessons, in Graeme's words. */
  notes: z.string().trim().max(2000).optional(),
  /** Rewrite a week that's already locked — the editor asks first. */
  force: z.boolean().optional(),
});

router.post("/weeks/:id/generate", validate(generateSchema), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "AI is not configured (missing ANTHROPIC_API_KEY)." });
    return;
  }

  try {
    const [week] = await db.select().from(leanPrinciplesTable).where(eq(leanPrinciplesTable.id, id));
    if (!week) { res.status(404).json({ error: "Week not found" }); return; }
    const { notes, force } = req.body as z.infer<typeof generateSchema>;
    if (week.status === "locked" && force !== true) {
      res.status(409).json({ error: "This week is locked. Unlock it first if you want to rewrite it." });
      return;
    }

    const subject = week.subjectId
      ? (await db.select().from(leanSubjectsTable).where(eq(leanSubjectsTable.id, week.subjectId)))[0]
      : null;

    const focus = week.partLabel
      ? `The subject is "${week.title}". This week covers one part of it in depth: **${week.partLabel}**. Teach that part specifically — the team has already had, or will have, separate weeks on the others.`
      : `The subject is "${week.title}". This is the week that introduces the subject as a whole.`;

    const brief = [
      focus,
      subject ? `In a nutshell: ${subject.nutshell}` : "",
      week.summary ? `The intended takeaway: ${week.summary}` : "",
      notes ? `Extra direction from the founder: ${notes}` : "",
    ].filter(Boolean).join("\n\n");

    const client = getClaudeClient();
    // Streaming: five lessons plus a quiz is a long generation and a
    // non-streaming call of this size risks an HTTP timeout.
    // `thinking` is deliberately not passed: this model thinks adaptively by
    // default when the parameter is omitted, and the SDK version pinned here
    // predates the adaptive type.
    const stream = client.messages.stream({
      model: CLAUDE_MODELS.opus,
      max_tokens: 16000,
      system: weekSystemPrompt(),
      tools: [WEEK_TOOL],
      messages: [{ role: "user", content: brief }],
    });
    const response = await stream.finalMessage();

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_week",
    );
    if (!toolUse) {
      console.error("[lean-curriculum] generation returned no tool call:", response.stop_reason);
      res.status(502).json({ error: "The lesson writer didn't return a usable week. Try again." });
      return;
    }

    const generated = toolUse.input as {
      summary: string;
      lessons: GeneratedLesson[];
      quiz: Array<{ question: string; options: string[]; answer: number }>;
    };
    if (!Array.isArray(generated.lessons) || generated.lessons.length === 0) {
      res.status(502).json({ error: "The lesson writer returned no lessons. Try again." });
      return;
    }

    await db.transaction(async (tx) => {
      // Replace the week's lessons outright. Media is deliberately not
      // carried over: which days deserve a video is part of what's being
      // rewritten, and a stale clip under a new lesson is worse than none.
      await tx.delete(leanExamplesTable).where(eq(leanExamplesTable.principleId, id));
      for (let i = 0; i < generated.lessons.length; i++) {
        const lesson = generated.lessons[i]!;
        await tx.insert(leanExamplesTable).values({
          principleId: id,
          orderPosition: i + 1,
          title: lesson.title,
          summary: lesson.summary,
          explanationMd: lesson.explanationMd,
          whatToShowMd: lesson.whatToShowMd,
          deliveryNotesMd: lesson.deliveryNotesMd,
          isActive: true,
        });
      }
      await tx.update(leanPrinciplesTable)
        .set({
          summary: generated.summary || week.summary,
          quizJson: JSON.stringify(generated.quiz ?? []),
          status: "draft",
          updatedAt: new Date(),
        })
        .where(eq(leanPrinciplesTable.id, id));
      await syncMatrix(tx);
    });

    res.json({
      ok: true,
      // Which days asked for a clip, so the editor can prompt for those and
      // leave the rest alone rather than demanding five URLs.
      videoWanted: generated.lessons
        .map((l, i) => ({ day: i + 1, title: l.title, wantsVideo: !!l.wantsVideo, rationale: l.videoRationale ?? null }))
        .filter(d => d.wantsVideo),
      lessonCount: generated.lessons.length,
      quizCount: (generated.quiz ?? []).length,
    });
  } catch (err) {
    console.error("[lean-curriculum] generate failed:", err);
    res.status(500).json({ error: "Failed to write this week's lessons" });
  }
});

// GET /weeks/:id — the week with its lessons, for review before locking.
router.get("/weeks/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [week] = await db.select().from(leanPrinciplesTable).where(eq(leanPrinciplesTable.id, id));
    if (!week) { res.status(404).json({ error: "Week not found" }); return; }
    const lessons = await db.select().from(leanExamplesTable)
      .where(and(eq(leanExamplesTable.principleId, id), eq(leanExamplesTable.isActive, true)))
      .orderBy(asc(leanExamplesTable.orderPosition));
    let quiz: unknown[] = [];
    try {
      const parsed = week.quizJson ? JSON.parse(week.quizJson) : null;
      if (Array.isArray(parsed)) quiz = parsed;
    } catch { /* malformed quiz reads as none */ }
    res.json({ week, lessons, quiz });
  } catch (err) {
    console.error("[lean-curriculum] load week failed:", err);
    res.status(500).json({ error: "Failed to load the week" });
  }
});

export default router;
