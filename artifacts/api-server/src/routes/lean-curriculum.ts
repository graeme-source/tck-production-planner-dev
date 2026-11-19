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
import { getWeekFocusPrinciple, mondayOf } from "./morning-meetings";
import { londonDateString } from "../lib/london-time";
import { mondaysFrom, planRunsOut, suggestNextSubject } from "../lib/lean-week-follow-on";

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
        // How many days the writer judged worth a clip — the target the
        // videos above are counted against.
        videoWantedCount: sql<number>`(
          SELECT COUNT(*) FROM ${leanExamplesTable}
          WHERE ${leanExamplesTable.principleId} = ${leanPrinciplesTable.id}
            AND ${leanExamplesTable.isActive} = TRUE
            AND ${leanExamplesTable.videoWanted} = TRUE
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
          videoWantedCount: Number(w.videoWantedCount),
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

/** Put a backlog subject into the plan as draft week(s) — the backlog's
 *  "Add" button, and the automatic fill when the plan is about to run out. */
async function addSubjectWeeks(body: z.infer<typeof addWeeksSchema>) {
    return db.transaction(async (tx) => {
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
}

router.post("/weeks", validate(addWeeksSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof addWeeksSchema>;
  try {
    const result = await addSubjectWeeks(body);

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
 * The video rule (Graeme, 2026-08-26: "We don't want it every day, maybe two
 * or three a week").
 *
 * An earlier pass gave all 45 existing lessons a clip so that no morning
 * played nothing — which turned into the team watching a video every single
 * day. A video is now something a day has to earn, and the writer picks the
 * two or three days in the week where seeing something beats being told it.
 * Its choice is stored against the lesson, so a day that was meant to have a
 * clip and hasn't got one shows up in the Friday review rather than being
 * indistinguishable from a day that deliberately has none.
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
            wantsVideo: { type: "boolean", description: "True only for the two or three days in the week where watching something teaches it better than talking about it. Never all five." },
            videoRationale: { type: "string", description: "If wantsVideo is true, one line on what the clip needs to show — this is the brief for finding it." },
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

VIDEO: pick the two or three days in the week that most benefit from one, and set wantsVideo false on the rest. A video is for when watching something teaches it better than talking about it — Monday, introducing the concept, is almost always one of them; the others are usually a day where the thing is easier to recognise once you've seen someone point at it. Never mark all five: a clip every morning stops being a treat and starts being a queue. If a subject genuinely doesn't suit video at all, one is fine.

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

/** Write (or rewrite) a week's five lessons and quiz with Claude; the week
 *  goes back to draft for review. The "Write the five lessons" button, and the
 *  automatic fill when the plan is about to run out (19 Nov 2026). */
type WriteResult =
  | { ok: true; videoWanted: Array<{ day: number; title: string; wantsVideo: boolean; rationale: string | null }>; lessonCount: number; quizCount: number }
  | { ok: false; status: number; error: string };

export async function writeWeekLessons(id: number, notes?: string, force?: boolean): Promise<WriteResult> {
  if (!isClaudeConfigured()) return { ok: false, status: 503, error: "AI is not configured (missing ANTHROPIC_API_KEY)." };

  try {
    const [week] = await db.select().from(leanPrinciplesTable).where(eq(leanPrinciplesTable.id, id));
    if (!week) return { ok: false, status: 404, error: "Week not found" };
    if (week.status === "locked" && force !== true) {
      return { ok: false, status: 409, error: "This week is locked. Unlock it first if you want to rewrite it." };
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
      return { ok: false, status: 502, error: "The lesson writer didn't return a usable week. Try again." };
    }

    const generated = toolUse.input as {
      summary: string;
      lessons: GeneratedLesson[];
      quiz: Array<{ question: string; options: string[]; answer: number }>;
    };
    if (!Array.isArray(generated.lessons) || generated.lessons.length === 0) {
      return { ok: false, status: 502, error: "The lesson writer returned no lessons. Try again." };
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
          // The recommendation is stored; the URL itself is pasted in during
          // the weekly review, so a wanted-but-missing clip stays visible.
          videoWanted: !!lesson.wantsVideo,
          videoRationale: lesson.wantsVideo ? (lesson.videoRationale ?? null) : null,
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

    return {
      ok: true,
      // Which days asked for a clip, so the editor can prompt for those and
      // leave the rest alone rather than demanding five URLs.
      videoWanted: generated.lessons
        .map((l, i) => ({ day: i + 1, title: l.title, wantsVideo: !!l.wantsVideo, rationale: l.videoRationale ?? null }))
        .filter(d => d.wantsVideo),
      lessonCount: generated.lessons.length,
      quizCount: (generated.quiz ?? []).length,
    };
  } catch (err) {
    console.error("[lean-curriculum] generate failed:", err);
    return { ok: false, status: 500, error: "Failed to write this week's lessons" };
  }
}

router.post("/weeks/:id/generate", validate(generateSchema), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { notes, force } = req.body as z.infer<typeof generateSchema>;
  const r = await writeWeekLessons(id, notes, force);
  if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
  res.json(r);
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

// ─── The schedule: one place to say what's taught when (19 Nov 2026) ─────────
//
// Graeme set the week's lesson on the Meeting page (a pin per week) while the
// plan and its draft/ready states lived here, and the two disagreed: 3S weeks
// he thought were going out were drafts, so the follow-on wrapped back to
// Seeing Waste. Now this page is the single place: "start <week> on <Monday>"
// pins that Monday, clears later pins, and the plan follows on from there,
// teaching only READY weeks. Each week is fixed on its Monday so a week can't
// change mid-week when lessons get written. When the plan would run out within
// two weeks, the next backlog subject is added and written, for him to approve.

const SCHEDULE_WEEKS = 8;

async function lessonCounts(): Promise<Map<number, number>> {
  const rows = await db.select({ principleId: leanExamplesTable.principleId, n: sql<number>`COUNT(*)::int` })
    .from(leanExamplesTable).where(eq(leanExamplesTable.isActive, true)).groupBy(leanExamplesTable.principleId);
  return new Map(rows.map(r => [r.principleId, Number(r.n)]));
}

export async function leanSchedule() {
  const thisMonday = mondayOf(londonDateString());
  const mondays = mondaysFrom(thisMonday, SCHEDULE_WEEKS);
  const weeks = await Promise.all(mondays.map(async weekStart => {
    const w = await getWeekFocusPrinciple(weekStart);
    return {
      weekStart,
      principle: w.principle ? { id: w.principle.id, title: w.principle.title, partLabel: w.principle.partLabel, ready: w.principle.status === "locked" } : null,
      /** set = fixed for that week; follows = carries on through the plan. */
      source: w.source === "override" ? "set" as const : "follows" as const,
      wrapped: w.wrapped,
    };
  }));
  const plan = await scheduledWeeks();
  const counts = await lessonCounts();
  const subjects = await db.select().from(leanSubjectsTable);
  const runsOutOn = planRunsOut(weeks);
  // A week already added but not yet approved, after the last ready one.
  const lastReady = plan.reduce((at, w, i) => (w.status === "locked" && (counts.get(w.id) ?? 0) > 0 ? i : at), -1);
  const waiting = plan.slice(lastReady + 1).find(w => w.status !== "locked") ?? null;
  const suggestion = suggestNextSubject(subjects, plan.map(w => ({ subjectId: w.subjectId, title: w.title })));
  return {
    thisMonday,
    weeks,
    runsOutOn,
    waiting: waiting ? { id: waiting.id, title: waiting.title, partLabel: waiting.partLabel, lessons: counts.get(waiting.id) ?? 0 } : null,
    suggestion: suggestion ? { id: suggestion.id, title: suggestion.title } : null,
    readyWeeks: plan.filter(w => w.status === "locked" && (counts.get(w.id) ?? 0) > 0)
      .map(w => ({ id: w.id, title: w.title, partLabel: w.partLabel, weekPosition: w.weekPosition })),
  };
}

router.get("/schedule", async (_req: Request, res: Response) => {
  try {
    res.json(await leanSchedule());
  } catch (err) {
    console.error("[lean-curriculum] schedule failed:", err);
    res.status(500).json({ error: "Couldn't work out the schedule" });
  }
});

/** Fix a week to the lesson it has now, so writing lessons mid-week can't
 *  switch it (the hourly sweep does this each Monday). */
export async function fixWeek(weekStart: string): Promise<void> {
  const [row] = await db.execute<{ principle_id: number }>(sql`SELECT principle_id FROM lean_week_focus WHERE week_start = ${weekStart}`).then(r => r.rows);
  if (row) return;
  const { principle } = await getWeekFocusPrinciple(weekStart);
  if (!principle) return;
  await db.execute(sql`INSERT INTO lean_week_focus (week_start, principle_id) VALUES (${weekStart}, ${principle.id}) ON CONFLICT (week_start) DO NOTHING`);
}

const startSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  principleId: z.number().int().positive(),
});

router.put("/schedule/start", validate(startSchema), async (req: Request, res: Response) => {
  try {
    const body = req.body as z.infer<typeof startSchema>;
    const weekStart = mondayOf(body.weekStart);
    const thisMonday = mondayOf(londonDateString());
    if (weekStart < thisMonday) { res.status(400).json({ error: "Choose this week or a week ahead" }); return; }
    const [p] = await db.select().from(leanPrinciplesTable).where(eq(leanPrinciplesTable.id, body.principleId));
    const counts = await lessonCounts();
    if (!p || p.status !== "locked" || !(counts.get(p.id) ?? 0)) {
      res.status(400).json({ error: "Only a ready week — locked in, with its lessons — can be taught" });
      return;
    }
    // Weeks before the new start keep what they have now.
    for (const m of mondaysFrom(thisMonday, 52)) { if (m >= weekStart) break; await fixWeek(m); }
    await db.execute(sql`
      INSERT INTO lean_week_focus (week_start, principle_id) VALUES (${weekStart}, ${p.id})
      ON CONFLICT (week_start) DO UPDATE SET principle_id = ${p.id}
    `);
    // Everything after follows on from here.
    await db.execute(sql`DELETE FROM lean_week_focus WHERE week_start > ${weekStart}`);
    await import("./lean-reviews").then(m => m.ensureWeeklyLeanTodosForAll())
      .catch(err => console.warn("[lean-curriculum] to-do refresh after a schedule change failed (hourly sweep will catch up):", err));
    res.json(await leanSchedule());
  } catch (err) {
    console.error("[lean-curriculum] schedule start failed:", err);
    res.status(500).json({ error: "Couldn't save the schedule" });
  }
});

let filling = false;

/**
 * When the plan would run out within two weeks and nothing is waiting, add
 * the next backlog subject as a draft week and write its lessons, then ask
 * the founder to approve it (Graeme, 19 Nov 2026). Never teaches it: a draft
 * only goes out once he locks it in. Returns what it did.
 */
export async function fillLeanPlanIfRunningOut(): Promise<{ added: string | null; reason: string }> {
  if (filling) return { added: null, reason: "already running" };
  filling = true;
  try {
    const sched = await leanSchedule();
    if (!sched.runsOutOn) return { added: null, reason: "plan ready for two weeks" };
    if (sched.waiting) return { added: null, reason: `waiting for approval: ${sched.waiting.title}` };
    if (!sched.suggestion) return { added: null, reason: "nothing left in the backlog" };
    const added = await addSubjectWeeks({ subjectId: sched.suggestion.id, weeks: 1 });
    if ("error" in added) return { added: null, reason: String(added.error) };
    const weekId = added.createdIds[0]!;
    const wrote = await writeWeekLessons(weekId);
    const title = wrote.ok
      ? `Approve the next lean week: ${sched.suggestion.title}`
      : `Write the next lean week: ${sched.suggestion.title}`;
    await import("./lean-reviews").then(async ({ FOUNDER_EMAILS }) => {
      const founders = Array.from(FOUNDER_EMAILS);
      await db.execute(sql`
        INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status)
        SELECT u.id, NULL, 'Lean learning', ${title},
               ${`The plan runs out on ${sched.runsOutOn}. ${sched.suggestion!.title} has been added as the next week${wrote.ok ? " and its five lessons written" : ""} — read it, fix anything, then lock it in on the Lean curriculum page.`},
               '/lean-curriculum', 'high', ${sched.runsOutOn}::date - 3, 'open'
        FROM app_users u
        WHERE u.is_active = TRUE AND u.email IN (${sql.join(founders.map(e => sql`${e}`), sql`, `)})
          AND NOT EXISTS (SELECT 1 FROM todo_tasks t WHERE t.assignee_id = u.id AND t.title = ${title} AND t.status = 'open')
      `);
    });
    return { added: sched.suggestion.title, reason: wrote.ok ? "added and written" : `added, writing failed: ${wrote.error}` };
  } finally {
    filling = false;
  }
}

router.post("/schedule/fill", async (_req: Request, res: Response) => {
  try {
    const r = await fillLeanPlanIfRunningOut();
    res.json({ ...r, schedule: await leanSchedule() });
  } catch (err) {
    console.error("[lean-curriculum] fill failed:", err);
    res.status(500).json({ error: "Couldn't add the next week" });
  }
});

export default router;
