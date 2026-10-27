/**
 * Product labels, Stage 1 — /api/product-labels. Objectives A, D and F.
 *
 *   GET  /template                    the label design + legal minimums
 *   PUT  /template                    save it (manager/admin; autosaved)
 *   POST /template/preview            render a recipe with an UNSAVED design
 *   POST /template/cooking-tiers      every calzone's weight, meat and tier under
 *                                     a (possibly unsaved) design's cooking tiers
 *   GET  /recipes                     every recipe's label status
 *   GET  /recipes/:id                 live + current proof, status, changes
 *   PUT  /recipes/:id/settings        label name, overrides (manager/admin; autosaved) —
 *                                     the barcode is set on the recipe page (routes/barcodes.ts)
 *   POST /recipes/:id/publish         "I've checked it — update live"
 *
 * The live (published) label is a frozen snapshot; recipe edits never touch
 * it. The current label is rebuilt from the recipe on every read and
 * compared by hash. Publishing re-checks everything on the server: the
 * snapshot must be the one the person looked at (expectedHash), it must fit,
 * and nothing may block it — then a person confirms. Nothing here prints.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, pool, recipesTable, usersTable, productLabelTemplatesTable, productLabelSettingsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  resolveBonesWarning, describeCookingTimes, effectiveCookingMode, halveRange, normaliseCookingTiers, resolveCooking,
  DEFAULT_RECIPE_LABEL_SETTINGS, type CookingValues,
  decideStatus, enforceLegalMinimums, legalMinimums, normaliseTemplate, publishBlockers,
  STATUS_LABEL, TEMPLATE_PRESETS, WIDTH_ORDER, type LabelSnapshot, type LabelTemplate,
} from "@workspace/product-labels";
import { encodePng } from "@workspace/product-labels/render";
import { requireManagerOrAdmin } from "../middleware/roles";
import { loadPackBarcodes } from "../lib/barcode-store";
import { loadCookingData, recipeCookingSuggestion } from "../lib/label-cooking-profile";
import { rawBody, validate } from "../middleware/validate";
import {
  buildCurrentLabel, changesSinceLive, checkFit, deckBlockers, deckWarnings, fitSummary, fonts, loadAllLiveVersions,
  loadLiveVersion, loadRecipe, loadTemplate, loadTemplateDefaults, renderProof, sampleDates, type CurrentLabel, type LoadedTemplate,
} from "../lib/product-labels-store";

const router: IRouter = Router();

const IdParams = z.object({ id: z.coerce.number().int().positive() });

async function userName(req: Request): Promise<{ id: number | null; name: string | null }> {
  const id = req.session.userId ?? null;
  if (!id) return { id: null, name: null };
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? null };
}

function fail(res: Response, err: unknown, where: string) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[product-labels] ${where}:`, err);
  res.status(500).json({ error: msg });
}

/** Proof payload: the PNG plus the boxes the page draws over it. */
function proofPayload(proof: ReturnType<typeof renderProof>) {
  const { layout } = proof;
  return {
    png: proof.png,
    overflowPng: proof.overflowPng,
    widthDots: layout.widthDots,
    heightDots: layout.heightDots,
    dpi: layout.dpi,
    fits: layout.fits,
    fitProblems: layout.problems,
    contentProblems: proof.content.problems,
    fields: layout.fields.map(f => ({
      key: f.key, boxes: f.boxes, sizePt: f.sizePt, width: f.width, minPt: f.minPt, legalMinPt: f.legalMinPt,
      xHeightMm: Math.round(f.xHeightMm * 100) / 100, lines: f.lines, usedHeight: f.usedHeight, fits: f.fits,
    })),
    columns: layout.columns,
    barcode: { box: layout.barcode.box, module: layout.barcode.module },
    dates: proof.dates,
  };
}

function templatePayload(t: LoadedTemplate) {
  const m = fonts();
  return {
    id: t.id,
    name: t.name,
    version: t.version,
    updatedAt: t.updatedAt,
    updatedByName: t.updatedByName,
    template: t.template,
    legalMinimums: legalMinimums(t.template, m),
    xHeights: Object.fromEntries(WIDTH_ORDER.map(w => [w, m.metrics({ width: w, weight: 400 }).xHeight])),
  };
}

// ── Template ───────────────────────────────────────────────────────────────

// ?id=N reads that template; no id = the standard one (lowest id).
const TemplateQuery = z.object({ id: z.coerce.number().int().positive().optional() });

router.get("/template", async (req, res) => {
  const q = TemplateQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid template id" }); return; }
  try {
    res.json(templatePayload(await loadTemplate(q.data.id ?? null)));
  } catch (err) { fail(res, err, "GET /template"); }
});

// ── Several templates (2026-10-12: fried chicken gets its own) ─────────────
// Every label template, and the starting designs (presets) that can be added
// as a new one. A recipe picks its template in its label settings; with
// none picked it uses the template set as the default for its category
// (defaultForCategories, template-choice.ts), else the standard one (lowest id).

async function listTemplates() {
  const rows = await db.select({
    id: productLabelTemplatesTable.id, name: productLabelTemplatesTable.name,
    version: productLabelTemplatesTable.version, updatedAt: productLabelTemplatesTable.updatedAt,
  }).from(productLabelTemplatesTable).orderBy(productLabelTemplatesTable.id);
  if (rows.length === 0) { await loadTemplate(); return listTemplates(); } // creates the standard one
  const names = new Set(rows.map(r => r.name.trim().toLowerCase()));
  return {
    templates: rows.map((r, i) => ({ ...r, isDefault: i === 0 })),
    presets: TEMPLATE_PRESETS.map(p => ({ key: p.key, name: p.name, description: p.description, added: names.has(p.name.toLowerCase()) })),
  };
}

router.get("/templates", async (_req, res) => {
  try {
    res.json(await listTemplates());
  } catch (err) { fail(res, err, "GET /templates"); }
});

const AddTemplateBody = z.object({ preset: z.string().min(1).max(60) });

router.post("/templates", requireManagerOrAdmin, validate(AddTemplateBody), async (req, res) => {
  const body = req.body as z.infer<typeof AddTemplateBody>;
  const preset = TEMPLATE_PRESETS.find(p => p.key === body.preset);
  if (!preset) { res.status(400).json({ error: "Unknown starting design" }); return; }
  try {
    const existing = await listTemplates();
    const same = existing.templates.find(t => t.name.trim().toLowerCase() === preset.name.toLowerCase());
    if (same) { res.status(409).json({ error: `There is already a “${preset.name}” template.`, id: same.id }); return; }
    const who = await userName(req);
    const { template } = enforceLegalMinimums(preset.build(), fonts());
    const [row] = await db.insert(productLabelTemplatesTable)
      .values({ name: preset.name, settings: template, updatedAt: new Date(), updatedById: who.id, updatedByName: who.name })
      .returning({ id: productLabelTemplatesTable.id });
    res.json(templatePayload(await loadTemplate(row.id)));
  } catch (err) { fail(res, err, "POST /templates"); }
});

const TemplateBody = z.object({
  id: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  // Checked and clamped field by field by normaliseTemplate (nested values
  // are read from rawBody so nothing is stripped).
  settings: z.record(z.string(), z.unknown()),
});

router.put("/template", requireManagerOrAdmin, validate(TemplateBody), async (req, res) => {
  const body = req.body as z.infer<typeof TemplateBody>;
  const settings = rawBody<{ settings: unknown }>(req).settings;
  try {
    const { template, raised } = enforceLegalMinimums(normaliseTemplate(settings), fonts());
    const who = await userName(req);
    const updated = await db.update(productLabelTemplatesTable)
      .set({ settings: template, version: sql`${productLabelTemplatesTable.version} + 1`, updatedAt: new Date(), updatedById: who.id, updatedByName: who.name })
      .where(and(eq(productLabelTemplatesTable.id, body.id), eq(productLabelTemplatesTable.version, body.expectedVersion)))
      .returning({ id: productLabelTemplatesTable.id });
    if (updated.length === 0) {
      res.status(409).json({ error: "Someone else changed the label template since you opened it — reload to see their changes.", current: templatePayload(await loadTemplate(body.id)) });
      return;
    }
    res.json({ ...templatePayload(await loadTemplate(body.id)), raised });
  } catch (err) { fail(res, err, "PUT /template"); }
});

const PreviewBody = z.object({
  recipeId: z.number().int().positive(),
  settings: z.record(z.string(), z.unknown()),
});

router.post("/template/preview", requireManagerOrAdmin, validate(PreviewBody), async (req, res) => {
  const body = req.body as z.infer<typeof PreviewBody>;
  try {
    const recipe = await loadRecipe(body.recipeId);
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
    const { template } = enforceLegalMinimums(normaliseTemplate(rawBody<{ settings: unknown }>(req).settings), fonts());
    const current = await buildCurrentLabel(recipe, { templateOverride: template });
    res.json({ recipeId: recipe.id, recipeName: recipe.name, sample: sampleDates(), proof: proofPayload(renderProof(current.snapshot)) });
  } catch (err) { fail(res, err, "POST /template/preview"); }
});

// Every calzone's tier under a design's cooking tiers — the design page's
// "where each recipe lands" table, so the tiers can be checked before they're
// switched on. Read-only; the settings are the unsaved draft.
const CookingTiersBody = z.object({ settings: z.record(z.string(), z.unknown()) });

router.post("/template/cooking-tiers", requireManagerOrAdmin, validate(CookingTiersBody), async (req, res) => {
  try {
    const template = normaliseTemplate(rawBody<{ settings: unknown }>(req).settings);
    const data = await loadCookingData();
    const recipes = await db.select({ id: recipesTable.id, name: recipesTable.name, category: recipesTable.category, archivedAt: recipesTable.archivedAt, isDraft: recipesTable.isDraft })
      .from(recipesTable).orderBy(recipesTable.name);
    const out = [];
    for (const r of recipes) {
      if (r.archivedAt) continue;
      const { profile, suggestion } = recipeCookingSuggestion(data, r.id, template.cookingTiers);
      if (!suggestion) continue; // no dough — not a calzone
      const cooking = printedSuggestion(template, suggestion.cooking);
      out.push({ recipeId: r.id, name: r.name, category: r.category, isDraft: r.isDraft, profile, tierKey: suggestion.tierKey, tierName: suggestion.tierName, reason: suggestion.reason, cooking, halves: halves(cooking) });
    }
    res.json({ recipes: out });
  } catch (err) { fail(res, err, "POST /template/cooking-tiers"); }
});

/** The times a suggestion would print with this design (blank tier values
 *  = the design's standard ones, capped), whether or not the tiers are on. */
function printedSuggestion(template: LabelTemplate, suggestion: CookingValues, settings = DEFAULT_RECIPE_LABEL_SETTINGS): CookingValues {
  return resolveCooking({ ...template, cookingTiers: { ...template.cookingTiers, on: true } }, { ...settings, cookingMode: "suggested" }, suggestion);
}

function halves(c: CookingValues) {
  return { oven: halveRange(c.ovenMinMinutes, c.ovenMaxMinutes), airFryer: halveRange(c.airFryerMinMinutes, c.airFryerMaxMinutes) };
}

/** The recipe page's "Cooking times" panel: the mode in force, the tier,
 *  why, and the times the suggestion would print (both appliances — the page
 *  blanks one that's switched off, as the label does). */
function cookingPayload(current: CurrentLabel) {
  const t = current.template.template;
  const { profile, suggestion } = current.cooking;
  const cooking = suggestion ? printedSuggestion(t, suggestion.cooking) : null;
  return {
    mode: effectiveCookingMode(current.settings),
    modeChosen: current.settings.cookingMode ?? null,
    tiersOn: t.cookingTiers.on,
    maxOvenMinutes: t.cookingTiers.maxOvenMinutes,
    maxAirFryerMinutes: t.cookingTiers.maxAirFryerMinutes,
    profile,
    suggestion: suggestion && cooking ? {
      tierKey: suggestion.tierKey, tierName: suggestion.tierName,
      reason: `${suggestion.reason} → ${describeCookingTimes(cooking)}`,
      cooking, halves: halves(cooking),
    } : null,
  };
}

// ── Recipe list ────────────────────────────────────────────────────────────

router.get("/recipes", async (_req, res) => {
  try {
    const recipes = await db.select().from(recipesTable).orderBy(recipesTable.name);
    const live = await loadAllLiveVersions();
    const templateCache = new Map<number | "default", LoadedTemplate>();
    const templateDefaults = await loadTemplateDefaults();
    const packBarcodes = await loadPackBarcodes();
    const cookingData = await loadCookingData();
    const out = [];
    for (const r of recipes) {
      if (r.archivedAt && !live.has(r.id)) continue;
      const current = await buildCurrentLabel(r, { templateCache, templateDefaults, packBarcodes, cookingData });
      const lv = live.get(r.id);
      const checked = checkFit(current.snapshot);
      const status = decideStatus({
        isDraft: r.isDraft, archived: r.archivedAt != null, hasLive: !!lv,
        matchesLive: !!lv && lv.snapshotHash === current.hash, currentFits: checked.layout.fits,
      });
      const blockers = publishBlockers({
        archived: r.archivedAt != null, fits: checked.layout.fits, fitProblems: checked.layout.problems.map(p => p.message),
        contentProblems: checked.content.problems, deckBlockers: deckBlockers(current.deck),
      });
      out.push({
        recipeId: r.id,
        name: r.name,
        category: r.category,
        status,
        statusLabel: STATUS_LABEL[status],
        liveVersion: lv ? { versionNo: lv.versionNo, publishedAt: lv.publishedAt, publishedByName: lv.publishedByName } : null,
        changes: lv && lv.snapshotHash !== current.hash ? changesSinceLive(lv, current.snapshot).map(c => c.label) : [],
        blockers,
        barcode: current.snapshot.barcode,
      });
    }
    res.json({ recipes: out });
  } catch (err) { fail(res, err, "GET /recipes"); }
});

// ── One recipe ─────────────────────────────────────────────────────────────

router.get("/recipes/:id", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  try {
    const recipe = await loadRecipe(p.data.id);
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
    const current = await buildCurrentLabel(recipe);
    const lv = await loadLiveVersion(recipe.id);
    const currentProof = renderProof(current.snapshot);
    const liveProof = lv ? renderProof(lv.snapshot as LabelSnapshot) : null;
    const matchesLive = !!lv && lv.snapshotHash === current.hash;
    const status = decideStatus({
      isDraft: recipe.isDraft, archived: recipe.archivedAt != null, hasLive: !!lv, matchesLive, currentFits: currentProof.layout.fits,
    });
    const blockers = publishBlockers({
      archived: recipe.archivedAt != null, fits: currentProof.layout.fits, fitProblems: currentProof.layout.problems.map(x => x.message),
      contentProblems: currentProof.content.problems, deckBlockers: deckBlockers(current.deck),
    });
    res.json({
      recipe: {
        id: recipe.id, name: recipe.name, packSize: current.snapshot.packSize, shelfLifeDays: recipe.shelfLifeDays,
        isDraft: recipe.isDraft, archived: recipe.archivedAt != null,
        // The FACTORY oven setting (part-bake) — shown for reference only, never printed.
        factoryOvenTempC: recipe.ovenTempC, factoryOvenTimeSeconds: recipe.ovenTimeSeconds,
      },
      settings: current.settings,
      // Suggested (by weight) vs Manual, the tier and why (cooking-tiers.ts).
      cookingTimes: cookingPayload(current),
      // What Automatic finds, and what prints — the page shows "On — contains
      // chicken (Chicken Thigh)" or "Off — no chicken found".
      bonesWarning: resolveBonesWarning(current.settings.warningOn, current.deck.deckText, current.template.template.boneRiskWords),
      boneRiskWords: current.template.template.boneRiskWords,
      settingsUpdatedAt: current.settingsRow?.updatedAt ?? null,
      settingsUpdatedByName: current.settingsRow?.updatedByName ?? null,
      // The template this recipe picked; null = Automatic: the default for
      // its category (templateAutomatic), else the standard one.
      templateChoice: current.settingsRow?.templateId ?? null,
      templateAutomatic: current.automaticTemplate,
      template: { id: current.template.id, name: current.template.name, version: current.template.version, cooking: current.template.template.cooking, chilledDefault: current.template.template.chilledDefault, frozenDefault: current.template.template.frozenDefault, netQuantityOn: current.template.template.netQuantity.on },
      status,
      statusLabel: STATUS_LABEL[status],
      matchesLive,
      changes: matchesLive ? [] : changesSinceLive(lv, current.snapshot),
      blockers,
      // The deck lines of `blockers`, and the ingredient behind each, so the
      // page can make every named ingredient a button that opens its edit
      // dialog (2026-10-12).
      deckBlockers: deckBlockers(current.deck),
      deckIssues: current.deck.declarationIssues,
      warnings: [
        ...deckWarnings(current.deck),
        ...(current.barcodeMixed ? ["This recipe's Shopify listings have different barcodes, so no barcode is printed — set one on the recipe page."] : []),
        ...(!current.snapshot.barcode && !current.barcodeMixed ? ["No barcode — set the pack barcode on the recipe page (it is the one the packing scanner uses)."] : []),
      ],
      sample: sampleDates(),
      current: { hash: current.hash, snapshot: current.snapshot, proof: proofPayload(currentProof) },
      live: lv ? {
        versionNo: lv.versionNo, publishedAt: lv.publishedAt, publishedByName: lv.publishedByName, hash: lv.snapshotHash,
        snapshot: lv.snapshot, proof: liveProof ? proofPayload(liveProof) : null,
      } : null,
    });
  } catch (err) { fail(res, err, "GET /recipes/:id"); }
});

const nullableInt = (max: number) => z.number().int().min(0).max(max).nullable().optional();
const Period = z.object({ amount: z.number().int().min(1).max(999), unit: z.enum(["days", "weeks", "months", "years"]) }).nullable().optional();

// The barcode is set on the recipe page (routes/barcodes.ts) — one number
// for the label and the packing scanner. A "barcode" sent here is ignored.
const SettingsBody = z.object({
  labelName: z.string().max(200).nullable().optional(),
  ovenOn: z.boolean().optional(),
  airFryerOn: z.boolean().optional(),
  // Bones warning: true / false = always on / off; null = Automatic.
  warningOn: z.boolean().nullable().optional(),
  frozenOn: z.boolean().optional(),
  // The label template this recipe uses; null = the standard one.
  templateId: z.number().int().positive().nullable().optional(),
  // e.g. "500g"; blank = not set.
  netQuantity: z.string().max(40).nullable().optional(),
  // Customer cooking times: weight-tier suggestion or this recipe's own values.
  cookingMode: z.enum(["suggested", "manual"]).nullable().optional(),
  ovenTempC: nullableInt(400),
  fanTempC: nullableInt(400),
  ovenMinMinutes: nullableInt(240),
  ovenMaxMinutes: nullableInt(240),
  airFryerTempC: nullableInt(400),
  airFryerMinMinutes: nullableInt(240),
  airFryerMaxMinutes: nullableInt(240),
  chilled: Period,
  frozen: Period,
});

router.put("/recipes/:id/settings", requireManagerOrAdmin, validate(SettingsBody), async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const body = req.body as z.infer<typeof SettingsBody>;
  try {
    const recipe = await loadRecipe(p.data.id);
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
    const who = await userName(req);
    const set: Partial<typeof productLabelSettingsTable.$inferInsert> = { updatedAt: new Date(), updatedByName: who.name };
    if (body.labelName !== undefined) set.labelName = body.labelName?.trim() || null;
    for (const k of ["ovenOn", "airFryerOn", "frozenOn"] as const) if (body[k] !== undefined) set[k] = body[k];
    if (body.warningOn !== undefined) set.warningOn = body.warningOn;
    if (body.netQuantity !== undefined) set.netQuantity = body.netQuantity?.trim() || null;
    if (body.cookingMode !== undefined) set.cookingMode = body.cookingMode;
    if (body.templateId !== undefined) {
      if (body.templateId != null) {
        const [t] = await db.select({ id: productLabelTemplatesTable.id }).from(productLabelTemplatesTable).where(eq(productLabelTemplatesTable.id, body.templateId));
        if (!t) { res.status(400).json({ error: "That label template doesn't exist" }); return; }
      }
      set.templateId = body.templateId;
    }
    for (const k of ["ovenTempC", "fanTempC", "ovenMinMinutes", "ovenMaxMinutes", "airFryerTempC", "airFryerMinMinutes", "airFryerMaxMinutes"] as const) {
      if (body[k] !== undefined) set[k] = body[k] ?? null;
    }
    if (body.chilled !== undefined) { set.chilledAmount = body.chilled?.amount ?? null; set.chilledUnit = body.chilled?.unit ?? null; }
    if (body.frozen !== undefined) { set.frozenAmount = body.frozen?.amount ?? null; set.frozenUnit = body.frozen?.unit ?? null; }
    await db.insert(productLabelSettingsTable)
      .values({ recipeId: recipe.id, ...set })
      .onConflictDoUpdate({ target: productLabelSettingsTable.recipeId, set });
    res.json({ ok: true });
  } catch (err) { fail(res, err, "PUT /recipes/:id/settings"); }
});

// ── Publish ────────────────────────────────────────────────────────────────

const PublishBody = z.object({
  /** The current snapshot the person checked on screen. */
  expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** "I've checked it — update live" — the human half of the double check. */
  confirmed: z.literal(true),
});

router.post("/recipes/:id/publish", requireManagerOrAdmin, validate(PublishBody), async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const body = req.body as z.infer<typeof PublishBody>;
  try {
    const recipe = await loadRecipe(p.data.id);
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
    // Rebuild on the server — never trust what the page sent.
    const current = await buildCurrentLabel(recipe);
    if (current.hash !== body.expectedHash) {
      res.status(409).json({ error: "The label changed while you were checking it (someone edited the recipe or the template). Look at the new proof and confirm again." });
      return;
    }
    const proof = renderProof(current.snapshot);
    const blockers = publishBlockers({
      archived: recipe.archivedAt != null, fits: proof.layout.fits, fitProblems: proof.layout.problems.map(x => x.message),
      contentProblems: proof.content.problems, deckBlockers: deckBlockers(current.deck),
    });
    if (blockers.length) { res.status(422).json({ error: "This label can't go live yet.", blockers }); return; }
    const live = await loadLiveVersion(recipe.id);
    if (live && live.snapshotHash === current.hash) { res.status(409).json({ error: "The live label is already this version." }); return; }
    const who = await userName(req);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialise publishes of one recipe so version numbers can't collide.
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [20261010, recipe.id]);
      const { rows } = await client.query<{ next: number }>(
        "SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM product_label_versions WHERE recipe_id = $1", [recipe.id],
      );
      const versionNo = Number(rows[0].next);
      await client.query(
        `INSERT INTO product_label_versions
           (recipe_id, recipe_name, version_no, snapshot, snapshot_hash, fit, template_id, template_version, published_by_id, published_by_name,
            proof_png, proof_dpi)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [recipe.id, recipe.name, versionNo, JSON.stringify(current.snapshot), current.hash, JSON.stringify(fitSummary(proof)),
          current.template.id, current.template.version, who.id, who.name,
          // The exact image going live (dated today, the publish day) — the
          // label history shows this, never a later re-draw (migration 0172).
          Buffer.from(encodePng(proof.bitmap)), proof.layout.dpi],
      );
      await client.query("COMMIT");
      res.json({ ok: true, versionNo, publishedByName: who.name });
    } catch (err) {
      await client.query("ROLLBACK").catch(e => console.error("[product-labels] rollback failed:", e));
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { fail(res, err, "POST /recipes/:id/publish"); }
});

export default router;
