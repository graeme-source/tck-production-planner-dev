/**
 * Product labels, Stage 1 — /api/product-labels. Objectives A, D and F.
 *
 *   GET  /template                    the label design + legal minimums
 *   PUT  /template                    save it (manager/admin; autosaved)
 *   POST /template/preview            render a recipe with an UNSAVED design
 *   GET  /recipes                     every recipe's label status
 *   GET  /recipes/:id                 live + current proof, status, changes
 *   PUT  /recipes/:id/settings        barcode, overrides (manager/admin; autosaved)
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
import { and, eq, ne, sql } from "drizzle-orm";
import {
  checkEan13, decideStatus, enforceLegalMinimums, legalMinimums, normaliseTemplate, publishBlockers,
  STATUS_LABEL, WIDTH_ORDER, type LabelSnapshot,
} from "@workspace/product-labels";
import { requireManagerOrAdmin } from "../middleware/roles";
import { rawBody, validate } from "../middleware/validate";
import {
  buildCurrentLabel, changesSinceLive, checkFit, deckBlockers, deckWarnings, fitSummary, fonts, loadAllLiveVersions,
  loadLiveVersion, loadRecipe, loadTemplate, renderProof, sampleDates, type LoadedTemplate,
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

router.get("/template", async (_req, res) => {
  try {
    res.json(templatePayload(await loadTemplate()));
  } catch (err) { fail(res, err, "GET /template"); }
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

// ── Recipe list ────────────────────────────────────────────────────────────

router.get("/recipes", async (_req, res) => {
  try {
    const recipes = await db.select().from(recipesTable).orderBy(recipesTable.name);
    const live = await loadAllLiveVersions();
    const templateCache = new Map<number | "default", LoadedTemplate>();
    const out = [];
    for (const r of recipes) {
      if (r.archivedAt && !live.has(r.id)) continue;
      const current = await buildCurrentLabel(r, { templateCache });
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
    // The same barcode on another recipe is almost always a typing slip.
    const dupes = current.snapshot.barcode
      ? await db.select({ id: recipesTable.id, name: recipesTable.name })
        .from(productLabelSettingsTable)
        .innerJoin(recipesTable, eq(recipesTable.id, productLabelSettingsTable.recipeId))
        .where(and(eq(productLabelSettingsTable.barcode, current.snapshot.barcode), ne(productLabelSettingsTable.recipeId, recipe.id)))
      : [];
    res.json({
      recipe: {
        id: recipe.id, name: recipe.name, packSize: current.snapshot.packSize, shelfLifeDays: recipe.shelfLifeDays,
        isDraft: recipe.isDraft, archived: recipe.archivedAt != null,
        // The FACTORY oven setting (part-bake) — shown for reference only, never printed.
        factoryOvenTempC: recipe.ovenTempC, factoryOvenTimeSeconds: recipe.ovenTimeSeconds,
      },
      settings: current.settings,
      settingsUpdatedAt: current.settingsRow?.updatedAt ?? null,
      settingsUpdatedByName: current.settingsRow?.updatedByName ?? null,
      template: { id: current.template.id, name: current.template.name, version: current.template.version, cooking: current.template.template.cooking, frozenDefault: current.template.template.frozenDefault },
      status,
      statusLabel: STATUS_LABEL[status],
      matchesLive,
      changes: matchesLive ? [] : changesSinceLive(lv, current.snapshot),
      blockers,
      warnings: [
        ...deckWarnings(current.deck),
        ...dupes.map(d => `The same barcode is on ${d.name} — check it's the right number.`),
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

const SettingsBody = z.object({
  barcode: z.string().max(40).nullable().optional(),
  labelName: z.string().max(200).nullable().optional(),
  ovenOn: z.boolean().optional(),
  airFryerOn: z.boolean().optional(),
  warningOn: z.boolean().optional(),
  frozenOn: z.boolean().optional(),
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
    let barcode: string | null | undefined = body.barcode;
    if (barcode !== undefined && barcode !== null) {
      barcode = barcode.replace(/\s+/g, "");
      if (barcode === "") barcode = null;
      else {
        const c = checkEan13(barcode);
        if (!c.ok) { res.status(400).json({ error: `Barcode not saved — ${c.reason}.` }); return; }
      }
    }
    const who = await userName(req);
    const set: Partial<typeof productLabelSettingsTable.$inferInsert> = { updatedAt: new Date(), updatedByName: who.name };
    if (barcode !== undefined) set.barcode = barcode;
    if (body.labelName !== undefined) set.labelName = body.labelName?.trim() || null;
    for (const k of ["ovenOn", "airFryerOn", "warningOn", "frozenOn"] as const) if (body[k] !== undefined) set[k] = body[k];
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
           (recipe_id, recipe_name, version_no, snapshot, snapshot_hash, fit, template_id, template_version, published_by_id, published_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [recipe.id, recipe.name, versionNo, JSON.stringify(current.snapshot), current.hash, JSON.stringify(fitSummary(proof)),
          current.template.id, current.template.version, who.id, who.name],
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
