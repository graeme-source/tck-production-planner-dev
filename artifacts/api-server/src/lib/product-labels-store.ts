/**
 * Product labels — database side. Loads the template, a recipe's label
 * settings and its live (published) version; builds the CURRENT snapshot
 * from the recipe as it is now (deck from lib/recipe-ingredient-deck.ts, the
 * allergen source of truth); and renders proofs with the shared engine in
 * @workspace/product-labels. All decisions (what changed, does it fit, what
 * blocks publishing) are made by the pure, tested library.
 */
import { createHash } from "node:crypto";
import { db, recipesTable, productLabelTemplatesTable, productLabelSettingsTable, productLabelVersionsTable } from "@workspace/db";
import { asc, desc, eq } from "drizzle-orm";
import {
  buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, diffSnapshots, normalisePeriod, normaliseTemplate, snapshotKey,
  type LabelSnapshot, type LabelTemplate, type RecipeLabelSettings, type SnapshotChange, type PeriodUnit,
} from "@workspace/product-labels";
import { checkLabel, proofLabel, type LabelProof } from "@workspace/product-labels/render";
import { loadBundledFonts } from "@workspace/product-labels/node";
import { buildRecipeIngredientDeck } from "./recipe-ingredient-deck";
import { londonDateString } from "./london-time";
import { packBarcodeFor } from "./barcode-store";

export const fonts = () => loadBundledFonts();

export function snapshotHash(s: LabelSnapshot): string {
  return createHash("sha256").update(snapshotKey(s)).digest("hex");
}

// ── Template ───────────────────────────────────────────────────────────────

export interface LoadedTemplate {
  id: number;
  name: string;
  version: number;
  template: LabelTemplate;
  updatedAt: Date;
  updatedByName: string | null;
}

/** The default template (lowest id). A row with empty settings is filled
 *  with the full defaults the first time it's read, so what's stored is
 *  always what's used. */
export async function loadTemplate(id?: number | null): Promise<LoadedTemplate> {
  const rows = id
    ? await db.select().from(productLabelTemplatesTable).where(eq(productLabelTemplatesTable.id, id))
    : await db.select().from(productLabelTemplatesTable).orderBy(asc(productLabelTemplatesTable.id)).limit(1);
  let row = rows[0];
  if (!row && id) return loadTemplate(null);
  if (!row) {
    [row] = await db.insert(productLabelTemplatesTable).values({ name: "Standard calzone label" }).returning();
  }
  const template = normaliseTemplate(row.settings);
  const stored = row.settings as Record<string, unknown> | null;
  if (!stored || Object.keys(stored).length === 0) {
    await db.update(productLabelTemplatesTable).set({ settings: template }).where(eq(productLabelTemplatesTable.id, row.id));
  }
  return { id: row.id, name: row.name, version: row.version, template, updatedAt: row.updatedAt, updatedByName: row.updatedByName };
}

// ── Per-recipe settings ────────────────────────────────────────────────────

type SettingsRow = typeof productLabelSettingsTable.$inferSelect;

export function settingsFromRow(row: SettingsRow | undefined): RecipeLabelSettings {
  if (!row) return { ...DEFAULT_RECIPE_LABEL_SETTINGS, cooking: { ...DEFAULT_RECIPE_LABEL_SETTINGS.cooking } };
  return {
    barcode: row.barcode,
    labelName: row.labelName,
    ovenOn: row.ovenOn,
    airFryerOn: row.airFryerOn,
    cooking: {
      ovenTempC: row.ovenTempC, fanTempC: row.fanTempC, ovenMinMinutes: row.ovenMinMinutes, ovenMaxMinutes: row.ovenMaxMinutes,
      airFryerTempC: row.airFryerTempC, airFryerMinMinutes: row.airFryerMinMinutes, airFryerMaxMinutes: row.airFryerMaxMinutes,
    },
    warningOn: row.warningOn,
    chilled: normalisePeriod({ amount: row.chilledAmount, unit: row.chilledUnit as PeriodUnit }),
    frozenOn: row.frozenOn,
    frozen: normalisePeriod({ amount: row.frozenAmount, unit: row.frozenUnit as PeriodUnit }),
  };
}

export async function loadSettingsRow(recipeId: number): Promise<SettingsRow | undefined> {
  const [row] = await db.select().from(productLabelSettingsTable).where(eq(productLabelSettingsTable.recipeId, recipeId));
  return row;
}

// ── Live versions ──────────────────────────────────────────────────────────

export type VersionRow = typeof productLabelVersionsTable.$inferSelect;

export async function loadLiveVersion(recipeId: number): Promise<VersionRow | undefined> {
  const [row] = await db.select().from(productLabelVersionsTable)
    .where(eq(productLabelVersionsTable.recipeId, recipeId))
    .orderBy(desc(productLabelVersionsTable.versionNo))
    .limit(1);
  return row;
}

export async function loadAllLiveVersions(): Promise<Map<number, VersionRow>> {
  const rows = await db.select().from(productLabelVersionsTable).orderBy(desc(productLabelVersionsTable.versionNo));
  const out = new Map<number, VersionRow>();
  for (const r of rows) if (r.recipeId != null && !out.has(r.recipeId)) out.set(r.recipeId, r);
  return out;
}

// ── The current label ──────────────────────────────────────────────────────

export type RecipeRow = typeof recipesTable.$inferSelect;

export interface CurrentLabel {
  recipe: RecipeRow;
  /** The pack listings hold different barcodes (none is printed). */
  barcodeMixed: boolean;
  settings: RecipeLabelSettings;
  settingsRow: SettingsRow | undefined;
  template: LoadedTemplate;
  deck: Awaited<ReturnType<typeof buildRecipeIngredientDeck>>;
  snapshot: LabelSnapshot;
  hash: string;
}

export async function loadRecipe(recipeId: number): Promise<RecipeRow | undefined> {
  const [r] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
  return r;
}

/** The label as it would be if published now. `templateOverride` renders a
 *  template that isn't saved yet (the settings page's live preview). */
export async function buildCurrentLabel(recipe: RecipeRow, opts: { templateOverride?: LabelTemplate; templateCache?: Map<number | "default", LoadedTemplate>; packBarcodes?: Map<number, { barcode: string | null; mixed: boolean }> } = {}): Promise<CurrentLabel> {
  const settingsRow = await loadSettingsRow(recipe.id);
  const key = settingsRow?.templateId ?? "default";
  let template = opts.templateCache?.get(key);
  if (!template) {
    template = await loadTemplate(settingsRow?.templateId ?? null);
    opts.templateCache?.set(key, template);
  }
  if (opts.templateOverride) template = { ...template, template: opts.templateOverride };
  const deck = await buildRecipeIngredientDeck(recipe.id);
  // The barcode is NOT a label setting any more: it is the one the recipe's
  // pack listings scan with (lib/barcode-store.ts), so the printed label and
  // the packing scanner can never disagree. Mixed numbers = none printed.
  const pack = opts.packBarcodes?.get(recipe.id) ?? (opts.packBarcodes ? { barcode: null, mixed: false } : await packBarcodeFor(recipe.id));
  const settings = { ...settingsFromRow(settingsRow), barcode: pack.barcode };
  const snapshot = buildSnapshot({
    recipe: { name: recipe.name, packSize: recipe.packSize, shelfLifeDays: recipe.shelfLifeDays },
    deck: { deckText: deck.deckText, mayContainStatement: deck.mayContainStatement },
    settings,
    templateId: template.id,
    template: template.template,
  });
  return { recipe, barcodeMixed: pack.mixed, settings, settingsRow, template, deck, snapshot, hash: snapshotHash(snapshot) };
}

/** Proof dates: today (London) for both print and production day — a sample,
 *  and the page says so. */
export function sampleDates(): { printDate: string; productionDate: string } {
  const today = londonDateString();
  return { printDate: today, productionDate: today };
}

export function renderProof(snapshot: LabelSnapshot): LabelProof {
  return proofLabel(snapshot, sampleDates(), fonts());
}

export function checkFit(snapshot: LabelSnapshot) {
  return checkLabel(snapshot, sampleDates(), fonts());
}

/** Deck problems that block publishing — the same two the Shopify deck push
 *  refuses on (an ingredient with no declaration; a compound declaration
 *  without its name). */
export function deckBlockers(deck: CurrentLabel["deck"]): string[] {
  const out: string[] = [];
  if (deck.missingDeclarations.length) out.push(`${deck.missingDeclarations.length} ingredient(s) have no label declaration: ${deck.missingDeclarations.join(", ")}.`);
  if (deck.unwrappedDeclarations.length) out.push(`Declaration needs its compound name around the list: ${deck.unwrappedDeclarations.join(", ")}.`);
  return out;
}

/** Shown, not blocking: bolding on the label is text-driven, so an unticked
 *  allergen is still bold on the label — but the recipe's allergen list is
 *  wrong until the ingredient is fixed. */
export function deckWarnings(deck: CurrentLabel["deck"]): string[] {
  return deck.allergenMismatches.length
    ? [`Allergen ticks don't match the declaration for: ${deck.allergenMismatches.map(m => `${m.name} (${m.missing.join(", ")})`).join("; ")}.`]
    : [];
}

export function changesSinceLive(live: VersionRow | undefined, current: LabelSnapshot): SnapshotChange[] {
  if (!live) return [];
  return diffSnapshots(live.snapshot as LabelSnapshot, current);
}

/** Field sizes and fit, small enough to store with a published version. */
export function fitSummary(proof: LabelProof) {
  return {
    fits: proof.layout.fits,
    problems: proof.layout.problems,
    fields: proof.layout.fields.map(f => ({ key: f.key, sizePt: f.sizePt, width: f.width, minPt: f.minPt, legalMinPt: f.legalMinPt, xHeightMm: Math.round(f.xHeightMm * 100) / 100, lines: f.lines })),
    widthDots: proof.layout.widthDots,
    heightDots: proof.layout.heightDots,
    dpi: proof.layout.dpi,
  };
}
