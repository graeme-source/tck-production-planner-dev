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
import { getCollections, getCollectionProducts, getOrdersForPnl } from "../services/shopify";
import {
  getSurveysKlaviyoKey, setSurveysKlaviyoKey, deleteSurveysKlaviyoKey, validateSurveysKlaviyoKey,
  getOrCreateTestList, addTestRecipient, getTestListMembers,
  createEmailTemplate, createCampaignForAudience, assignTemplateToMessage, createCampaignSendJob,
  createBuyersSegment, getSegmentStatus, deleteSegment,
} from "../lib/klaviyo";
import { buildSurveyInviteHtml } from "../lib/survey-email";

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
  // Set when the survey was built from a Shopify collection — the ground
  // truth for the live email audience. The builder omits these on ordinary
  // edits, so PUT leaves them untouched.
  collectionId: z.number().int().positive().nullable().optional(),
  collectionTitle: z.string().trim().max(300).nullable().optional(),
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

// ── Klaviyo connection (survey email invites) ──────────────────────────────
// Separate key from Founder Sales on purpose: that one is read-only, this
// one ("TCK Planner 2") has list/profile/campaign/template write scopes.

// GET /api/surveys/klaviyo — connection status
router.get("/klaviyo", async (_req, res) => {
  const key = await getSurveysKlaviyoKey();
  if (!key) { res.json({ connected: false }); return; }
  res.json({ connected: true });
});

// POST /api/surveys/klaviyo — validate + store the pasted key
router.post("/klaviyo", async (req, res) => {
  const parsed = z.object({ apiKey: z.string().trim().min(10).max(200) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Paste the private API key (pk_…)" }); return; }
  try {
    const { accountName } = await validateSurveysKlaviyoKey(parsed.data.apiKey);
    await setSurveysKlaviyoKey(parsed.data.apiKey);
    res.json({ connected: true, accountName });
  } catch (err) {
    console.error("[surveys] klaviyo connect failed:", err instanceof Error ? err.message : String(err));
    res.status(422).json({ error: "Klaviyo rejected that key — check it and try again" });
  }
});

// DELETE /api/surveys/klaviyo — disconnect
router.delete("/klaviyo", async (_req, res) => {
  await deleteSurveysKlaviyoKey();
  res.json({ connected: false });
});

// ── Email invites ──────────────────────────────────────────────────────────
// Two paths: email-test targets the "TCK Survey Test Recipients" list (the
// polishing loop), email-live targets the survey's buyers segment built by
// the audience routes below. Live requires the audience to have been built
// AND the survey to be open — the server refuses otherwise.

const FROM_EMAIL_SETTING = "klaviyo_surveys_from_email";
const FROM_LABEL_SETTING = "klaviyo_surveys_from_label";

async function getFounderSetting(key: string): Promise<string | null> {
  const rows = await db.execute<{ value: string }>(sql`SELECT value FROM founder_settings WHERE key = ${key} LIMIT 1`);
  return rows.rows[0]?.value ?? null;
}

async function setFounderSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO founder_settings (key, value, updated_at) VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `);
}

// GET /api/surveys/klaviyo/test-list — ensure the test list exists, return members + send defaults
router.get("/klaviyo/test-list", async (_req, res) => {
  const key = await getSurveysKlaviyoKey();
  if (!key) { res.status(409).json({ error: "Connect Klaviyo first" }); return; }
  try {
    const listId = await getOrCreateTestList(key);
    const members = await getTestListMembers(key, listId);
    res.json({
      listId,
      members,
      defaults: {
        fromEmail: (await getFounderSetting(FROM_EMAIL_SETTING)) ?? "noreply@thecalzonekitchen.co.uk",
        fromLabel: (await getFounderSetting(FROM_LABEL_SETTING)) ?? "The Calzone Kitchen",
      },
    });
  } catch (err) {
    console.error("[surveys] test-list failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Klaviyo request failed" });
  }
});

// POST /api/surveys/klaviyo/test-list/members — add a test recipient
router.post("/klaviyo/test-list/members", async (req, res) => {
  const key = await getSurveysKlaviyoKey();
  if (!key) { res.status(409).json({ error: "Connect Klaviyo first" }); return; }
  const parsed = z.object({ email: z.string().trim().email() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a valid email address" }); return; }
  try {
    const listId = await getOrCreateTestList(key);
    await addTestRecipient(key, listId, parsed.data.email.toLowerCase());
    res.status(201).json({ members: await getTestListMembers(key, listId) });
  } catch (err) {
    console.error("[surveys] add test recipient failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Klaviyo request failed" });
  }
});

const emailTestSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  fromEmail: z.string().trim().email(),
  fromLabel: z.string().trim().min(1).max(100),
  // null/omitted = send as soon as the job fires; ISO string = scheduled.
  sendAt: z.string().datetime({ offset: true }).nullable().optional(),
  // true = create the campaign in Klaviyo but do NOT create a send job —
  // lets Graeme inspect it in Klaviyo before anything is dispatched.
  draft: z.boolean().optional().default(false),
});

// POST /api/surveys/:id/email-test — build the [TEST] campaign for this survey
router.post("/:id/email-test", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const key = await getSurveysKlaviyoKey();
  if (!key) { res.status(409).json({ error: "Connect Klaviyo first" }); return; }
  const parsed = emailTestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }

  const { subject, fromEmail, fromLabel, sendAt, draft } = parsed.data;
  try {
    const listId = await getOrCreateTestList(key);
    const members = await getTestListMembers(key, listId);
    if (members.length === 0) {
      res.status(422).json({ error: "The test list is empty — add yourself first" });
      return;
    }

    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const html = buildSurveyInviteHtml({ title: survey.title, intro: survey.intro, shareUrl: surveyShareUrl(survey.token) });
    const templateId = await createEmailTemplate(key, `[TEST] ${survey.title} invite ${stamp}`, html);
    const { campaignId, messageId } = await createCampaignForAudience(key, {
      name: `[TEST] ${survey.title} invite ${stamp}`,
      audienceId: listId,
      subject,
      previewText: "A minute of feedback shapes what we launch next",
      fromEmail,
      fromLabel,
      sendAt: sendAt ?? null,
      // The same inboxes get mailed repeatedly while polishing — never smart.
      smartSending: false,
    });
    await assignTemplateToMessage(key, messageId, templateId);
    if (!draft) await createCampaignSendJob(key, campaignId);

    await setFounderSetting(FROM_EMAIL_SETTING, fromEmail);
    await setFounderSetting(FROM_LABEL_SETTING, fromLabel);

    res.status(201).json({
      campaignId,
      campaignUrl: `https://www.klaviyo.com/campaign/${campaignId}/wizard`,
      recipients: members.length,
      mode: draft ? "draft" : (sendAt ? "scheduled" : "sending"),
    });
  } catch (err) {
    console.error("[surveys] email-test failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Klaviyo request failed — check the server log" });
  }
});

// GET /api/surveys/collections — Shopify collections for the template picker
router.get("/collections", async (_req, res) => {
  try {
    res.json(await getCollections());
  } catch (err) {
    console.error("[surveys] collections failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Could not load collections from Shopify" });
  }
});

// Date tag on orders — this IS the delivery day (Graeme, 2026-08-06), not a
// dispatch day to add a transit day to. (The fulfilment code calls these
// "dispatch tags", but the tagged date is when the customer receives.)
const DATE_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "the {name}" without doubling the article for names like "The Benji". */
function withArticle(name: string): string {
  return /^the\s/i.test(name.trim()) ? name.trim() : `the ${name.trim()}`;
}

/**
 * Orders in the look-back window containing any of the given products —
 * matched by Shopify product id, cancelled orders excluded — plus the
 * delivery-date tags seen on them. Shared by the template builder and the
 * live-audience cross-check so both quote the same ground-truth number.
 */
async function collectionOrderStats(productIds: Set<number>, days: number): Promise<{ matchingOrders: number; dispatchTags: Set<string> }> {
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const orders = await getOrdersForPnl(iso(from), iso(now));
  const dispatchTags = new Set<string>();
  let matchingOrders = 0;
  for (const order of orders) {
    if (order.cancelled_at) continue;
    if (!order.line_items?.some(li => li.product_id != null && productIds.has(li.product_id))) continue;
    matchingOrders++;
    const tag = order.tags.split(",").map(t => t.trim()).find(t => DATE_TAG_RE.test(t));
    if (tag) dispatchTags.add(tag);
  }
  return { matchingOrders, dispatchTags };
}

function formatDeliveryDate(dateTag: string): string {
  const d = new Date(`${dateTag}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(d);
}

// GET /api/surveys/collection-template?collectionId=&days=
// Builds (but does NOT save) the default test-box survey for a collection:
//   1. "What delivery date did you receive your products?" — choice, options
//      auto-captured from date-tagged orders containing the collection's
//      products in the look-back window (+ "Not sure").
//   2. Per product: overall rating + optional notes, linked to the matching
//      recipe by name where one exists (brings the image along).
//   3. One overall-experience free-text at the end.
// The builder opens pre-filled with this; Graeme edits and saves as usual.
router.get("/collection-template", async (req, res) => {
  const collectionId = Number(req.query.collectionId);
  if (!Number.isInteger(collectionId) || collectionId <= 0) {
    res.status(400).json({ error: "collectionId is required" });
    return;
  }
  const rawDays = Number(req.query.days);
  const days = Number.isInteger(rawDays) ? Math.min(90, Math.max(1, rawDays)) : 30;

  try {
    const [collections, products] = await Promise.all([getCollections(), getCollectionProducts(collectionId)]);
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) { res.status(404).json({ error: "Collection not found" }); return; }
    if (products.length === 0) { res.status(422).json({ error: "That collection has no products" }); return; }

    // Recipe links by exact name match (same rule as the images).
    const recipes = await db.select({ id: recipesTable.id, name: recipesTable.name }).from(recipesTable);
    const recipeByName = new Map(recipes.map(r => [r.name.trim().toLowerCase(), r.id]));

    // Delivery dates from date-tagged orders containing these products.
    const { matchingOrders, dispatchTags } = await collectionOrderStats(new Set(products.map(p => p.id)), days);
    const deliveryDates = [...dispatchTags].sort().map(formatDeliveryDate);

    const questions: Array<{ type: string; prompt: string; recipeId: number | null; options: string[] | null; required: boolean; max: number }> = [];
    if (deliveryDates.length > 0) {
      questions.push({
        type: "choice",
        prompt: "What delivery date did you receive your products?",
        recipeId: null,
        options: deliveryDates,
        required: true,
        max: 5,
      });
    }
    for (const product of products) {
      const recipeId = recipeByName.get(product.title.trim().toLowerCase()) ?? null;
      // Approval slider by default (Graeme, 2026-08-06) — stars stay
      // available in the builder for anyone who swaps the type by hand.
      questions.push({
        type: "slider",
        prompt: `Overall, how likely are you to approve ${withArticle(product.title)} for the menu?`,
        recipeId, options: null, required: true, max: 5,
      });
      questions.push({
        type: "text",
        prompt: `Add any notes on ${withArticle(product.title)} (optional)`,
        recipeId, options: null, required: false, max: 5,
      });
    }
    questions.push({
      type: "text",
      prompt: "Any overall general feedback on this test box experience?",
      recipeId: null, options: null, required: false, max: 5,
    });

    res.json({
      collection,
      title: `${collection.title} Feedback`,
      intro: `You tried the ${collection.title} — tell us what you thought! It takes about a minute and directly shapes what we launch next.`,
      questions,
      deliveryDates,
      matchingOrders,
      lookbackDays: days,
      unmatchedProducts: products.filter(p => !recipeByName.has(p.title.trim().toLowerCase())).map(p => p.title),
    });
  } catch (err) {
    console.error("[surveys] collection-template failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Could not build the template from Shopify" });
  }
});

// ── Live audience (Klaviyo buyers segment) ─────────────────────────────────
// The audience is a Klaviyo segment of profiles who placed an order
// containing any of the source collection's products in the look-back
// window. Built once per survey and reused on re-sends; "rebuild" replaces
// it (e.g. after the collection's products or the window changed). The
// email dialog shows the segment's profile count next to matchingOrders —
// the app's own Shopify count over the same window — as the sanity check
// before anything sends.

interface AudiencePayload {
  collection: { id: number; title: string } | null;
  lookbackDays: number;
  products: string[];
  matchingOrders: number;
  segment: { id: string; name: string | null; profileCount: number | null } | null;
}

async function buildAudiencePayload(
  survey: { collectionId: number | null; collectionTitle: string | null; klaviyoSegmentId: string | null },
  key: string | null,
  days: number,
): Promise<AudiencePayload> {
  if (survey.collectionId == null) {
    return { collection: null, lookbackDays: days, products: [], matchingOrders: 0, segment: null };
  }
  const products = await getCollectionProducts(survey.collectionId);
  const { matchingOrders } = await collectionOrderStats(new Set(products.map(p => p.id)), days);
  let segment: AudiencePayload["segment"] = null;
  if (survey.klaviyoSegmentId && key) {
    const status = await getSegmentStatus(key, survey.klaviyoSegmentId);
    segment = status.exists
      ? { id: survey.klaviyoSegmentId, name: status.name, profileCount: status.profileCount }
      : null;
  }
  return {
    collection: { id: survey.collectionId, title: survey.collectionTitle ?? "" },
    lookbackDays: days,
    products: products.map(p => p.title),
    matchingOrders,
    segment,
  };
}

// GET /api/surveys/:id/audience?days= — current audience state (no writes)
router.get("/:id/audience", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }
  const rawDays = Number(req.query.days);
  const days = Number.isInteger(rawDays) ? Math.min(90, Math.max(1, rawDays)) : 30;
  try {
    res.json(await buildAudiencePayload(survey, await getSurveysKlaviyoKey(), days));
  } catch (err) {
    console.error("[surveys] audience status failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Couldn't load the audience — check the server log" });
  }
});

const audienceBuildSchema = z.object({
  // Optional for surveys built from a collection (it's stored); required the
  // first time for hand-built surveys.
  collectionId: z.number().int().positive().optional(),
  days: z.number().int().min(1).max(90).optional().default(30),
  rebuild: z.boolean().optional().default(false),
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// POST /api/surveys/:id/audience — create (or reuse/rebuild) the segment
router.post("/:id/audience", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const key = await getSurveysKlaviyoKey();
  if (!key) { res.status(409).json({ error: "Connect Klaviyo first" }); return; }
  const parsed = audienceBuildSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }

  const { days, rebuild } = parsed.data;
  const collectionId = parsed.data.collectionId ?? survey.collectionId;
  if (collectionId == null) {
    res.status(422).json({ error: "Pick the Shopify collection this survey is about first" });
    return;
  }

  try {
    const [collections, products] = await Promise.all([getCollections(), getCollectionProducts(collectionId)]);
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) { res.status(404).json({ error: "Collection not found" }); return; }
    if (products.length === 0) { res.status(422).json({ error: "That collection has no products" }); return; }

    await db.update(surveysTable)
      .set({ collectionId, collectionTitle: collection.title, updatedAt: sql`now()` })
      .where(eq(surveysTable.id, id));

    // Reuse the stored segment unless rebuilding (or it vanished in Klaviyo).
    let segmentId = survey.klaviyoSegmentId;
    if (segmentId && !rebuild) {
      const status = await getSegmentStatus(key, segmentId);
      if (!status.exists) segmentId = null;
    } else if (segmentId && rebuild) {
      await deleteSegment(key, segmentId);
      segmentId = null;
    }
    if (!segmentId) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      segmentId = await createBuyersSegment(key, {
        name: `Survey: ${collection.title} buyers, last ${days}d (${stamp})`,
        productNames: products.map(p => p.title),
        lookbackDays: days,
      });
      await db.update(surveysTable).set({ klaviyoSegmentId: segmentId }).where(eq(surveysTable.id, id));
    }

    // A fresh segment materialises asynchronously — give the count a few
    // seconds to appear so the dialog usually shows it first time. The UI
    // refetches if it's still null.
    let status = await getSegmentStatus(key, segmentId);
    for (let attempt = 0; status.profileCount == null && attempt < 3; attempt++) {
      await sleep(1500);
      status = await getSegmentStatus(key, segmentId);
    }

    const { matchingOrders } = await collectionOrderStats(new Set(products.map(p => p.id)), days);
    const payload: AudiencePayload = {
      collection: { id: collectionId, title: collection.title },
      lookbackDays: days,
      products: products.map(p => p.title),
      matchingOrders,
      segment: { id: segmentId, name: status.name, profileCount: status.profileCount },
    };
    res.status(201).json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[surveys] audience build failed:", msg);
    if (msg.includes("Klaviyo 403")) {
      res.status(403).json({ error: "The Klaviyo key can't manage segments — add segments:read, segments:write and metrics:read scopes to the TCK Planner 2 key, then reconnect" });
      return;
    }
    res.status(502).json({ error: "Couldn't build the audience — check the server log" });
  }
});

// POST /api/surveys/:id/email-live — the real send, to the buyers segment.
// Same body as email-test. Refuses until the audience exists and the survey
// is open (the email links straight to it; draft surveys 404 publicly).
router.post("/:id/email-live", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) { res.status(400).json({ error: "Invalid survey id" }); return; }
  const key = await getSurveysKlaviyoKey();
  if (!key) { res.status(409).json({ error: "Connect Klaviyo first" }); return; }
  const parsed = emailTestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
  const [survey] = await db.select().from(surveysTable).where(eq(surveysTable.id, id));
  if (!survey) { res.status(404).json({ error: "Survey not found" }); return; }
  if (!survey.klaviyoSegmentId) { res.status(409).json({ error: "Build the live audience first" }); return; }
  if (survey.status !== "open") {
    res.status(409).json({ error: "Open the survey first — the email links to it, and customers would hit a dead page" });
    return;
  }

  const { subject, fromEmail, fromLabel, sendAt, draft } = parsed.data;
  try {
    const segment = await getSegmentStatus(key, survey.klaviyoSegmentId);
    if (!segment.exists) {
      res.status(409).json({ error: "The audience segment no longer exists in Klaviyo — rebuild it" });
      return;
    }

    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const html = buildSurveyInviteHtml({ title: survey.title, intro: survey.intro, shareUrl: surveyShareUrl(survey.token) });
    const templateId = await createEmailTemplate(key, `[LIVE] ${survey.title} invite ${stamp}`, html);
    const { campaignId, messageId } = await createCampaignForAudience(key, {
      name: `[LIVE] ${survey.title} invite ${stamp}`,
      audienceId: survey.klaviyoSegmentId,
      subject,
      previewText: "A minute of feedback shapes what we launch next",
      fromEmail,
      fromLabel,
      sendAt: sendAt ?? null,
      // Real customers: let Klaviyo hold back anyone emailed very recently.
      smartSending: true,
    });
    await assignTemplateToMessage(key, messageId, templateId);
    if (!draft) await createCampaignSendJob(key, campaignId);

    await setFounderSetting(FROM_EMAIL_SETTING, fromEmail);
    await setFounderSetting(FROM_LABEL_SETTING, fromLabel);

    res.status(201).json({
      campaignId,
      campaignUrl: `https://www.klaviyo.com/campaign/${campaignId}/wizard`,
      recipients: segment.profileCount ?? 0,
      mode: draft ? "draft" : (sendAt ? "scheduled" : "sending"),
    });
  } catch (err) {
    console.error("[surveys] email-live failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Klaviyo request failed — check the server log" });
  }
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
      collectionId: parsed.data.collectionId ?? null,
      collectionTitle: parsed.data.collectionTitle ?? null,
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
      // The copy is about the same products, so the collection travels — but
      // NOT the segment: each survey owns its segment, and a shared one
      // would be deleted out from under the other on rebuild.
      collectionId: survey.collectionId,
      collectionTitle: survey.collectionTitle,
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
  | { kind: "slider"; count: number; average: number | null }
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
  const allResponses = await db.select().from(surveyResponsesTable)
    .where(eq(surveyResponsesTable.surveyId, id));
  const allAnswers = allResponses.length
    ? await db.select().from(surveyAnswersTable)
        .where(inArray(surveyAnswersTable.responseId, allResponses.map(r => r.id)))
    : [];

  // Optional filter: only responses whose answer to one question equals a
  // value (e.g. delivery date = "Thursday 7 August 2026"). String compare —
  // built for choice questions, where values are option strings.
  const filterQuestionId = Number(req.query.filterQuestionId);
  const filterValue = typeof req.query.filterValue === "string" ? req.query.filterValue : null;
  let responses = allResponses;
  let answers = allAnswers;
  if (Number.isInteger(filterQuestionId) && filterQuestionId > 0 && filterValue != null) {
    const passing = new Set(
      allAnswers
        .filter(a => a.questionId === filterQuestionId && typeof a.value === "string" && a.value === filterValue)
        .map(a => a.responseId),
    );
    responses = allResponses.filter(r => passing.has(r.id));
    answers = allAnswers.filter(a => passing.has(a.responseId));
  }
  const responseById = new Map(responses.map(r => [r.id, r]));
  const answersByQuestion = new Map<number, typeof answers>();
  for (const a of answers) {
    const list = answersByQuestion.get(a.questionId) ?? [];
    list.push(a);
    answersByQuestion.set(a.questionId, list);
  }

  // Explicit "didn't try" skips per question, counted over the (possibly
  // filtered) response set. Skips have no answer rows, so the aggregates
  // below exclude them from averages/percentages by construction.
  const skipCounts = new Map<number, number>();
  for (const r of responses) {
    if (!Array.isArray(r.skipped)) continue;
    for (const qid of r.skipped) {
      if (typeof qid === "number") skipCounts.set(qid, (skipCounts.get(qid) ?? 0) + 1);
    }
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
      case "slider": {
        const values = raw.map(a => a.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        aggregates = {
          kind: "slider",
          count: values.length,
          average: values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null,
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

    return { ...q, aggregates, skippedCount: skipCounts.get(q.id) ?? 0 };
  });

  res.json({
    id: survey.id,
    title: survey.title,
    status: survey.status,
    shareUrl: surveyShareUrl(survey.token),
    totalResponses: responses.length,
    unfilteredResponses: allResponses.length,
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
    const skippedSet = new Set(Array.isArray(r.skipped) ? r.skipped : []);
    const cells = [String(r.id), r.submittedAt?.toISOString() ?? "", r.clientId];
    for (const q of questions) {
      if (skippedSet.has(q.id)) { cells.push("(didn't try)"); continue; }
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
