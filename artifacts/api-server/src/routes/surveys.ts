/**
 * Admin survey management — builder, results, CSV export, QR codes.
 * Mounted behind requireAdmin in routes/index.ts; the customer-facing side
 * lives in public-surveys.ts (token access, no auth).
 */
import { Router, type IRouter } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { db, surveysTable, surveyQuestionsTable, surveyResponsesTable, surveyAnswersTable, recipesTable, SURVEY_QUESTION_TYPES, type SurveyQuestion } from "@workspace/db";
import { eq, asc, desc, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { surveyShareUrl } from "../lib/survey-config";
import { getRecipeImagesByName } from "../lib/recipe-images";
import { questionOptions } from "../lib/survey-answers";

const router: IRouter = Router();

function generateToken(): string {
  // 18 random bytes -> 24 url-safe base64 chars. The token is the public
  // API's only access control, so it comes from the CSPRNG, nothing else.
  return crypto.randomBytes(18).toString("base64url");
}

const OPTION_TYPES = ["choice", "multi", "rank"] as const;

const questionSchema = z.object({
  id: z.number().int().positive().optional(),
  type: z.enum(SURVEY_QUESTION_TYPES),
  prompt: z.string().trim().min(1, "Prompt is required").max(500),
  recipeId: z.number().int().positive().nullable().optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(30).nullable().optional(),
  required: z.boolean().optional().default(true),
  max: z.number().int().min(2).max(10).optional().default(5),
}).superRefine((q, ctx) => {
  if ((OPTION_TYPES as readonly string[]).includes(q.type)) {
    const opts = q.options ?? [];
    if (opts.length < 2) ctx.addIssue({ code: "custom", message: `${q.type} questions need at least 2 options` });
    if (new Set(opts).size !== opts.length) ctx.addIssue({ code: "custom", message: "options must be unique" });
  }
});

const surveyBodySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  intro: z.string().trim().max(2000).nullable().optional(),
  questions: z.array(questionSchema).max(100).optional().default([]),
});

const statusSchema = z.object({ status: z.enum(["draft", "open", "closed"]) });

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadQuestions(surveyId: number): Promise<SurveyQuestion[]> {
  return db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, surveyId))
    .orderBy(asc(surveyQuestionsTable.position), asc(surveyQuestionsTable.id));
}

/** Questions decorated with recipe name + image for the builder/results UI. */
async function serializeQuestions(questions: SurveyQuestion[]) {
  const recipeIds = [...new Set(questions.map(q => q.recipeId).filter((id): id is number => id != null))];
  const recipes = recipeIds.length
    ? await db.select({ id: recipesTable.id, name: recipesTable.name, category: recipesTable.category })
        .from(recipesTable).where(inArray(recipesTable.id, recipeIds))
    : [];
  const recipeById = new Map(recipes.map(r => [r.id, r]));
  const images = await getRecipeImagesByName(recipes.map(r => r.name));

  return questions.map(q => {
    const recipe = q.recipeId != null ? recipeById.get(q.recipeId) : undefined;
    return {
      id: q.id,
      position: q.position,
      type: q.type,
      prompt: q.prompt,
      recipeId: q.recipeId,
      options: Array.isArray(q.options) ? q.options : null,
      required: q.required,
      max: q.max,
      recipe: recipe
        ? { id: recipe.id, name: recipe.name, category: recipe.category, imageUrl: images.get(recipe.name.trim().toLowerCase()) ?? null }
        : null,
    };
  });
}

// GET /api/surveys — list with response counts
router.get("/", async (_req, res) => {
  const surveys = await db.select().from(surveysTable).orderBy(desc(surveysTable.createdAt));
  const counts = await db
    .select({ surveyId: surveyResponsesTable.surveyId, count: sql<number>`count(*)::int` })
    .from(surveyResponsesTable)
    .groupBy(surveyResponsesTable.surveyId);
  const questionCounts = await db
    .select({ surveyId: surveyQuestionsTable.surveyId, count: sql<number>`count(*)::int` })
    .from(surveyQuestionsTable)
    .groupBy(surveyQuestionsTable.surveyId);
  const countBySurvey = new Map(counts.map(c => [c.surveyId, c.count]));
  const questionsBySurvey = new Map(questionCounts.map(c => [c.surveyId, c.count]));

  res.json(surveys.map(s => ({
    ...s,
    responseCount: countBySurvey.get(s.id) ?? 0,
    questionCount: questionsBySurvey.get(s.id) ?? 0,
    shareUrl: surveyShareUrl(s.token),
  })));
});

// GET /api/surveys/recipe-options — recipe picker for the builder.
// Declared before /:id so "recipe-options" isn't swallowed as an id.
router.get("/recipe-options", async (_req, res) => {
  const recipes = await db
    .select({ id: recipesTable.id, name: recipesTable.name, category: recipesTable.category })
    .from(recipesTable)
    .orderBy(asc(recipesTable.category), asc(recipesTable.name));
  const images = await getRecipeImagesByName(recipes.map(r => r.name));
  res.json(recipes.map(r => ({
    id: r.id,
    name: r.name,
    category: r.category,
    imageUrl: images.get(r.name.trim().toLowerCase()) ?? null,
  })));
});

// GET /api/surveys/:id — full survey for the builder
router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }

  const questions = await serializeQuestions(await loadQuestions(id));
  const [{ count: responseCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.surveyId, id));

  res.json({ ...survey, questions, responseCount, shareUrl: surveyShareUrl(survey.token) });
});

// POST /api/surveys — create (always starts as draft)
router.post("/", async (req, res) => {
  const parsed = surveyBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
  const { title, intro, questions } = parsed.data;

  const created = await db.transaction(async (tx) => {
    const [survey] = await tx.insert(surveysTable).values({
      token: generateToken(),
      title,
      intro: intro ?? null,
      status: "draft",
    }).returning();
    if (questions.length > 0) {
      await tx.insert(surveyQuestionsTable).values(questions.map((q, i) => ({
        surveyId: survey.id,
        position: i,
        type: q.type,
        prompt: q.prompt,
        recipeId: q.recipeId ?? null,
        options: (OPTION_TYPES as readonly string[]).includes(q.type) ? (q.options ?? []) : null,
        required: q.required,
        max: q.max,
      })));
    }
    return survey;
  });

  res.status(201).json({ ...created, shareUrl: surveyShareUrl(created.token) });
});

// PUT /api/surveys/:id — update title/intro and upsert questions.
// Existing question ids are updated in place (keeping their answers); ids
// missing from the payload are deleted (their answers cascade away); new
// questions are inserted. Position comes from array order.
router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const parsed = surveyBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }

  const { title, intro, questions } = parsed.data;
  const existing = await loadQuestions(id);
  const existingIds = new Set(existing.map(q => q.id));
  const keptIds = new Set(questions.map(q => q.id).filter((qid): qid is number => qid != null));

  for (const qid of keptIds) {
    if (!existingIds.has(qid)) {
      res.status(400).json({ error: `Question ${qid} does not belong to this survey` });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(surveysTable)
      .set({ title, intro: intro ?? null, updatedAt: sql`now()` })
      .where(eq(surveysTable.id, id));

    const toDelete = existing.filter(q => !keptIds.has(q.id)).map(q => q.id);
    if (toDelete.length > 0) {
      await tx.delete(surveyQuestionsTable).where(inArray(surveyQuestionsTable.id, toDelete));
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const values = {
        position: i,
        type: q.type,
        prompt: q.prompt,
        recipeId: q.recipeId ?? null,
        options: (OPTION_TYPES as readonly string[]).includes(q.type) ? (q.options ?? []) : null,
        required: q.required,
        max: q.max,
      };
      if (q.id != null) {
        await tx.update(surveyQuestionsTable).set(values).where(eq(surveyQuestionsTable.id, q.id));
      } else {
        await tx.insert(surveyQuestionsTable).values({ surveyId: id, ...values });
      }
    }
  });

  const updatedQuestions = await serializeQuestions(await loadQuestions(id));
  const [updated] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  res.json({ ...updated, questions: updatedQuestions, shareUrl: surveyShareUrl(updated.token) });
});

// POST /api/surveys/:id/status — open/close toggle (and back to draft)
router.post("/:id/status", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }

  const [updated] = await db.update(surveysTable)
    .set({ status: parsed.data.status, updatedAt: sql`now()` })
    .where(eq(surveysTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Survey not found" }); return; }
  res.json({ ...updated, shareUrl: surveyShareUrl(updated.token) });
});

// POST /api/surveys/:id/duplicate — copy survey + questions, fresh token,
// draft status, no responses.
router.post("/:id/duplicate", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }
  const questions = await loadQuestions(id);

  const copy = await db.transaction(async (tx) => {
    const [created] = await tx.insert(surveysTable).values({
      token: generateToken(),
      title: `${survey.title} (copy)`,
      intro: survey.intro,
      status: "draft",
    }).returning();
    if (questions.length > 0) {
      await tx.insert(surveyQuestionsTable).values(questions.map(q => ({
        surveyId: created.id,
        position: q.position,
        type: q.type,
        prompt: q.prompt,
        recipeId: q.recipeId,
        options: q.options,
        required: q.required,
        max: q.max,
      })));
    }
    return created;
  });

  res.status(201).json({ ...copy, shareUrl: surveyShareUrl(copy.token) });
});

type QuestionResults =
  | { kind: "rating"; count: number; average: number | null; distribution: Record<number, number> }
  | { kind: "options"; count: number; counts: Record<string, number> }
  | { kind: "rank"; count: number; averagePosition: Record<string, number | null> }
  | { kind: "text"; count: number; answers: { value: string; submittedAt: Date | null }[] };

// GET /api/surveys/:id/results — per-question aggregates
router.get("/:id/results", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }

  const questions = await loadQuestions(id);
  const responses = await db.select().from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.surveyId, id));
  const responseById = new Map(responses.map(r => [r.id, r]));
  const answers = responses.length
    ? await db.select().from(surveyAnswersTable)
        .where(inArray(surveyAnswersTable.responseId, responses.map(r => r.id)))
    : [];
  const answersByQuestion = new Map<number, typeof answers>();
  for (const a of answers) {
    const list = answersByQuestion.get(a.questionId) ?? [];
    list.push(a);
    answersByQuestion.set(a.questionId, list);
  }

  const serialized = await serializeQuestions(questions);

  const results = serialized.map(q => {
    const raw = answersByQuestion.get(q.id) ?? [];
    const question = questions.find(x => x.id === q.id)!;
    let aggregates: QuestionResults;

    switch (q.type) {
      case "rating": {
        const values = raw.map(a => a.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        const distribution: Record<number, number> = {};
        for (let star = 1; star <= q.max; star++) distribution[star] = 0;
        for (const v of values) if (distribution[v] != null) distribution[v]++;
        aggregates = {
          kind: "rating",
          count: values.length,
          average: values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100 : null,
          distribution,
        };
        break;
      }
      case "choice":
      case "multi": {
        const counts: Record<string, number> = {};
        for (const opt of questionOptions(question)) counts[opt] = 0;
        for (const a of raw) {
          const picked = q.type === "choice"
            ? (typeof a.value === "string" ? [a.value] : [])
            : (Array.isArray(a.value) ? a.value.filter((v): v is string => typeof v === "string") : []);
          for (const p of picked) if (counts[p] != null) counts[p]++;
        }
        aggregates = { kind: "options", count: raw.length, counts };
        break;
      }
      case "rank": {
        const options = questionOptions(question);
        const positionSums: Record<string, { sum: number; n: number }> = {};
        for (const opt of options) positionSums[opt] = { sum: 0, n: 0 };
        for (const a of raw) {
          if (!Array.isArray(a.value)) continue;
          a.value.forEach((opt, idx) => {
            if (typeof opt === "string" && positionSums[opt]) {
              positionSums[opt].sum += idx + 1;
              positionSums[opt].n++;
            }
          });
        }
        const averagePosition: Record<string, number | null> = {};
        for (const opt of options) {
          const { sum, n } = positionSums[opt];
          averagePosition[opt] = n ? Math.round((sum / n) * 100) / 100 : null;
        }
        aggregates = { kind: "rank", count: raw.length, averagePosition };
        break;
      }
      default: {
        const texts = raw
          .filter(a => typeof a.value === "string" && (a.value as string).trim().length > 0)
          .map(a => ({
            value: a.value as string,
            submittedAt: responseById.get(a.responseId)?.submittedAt ?? null,
          }));
        aggregates = { kind: "text", count: texts.length, answers: texts };
      }
    }

    return { ...q, aggregates };
  });

  res.json({
    id: survey.id,
    title: survey.title,
    status: survey.status,
    shareUrl: surveyShareUrl(survey.token),
    totalResponses: responses.length,
    questions: results,
  });
});

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// GET /api/surveys/:id/export.csv — one row per response, one column per question
router.get("/:id/export.csv", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }

  const questions = await loadQuestions(id);
  const responses = await db.select().from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.surveyId, id))
    .orderBy(asc(surveyResponsesTable.submittedAt));
  const answers = responses.length
    ? await db.select().from(surveyAnswersTable)
        .where(inArray(surveyAnswersTable.responseId, responses.map(r => r.id)))
    : [];
  const byResponse = new Map<number, Map<number, unknown>>();
  for (const a of answers) {
    const m = byResponse.get(a.responseId) ?? new Map<number, unknown>();
    m.set(a.questionId, a.value);
    byResponse.set(a.responseId, m);
  }

  const header = ["response_id", "submitted_at", "client_id", ...questions.map(q => q.prompt)];
  const lines = [header.map(csvCell).join(",")];
  for (const r of responses) {
    const m = byResponse.get(r.id);
    const cells = [String(r.id), r.submittedAt?.toISOString() ?? "", r.clientId];
    for (const q of questions) {
      const v = m?.get(q.id);
      if (v == null) cells.push("");
      else if (Array.isArray(v)) cells.push(v.join("; "));
      else cells.push(String(v));
    }
    lines.push(cells.map(csvCell).join(","));
  }

  const filename = `survey-${survey.id}-responses.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\r\n") + "\r\n");
});

// GET /api/surveys/:id/qr.png — QR of the public share URL. ?download adds
// the attachment header (same pattern as routes/qr.ts).
router.get("/:id/qr.png", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }

  const buffer = await QRCode.toBuffer(surveyShareUrl(survey.token), {
    type: "png",
    width: 600,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (req.query.download !== undefined) {
    res.setHeader("Content-Disposition", `attachment; filename="survey-${survey.id}-qr.png"`);
  }
  res.send(buffer);
});

export default router;
