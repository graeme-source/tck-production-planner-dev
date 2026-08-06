/**
 * Public survey API — what the Shopify feedback widget calls. NO auth: the
 * unguessable survey token is the access control, so this router must expose
 * nothing beyond the survey itself, and recipe objects are whitelisted to
 * { id, name, image_url } — never costs, margins or ingredients.
 *
 * Mounted in app.ts BEFORE the app-wide CORS/session/limiter stack: the app
 * CORS allowlist (planner origins) would reject the Shopify site, and the
 * widget has no session. This router carries its own CORS (Shopify origin
 * only, no credentials), its own tighter IP-keyed rate limits, and its own
 * JSON body parser.
 */
import { Router, type IRouter, json } from "express";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, surveysTable, surveyQuestionsTable, surveyResponsesTable, surveyAnswersTable, recipesTable, type SurveyQuestion } from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import * as z from "zod";
import { getRecipeImagesByName } from "../lib/recipe-images";
import { validateAnswerValue } from "../lib/survey-answers";

const router: IRouter = Router();

const SHOPIFY_ORIGIN = "https://thecalzonekitchen.co.uk";

router.use(cors({
  credentials: false,
  origin: (origin, callback) => {
    // Non-browser calls (no Origin header) pass — CORS only gates browsers.
    if (!origin) { callback(null, true); return; }
    if (origin === SHOPIFY_ORIGIN) { callback(null, true); return; }
    // Local widget development against localhost:3000.
    if (process.env["NODE_ENV"] !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
}));

// Public + unauthenticated, so key by IP (no session exists). Reads are
// cheap; submissions get a much smaller budget.
const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `survey-read:${ipKeyGenerator(req.ip ?? "")}`,
  message: { error: "Too many requests, please try again later." },
});
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `survey-submit:${ipKeyGenerator(req.ip ?? "")}`,
  message: { error: "Too many submissions, please try again later." },
});

router.use(json({ limit: "256kb" }));

async function loadSurveyByToken(rawToken: unknown) {
  const token = typeof rawToken === "string" ? rawToken : "";
  if (!token) return null;
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.token, token));
  // Drafts are indistinguishable from non-existent surveys on purpose.
  if (!survey || survey.status === "draft") return null;
  return survey;
}

async function loadQuestions(surveyId: number) {
  return db.select().from(surveyQuestionsTable)
    .where(eq(surveyQuestionsTable.surveyId, surveyId))
    .orderBy(asc(surveyQuestionsTable.position), asc(surveyQuestionsTable.id));
}

// GET /api/public/surveys/:token
router.get("/:token", readLimiter, async (req, res) => {
  try {
    const survey = await loadSurveyByToken(req.params.token);
    if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }

    const questions = await loadQuestions(survey.id);

    const recipeIds = [...new Set(questions.map(q => q.recipeId).filter((id): id is number => id != null))];
    const recipes = recipeIds.length
      ? await db.select({ id: recipesTable.id, name: recipesTable.name })
          .from(recipesTable).where(inArray(recipesTable.id, recipeIds))
      : [];
    const recipeById = new Map(recipes.map(r => [r.id, r]));
    const images = await getRecipeImagesByName([...recipeById.values()].map(r => r.name));

    res.json({
      token: survey.token,
      title: survey.title,
      intro: survey.intro,
      status: survey.status as "open" | "closed",
      questions: questions.map(q => {
        const recipe = q.recipeId != null ? recipeById.get(q.recipeId) : undefined;
        return {
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          required: q.required,
          max: q.max,
          options: Array.isArray(q.options) ? q.options : null,
          // Whitelisted field-by-field on purpose — never spread a recipe row
          // into a public payload.
          recipe: recipe
            ? { id: recipe.id, name: recipe.name, image_url: images.get(recipe.name.trim().toLowerCase()) ?? null }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error("[public-surveys] GET failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Something went wrong" });
  }
});

const submitSchema = z.object({
  client_id: z.string().trim().min(8).max(128),
  answers: z.array(z.object({
    question_id: z.number().int().positive(),
    value: z.unknown(),
  })).max(200),
});

// POST /api/public/surveys/:token/responses
router.post("/:token/responses", submitLimiter, async (req, res) => {
  try {
    const survey = await loadSurveyByToken(req.params.token);
    if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }
    if (survey.status !== "open") { res.status(409).json({ error: "This survey is closed" }); return; }

    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    const { client_id, answers } = parsed.data;

    const questions = await loadQuestions(survey.id);
    const questionById = new Map<number, SurveyQuestion>(questions.map(q => [q.id, q]));

    const errors: { question_id: number | null; error: string }[] = [];
    const seen = new Set<number>();
    for (const a of answers) {
      const q = questionById.get(a.question_id);
      if (!q) { errors.push({ question_id: a.question_id, error: "unknown question id" }); continue; }
      if (seen.has(a.question_id)) { errors.push({ question_id: a.question_id, error: "duplicate answer for question" }); continue; }
      seen.add(a.question_id);
      const valueError = validateAnswerValue(q, a.value);
      if (valueError) errors.push({ question_id: a.question_id, error: valueError });
    }
    for (const q of questions) {
      if (q.required && !seen.has(q.id)) errors.push({ question_id: q.id, error: "answer required" });
    }
    if (errors.length > 0) {
      res.status(422).json({ error: "Validation failed", details: errors });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const [response] = await tx.insert(surveyResponsesTable).values({
          surveyId: survey.id,
          clientId: client_id,
          userAgent: (req.headers["user-agent"] ?? "").slice(0, 500) || null,
        }).returning({ id: surveyResponsesTable.id });
        if (answers.length > 0) {
          await tx.insert(surveyAnswersTable).values(answers.map(a => ({
            responseId: response.id,
            questionId: a.question_id,
            value: a.value ?? null,
          })));
        }
      });
    } catch (err) {
      // Unique (survey_id, client_id) violation — this browser already
      // responded. Soft dedupe, so a friendly 409 rather than a failure.
      // Drizzle wraps the pg error, so walk the cause chain for code 23505.
      let cursor: unknown = err;
      for (let depth = 0; cursor instanceof Error && depth < 5; depth++) {
        if ((cursor as { code?: string }).code === "23505") {
          res.status(409).json({ error: "You have already responded to this survey" });
          return;
        }
        cursor = cursor.cause;
      }
      throw err;
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[public-surveys] POST failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Something went wrong" });
  }
});

export default router;
