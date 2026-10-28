/**
 * Test box → Shopify draft products: the RULES (pure, tested). Objectives A
 * (a trial recipe gets a properly set-up, planner-linked Shopify product in
 * one sitting) and I (the launch checklist does itself).
 *
 * HOW GRAEME SETS A TEST-BOX PRODUCT UP BY HAND — read-only inspection of the
 * live store, 2026-10-02 (his draft "Properoni Chicken & Chorizo", the
 * previous box's "Philly Cheesesteak Calzones 2.0" / "The Benji" / "Open Fire
 * BBQ Chicken & Garlic Butter", and the core "Chicken & Chorizo"):
 *   - Shopify → Duplicate the last test-box product. That carries the single
 *     variant "2 Pack" (option "Size"), price, weight 1000 g, inventory
 *     tracked / DENY, template suffix "recipe-template", vendor, the
 *     "Create-Test-Box" manual collection, images, cooking instructions.
 *   - Status DRAFT. Tags EXACTLY show, no-wholesale, calzones + the box name
 *     ("Properoni Test Box"); the previous box's tag ("Summer Test Box"),
 *     "Meals" and "current-special" are dropped.
 *   - HIDDEN FROM THE MAIN WEBSITE by what the product is NOT: product type
 *     left blank (the menu's "Dynamic Calzones" collection is TYPE = Calzones),
 *     no "wholesale-g" tag ("Wholesale Calzones"), not added to the manual
 *     "Shop Calzones" collection. It is reached through the box's own
 *     collection. (Sales channels can't be read: the app has no
 *     read_publications scope.)
 *   - Product metafields: custom.product_recipe (single_line_text_field, the
 *     description, same text as the description HTML), custom.per_recipe
 *     (single_line_text_field "2" = calzones per pack), custom.ingredient_deck
 *     (rich_text_field), custom.cooking_instructions (rich_text_field —
 *     identical standard text on every calzone), custom.nutritional_info
 *     (file_reference → an IMAGE of the nutrition table — black on white,
 *     "Typical values | per 100g | per 355g serving"; the app draws one in
 *     the browser and uploads it, needing the write_files scope), custom.pairs_with (list.product_reference, the
 *     garlic mayo), legacy custom_fields.recipe ("string": an older copy of
 *     the description), judgeme.* / reviews.* (review apps).
 *   - Barcode: GS1 number added by hand later (blank on his fresh draft).
 *   - Collection per box: a SMART collection named for the box whose rule
 *     is TAG EQUALS <box tag> (e.g. "August Test Box" = tag "Summer Test Box").
 */
import { NUTRITION_TABLE_ROWS, formatNutrient } from "@workspace/product-labels";

export const TEST_BOX_BASE_TAGS: readonly string[] = ["show", "no-wholesale", "calzones"];

/** Calzones per pack when a recipe has no usable pack size. */
export const DEFAULT_PER_PACK = 2;

export interface MetafieldRef { namespace: string; key: string }
export interface MetafieldDef extends MetafieldRef { type: string; label: string }

export const MF = {
  ingredientDeck: { namespace: "custom", key: "ingredient_deck", type: "rich_text_field", label: "Ingredient deck" },
  description: { namespace: "custom", key: "product_recipe", type: "single_line_text_field", label: "Recipe description" },
  // Legacy copy of the description; its old type ("string") can't be written
  // any more, so it is removed and written again as multi-line text.
  legacyDescription: { namespace: "custom_fields", key: "recipe", type: "multi_line_text_field", label: "Description (older field)" },
  perPack: { namespace: "custom", key: "per_recipe", type: "single_line_text_field", label: "Calzones per pack" },
  cooking: { namespace: "custom", key: "cooking_instructions", type: "rich_text_field", label: "Cooking instructions" },
  nutrition: { namespace: "custom", key: "nutritional_info", type: "file_reference", label: "Nutrition table (image)" },
} as const satisfies Record<string, MetafieldDef>;

/** Carried over by Duplicate but describing the TEMPLATE's recipe — removed
 *  so the new product never shows another recipe's nutrition, reviews or SEO. */
export const TEMPLATE_ONLY_METAFIELDS: readonly MetafieldDef[] = [
  MF.nutrition,
  { namespace: "reviews", key: "rating", type: "rating", label: "Review rating" },
  { namespace: "reviews", key: "rating_count", type: "number_integer", label: "Review count" },
  { namespace: "global", key: "title_tag", type: "string", label: "SEO title" },
  { namespace: "global", key: "description_tag", type: "string", label: "SEO description" },
  { namespace: "bundle", key: "subtitle", type: "single_line_text_field", label: "Bundle subtitle" },
];

/** The standard calzone storage + cooking text, exactly as on the live
 *  products. Only used when the template product has none of its own. */
export const STANDARD_COOKING_SECTIONS: ReadonlyArray<{ heading: string; text: string }> = [
  {
    heading: "Storage:",
    text: "If chilled, keep me below 5°C. If frozen, keep below -18°C.  If you decide to freeze me, please do so immediately, use by frozen use by date, fully defrost in a fridge before cooking and eat within 24 hours of defrosting.",
  },
  {
    heading: "Cooking:",
    text: "1. Pre-heat oven to 200°C/ 180°C Fan and remove calzones from tray.\n2. Keep baking paper but separate calzones and place on a baking tray.\n3. Cook in the center of the oven for 16 - 20 minutes (piping hot throughout).",
  },
];

/** The scopes the app's Shopify connection needs to make the products. */
export const REQUIRED_WRITE_SCOPES: readonly string[] = ["write_products"];

/** …and to upload the nutrition image (stagedUploadsCreate + fileCreate,
 *  Admin API 2026-01: "Requires write_files … or write_images"). Missing it
 *  never stops the products — the image is just left off. */
export const FILE_WRITE_SCOPES: readonly string[] = ["write_files"];

export function missingFileScopes(scopes: string[]): string[] {
  return scopes.includes("write_files") || scopes.includes("write_images") ? [] : [...FILE_WRITE_SCOPES];
}

const norm = (s: string) => s.trim().toLowerCase();

// ── Tags ────────────────────────────────────────────────────────────────────
/** Exactly the base tags plus the box name (no duplicates, any case). */
export function testBoxTags(boxName: string): string[] {
  const out: string[] = [];
  for (const t of [...TEST_BOX_BASE_TAGS, boxName.trim()]) {
    if (t && !out.some(o => norm(o) === norm(t))) out.push(t);
  }
  return out;
}

export function tagChanges(current: string[], wanted: string[]): { removed: string[]; added: string[] } {
  return {
    removed: current.filter(t => !wanted.some(w => norm(w) === norm(t))),
    added: wanted.filter(w => !current.some(t => norm(t) === norm(w))),
  };
}

/** Shopify product search for possible templates: earlier test-box products
 *  carry every base tag. */
export function templateSearchQuery(): string {
  return [...TEST_BOX_BASE_TAGS.map(t => `tag:"${t}"`), "-status:archived"].join(" AND ");
}

/** Tags on a template that aren't base tags — where the previous box's own
 *  tag (and so its collection's rule) is found. */
export function extraTags(tags: string[], boxName: string): string[] {
  return tags.filter(t => !TEST_BOX_BASE_TAGS.some(b => norm(b) === norm(t)) && norm(t) !== norm(boxName));
}

// ── Template choice ─────────────────────────────────────────────────────────
export interface TemplateCandidate { productId: string; title: string; status: string; tags: string[]; createdAt: string }

/** "Copied … from recipe 12" in a recipe's notes → 12. */
export function copiedFromRecipeId(notes: string | null | undefined): number | null {
  const m = /\bcop(?:y|ied)\b[^\n]*?\bfrom recipe\s*#?(\d+)/i.exec(notes ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Which product to duplicate: what the person picked, else the product
 * mapped to the recipe this one was copied from, else the newest ACTIVE
 * earlier test-box product (not this box's), else the newest of any status.
 */
export function chooseTemplate(input: {
  requested?: string | null;
  copiedFromProductId?: string | null;
  candidates: TemplateCandidate[];
  boxName: string;
}): { productId: string | null; reason: "chosen" | "copied-from" | "previous-box" | "none" } {
  if (input.requested) return { productId: input.requested, reason: "chosen" };
  if (input.copiedFromProductId) return { productId: input.copiedFromProductId, reason: "copied-from" };
  const others = input.candidates
    .filter(c => !c.tags.some(t => norm(t) === norm(input.boxName)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pick = others.find(c => c.status === "ACTIVE") ?? others[0];
  return pick ? { productId: pick.productId, reason: "previous-box" } : { productId: null, reason: "none" };
}

// ── Content ─────────────────────────────────────────────────────────────────
export function perPackValue(packSize: number | string | null | undefined): string {
  const n = Number(packSize);
  return String(Number.isInteger(n) && n >= 1 ? n : DEFAULT_PER_PACK);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Description as product HTML: one paragraph per blank-line block. */
export function descriptionHtml(description: string): string {
  return description.trim().split(/\n\s*\n/).map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`).join("\n");
}

/** The single-line metafield can't hold line breaks. */
export function singleLine(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

export interface NutritionRow { key: string; label: string; indent: boolean; optional: boolean; per100g: string; perPortion: string | null }

/** The app's nutrition (GET /api/recipes/:id/nutritionals) as table rows —
 *  exactly what the nutrition image says. Row order, labels and rounding
 *  are the shared ones in @workspace/product-labels (nutrition-table.ts,
 *  matching the website's existing images). perPortion null (a recipe with
 *  no portion size) gives perPortion null on every row: per 100 g only. */
export function nutritionRows(per100g: Record<string, number | null>, perPortion: Record<string, number | null> | null): NutritionRow[] {
  return NUTRITION_TABLE_ROWS.map(r => ({
    key: r.key, label: r.label, indent: r.indent, optional: r.optional,
    per100g: formatNutrient(r.key, per100g[r.key]),
    perPortion: perPortion ? formatNutrient(r.key, perPortion[r.key]) : null,
  }));
}

// ── Nutrition image ─────────────────────────────────────────────────────────
/** Whether the run will put a nutrition image on this recipe's product, and
 *  the plain-English line the preview shows. */
export function nutritionImagePlan(input: { nutritionComplete: boolean; missingFileScopes: string[] }): { willAttach: boolean; summary: string } {
  if (!input.nutritionComplete) {
    return { willAttach: false, summary: "Nutrition isn't complete, so no image can be made yet — the template's is removed. Finish the nutrition and run this again." };
  }
  if (input.missingFileScopes.length) {
    return { willAttach: false, summary: `Shopify hasn't given the app permission to upload files yet (${input.missingFileScopes.join(", ")}) — the nutrition image will be left off; add the scope to have it put on. The template's is removed.` };
  }
  return { willAttach: true, summary: "This recipe's nutrition table, drawn by the app from the numbers below and uploaded as a new image" };
}

/** The biggest nutrition PNG the server takes (decoded). A 1000 px table is
 *  about 30–80 KB; anything near this is not one of ours. */
export const MAX_NUTRITION_PNG_BYTES = 600_000;

/** A nutrition image sent by the browser (base64 PNG) checked before it goes
 *  anywhere near Shopify: really a PNG, a sensible size. Pure. */
export function checkNutritionPng(base64: string): { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; reason: string } {
  const clean = base64.replace(/^data:image\/png;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return { ok: false, reason: "The nutrition image isn't valid base64" };
  const bytes = Uint8Array.from(Buffer.from(clean, "base64"));
  if (bytes.length > MAX_NUTRITION_PNG_BYTES) return { ok: false, reason: "The nutrition image is too big" };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || !sig.every((b, i) => bytes[i] === b)) return { ok: false, reason: "The nutrition image isn't a PNG" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 200 || width > 3000 || height < 100 || height > 3000) return { ok: false, reason: `The nutrition image is an odd size (${width}×${height})` };
  return { ok: true, bytes, width, height };
}

/**
 * The nutrition image for one recipe's run: the browser's PNG when the
 * preview said it will be put on and the PNG passes the checks, else null
 * with the line for the results.
 */
export function nutritionImageForRun(
  rp: { title: string; nutritionImage: { willAttach: boolean; summary: string } },
  pngBase64: string | undefined,
): { image: { bytes: Uint8Array; filename: string; alt: string } | null; note: string | null } {
  if (!rp.nutritionImage.willAttach) return { image: null, note: `Nutrition image left off: ${rp.nutritionImage.summary}` };
  if (!pngBase64) return { image: null, note: "Nutrition image left off: the page didn't send one (reload the preview and run again). The template's was removed." };
  const png = checkNutritionPng(pngBase64);
  if (!png.ok) return { image: null, note: `Nutrition image left off: ${png.reason}. The template's was removed.` };
  return { image: { bytes: png.bytes, filename: nutritionFilename(rp.title), alt: `${rp.title} nutrition` }, note: null };
}

/** "Properoni CarniZone" → "properoni-carnizone-nutrition.png". */
export function nutritionFilename(title: string): string {
  const slug = collectionHandle(title).slice(0, 60) || "recipe";
  return `${slug}-nutrition.png`;
}

// ── Metafields ──────────────────────────────────────────────────────────────
export interface MetafieldValue { namespace: string; key: string; type: string; value: string }
export type MetafieldLine = { label: string; field: string; action: "set" | "keep" | "remove" | "none"; summary: string };

export interface RecipeContent {
  description: string | null;
  packSize: number | string | null;
  /** Rich-text JSON for the deck, or null when the deck isn't complete. */
  deckDocument: string | null;
  deckSummary: string | null;
}

/**
 * What to write and what to remove on the duplicated product. `existing` is
 * the product's metafields as they are now (the template's, straight after
 * Duplicate).
 */
export function metafieldPlan(content: RecipeContent, existing: MetafieldValue[], standardCooking: string, nutritionImage?: { willAttach: boolean; summary: string }): {
  set: MetafieldValue[]; remove: MetafieldRef[]; lines: MetafieldLine[];
} {
  const has = (m: MetafieldRef) => existing.find(e => e.namespace === m.namespace && e.key === m.key);
  const set: MetafieldValue[] = [];
  const remove: MetafieldRef[] = [];
  const lines: MetafieldLine[] = [];
  const field = (m: MetafieldRef) => `${m.namespace}.${m.key}`;
  const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  // Ingredient deck: the app's, or none — never the template's.
  if (content.deckDocument) {
    set.push({ ...pick(MF.ingredientDeck), value: content.deckDocument });
    lines.push({ label: MF.ingredientDeck.label, field: field(MF.ingredientDeck), action: "set", summary: short(content.deckSummary ?? "From the app") });
  } else {
    if (has(MF.ingredientDeck)) remove.push(pick(MF.ingredientDeck));
    lines.push({ label: MF.ingredientDeck.label, field: field(MF.ingredientDeck), action: has(MF.ingredientDeck) ? "remove" : "none", summary: "Not ready in the app — left empty (the template's deck is removed)" });
  }

  // Description (+ its legacy copy).
  const desc = content.description?.trim() ?? "";
  if (desc) {
    set.push({ ...pick(MF.description), value: singleLine(desc) });
    lines.push({ label: MF.description.label, field: field(MF.description), action: "set", summary: short(singleLine(desc)) });
  } else {
    if (has(MF.description)) remove.push(pick(MF.description));
    lines.push({ label: MF.description.label, field: field(MF.description), action: has(MF.description) ? "remove" : "none", summary: "No description on the recipe — left empty" });
  }
  if (has(MF.legacyDescription)) remove.push(pick(MF.legacyDescription));
  if (desc) set.push({ ...pick(MF.legacyDescription), value: desc });

  // Calzones per pack.
  const perPack = perPackValue(content.packSize);
  set.push({ ...pick(MF.perPack), value: perPack });
  lines.push({ label: MF.perPack.label, field: field(MF.perPack), action: "set", summary: perPack });

  // Cooking instructions: the template's own text if it has some, else standard.
  const cooking = has(MF.cooking);
  if (cooking?.value) {
    lines.push({ label: MF.cooking.label, field: field(MF.cooking), action: "keep", summary: "Kept from the template (standard text)" });
  } else {
    set.push({ ...pick(MF.cooking), value: standardCooking });
    lines.push({ label: MF.cooking.label, field: field(MF.cooking), action: "set", summary: "Standard storage + cooking text" });
  }

  // Things that describe the template's recipe.
  for (const m of TEMPLATE_ONLY_METAFIELDS) {
    if (has(m)) remove.push(pick(m));
  }
  // The nutrition image: the template's is always removed first (so another
  // recipe's never shows, even if the upload fails); the run then sets this
  // recipe's own image once it is uploaded (applyRecipeProduct).
  lines.push(nutritionImage?.willAttach
    ? { label: MF.nutrition.label, field: field(MF.nutrition), action: "set", summary: nutritionImage.summary }
    : {
      label: MF.nutrition.label, field: field(MF.nutrition), action: has(MF.nutrition) ? "remove" : "none",
      summary: nutritionImage?.summary ?? "An image — the template's is removed; this recipe's is made when the run has its picture",
    });

  return { set, remove, lines };
}

function pick<T extends MetafieldDef>(m: T): { namespace: string; key: string; type: string } & MetafieldRef {
  return { namespace: m.namespace, key: m.key, type: m.type };
}

// ── Which recipes get what ──────────────────────────────────────────────────
export type RecipeAction = "create" | "update" | "linked";

/**
 * - linked: the recipe already has a live Shopify product (recipe_shopify_
 *   mappings) that the app didn't make for this box — left alone.
 * - update: the app made this one before and it's still in Shopify — re-run
 *   updates it (never duplicates again).
 * - create: nothing yet (or the app's earlier product has gone from Shopify).
 */
export function decideRecipeAction(input: {
  createdProductId: string | null;
  createdProductExists: boolean;
  mappedProductIds: string[];
}): RecipeAction {
  if (input.createdProductId && input.createdProductExists) return "update";
  const others = input.mappedProductIds.filter(id => id !== input.createdProductId);
  if (others.length > 0) return "linked";
  return "create";
}

// ── Collection ──────────────────────────────────────────────────────────────
export interface CollectionRule { column: string; relation: string; condition: string }
export interface CollectionInfo {
  id: string;
  title: string;
  handle: string;
  sortOrder: string;
  templateSuffix: string | null;
  rules: CollectionRule[] | null;
}

export function collectionHandle(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function boxRule(boxName: string): CollectionRule {
  return { column: "TAG", relation: "EQUALS", condition: boxName.trim() };
}

/** The collection already there for this box: the one remembered on the box,
 *  else one with the box's title or handle. */
export function findBoxCollection(boxName: string, storedId: string | null, collections: CollectionInfo[]): CollectionInfo | null {
  if (storedId) {
    const byId = collections.find(c => c.id === storedId);
    if (byId) return byId;
  }
  return collections.find(c => norm(c.title) === norm(boxName)) ?? collections.find(c => c.handle === collectionHandle(boxName)) ?? null;
}

/**
 * The previous box's collection: a smart collection whose ONLY rule is TAG
 * EQUALS one of the template's non-base tags (a box collection has exactly
 * that one rule; "Meals" also excludes 8-pack bags, so it's skipped). When
 * several match (the template also carries e.g. "6 Week"), the newest
 * collection wins — Shopify ids only grow. Its sort order is copied.
 */
export function previousBoxCollection(templateTags: string[], boxName: string, collections: CollectionInfo[]): CollectionInfo | null {
  const tags = extraTags(templateTags, boxName).map(norm);
  const matches = collections.filter(c => {
    const rules = c.rules ?? [];
    return rules.length === 1 && rules[0].column === "TAG" && rules[0].relation === "EQUALS" && tags.includes(norm(rules[0].condition));
  });
  matches.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : BigInt(b.id) < BigInt(a.id) ? -1 : 0));
  return matches[0] ?? null;
}

export function newCollectionSettings(boxName: string, previous: CollectionInfo | null) {
  return {
    title: boxName.trim(),
    rule: boxRule(boxName),
    sortOrder: previous?.sortOrder ?? "BEST_SELLING",
    templateSuffix: previous?.templateSuffix || null,
    copiedFrom: previous?.title ?? null,
  };
}

// ── Readiness ───────────────────────────────────────────────────────────────
/** …and to make the discount code. */
export const DISCOUNT_WRITE_SCOPES: readonly string[] = ["write_discounts"];

export function missingWriteScopes(scopes: string[], required: readonly string[] = REQUIRED_WRITE_SCOPES): string[] {
  return required.filter(s => !scopes.includes(s));
}

/** Launch steps the run can tick: products once EVERY recipe in the box has a
 *  live linked product; the collection once it exists. */
export function launchTicks(input: { recipeIds: number[]; linkedRecipeIds: number[]; collectionExists: boolean }): { products: boolean; collection: boolean } {
  const linked = new Set(input.linkedRecipeIds);
  return {
    products: input.recipeIds.length > 0 && input.recipeIds.every(id => linked.has(id)),
    collection: input.collectionExists,
  };
}

/** Warnings for one recipe's preview. Blocking ones stop that recipe's create. */
export function recipeWarnings(input: {
  action: RecipeAction;
  templateFound: boolean;
  description: string | null;
  deckComplete: boolean;
  deckMissing: string[];
  nutritionComplete: boolean;
  nutritionMissing: string[];
  templateVariantCount: number;
  existingStatus: string | null;
}): { warnings: string[]; blocking: string[] } {
  const warnings: string[] = [];
  const blocking: string[] = [];
  // Already in Shopify and left alone — nothing here is about to be written.
  if (input.action === "linked") return { warnings, blocking };
  input = { ...input, deckMissing: [...new Set(input.deckMissing)], nutritionMissing: [...new Set(input.nutritionMissing)] };
  if (input.action === "create" && !input.templateFound) blocking.push("No template product found — pick one to duplicate.");
  if (!input.description?.trim()) warnings.push("The recipe has no description — the product's description will be left empty. Add one on the recipe (or write it in Shopify).");
  if (!input.deckComplete) {
    warnings.push(`The ingredient deck isn't complete${input.deckMissing.length ? ` (${input.deckMissing.slice(0, 4).join(", ")}${input.deckMissing.length > 4 ? "…" : ""})` : ""} — the product gets no ingredients until it's fixed and pushed from the recipe page.`);
  }
  if (!input.nutritionComplete) {
    warnings.push(`Nutrition is incomplete${input.nutritionMissing.length ? ` (${input.nutritionMissing.slice(0, 4).join(", ")}${input.nutritionMissing.length > 4 ? "…" : ""})` : ""} — the nutrition image can't be made from these numbers yet.`);
  }
  if (input.action === "create" && input.templateVariantCount > 1) {
    warnings.push("The template has more than one variant — only matching variants are linked to the recipe; check the rest by hand.");
  }
  if (input.action === "update" && input.existingStatus && input.existingStatus !== "DRAFT") {
    warnings.push(`Already ${input.existingStatus.toLowerCase()} in Shopify — its status is left alone.`);
  }
  return { warnings, blocking };
}

/**
 * The product's price comes from the recipe's RRP (Graeme, 28 Oct 2026), so
 * the price set while costing the recipe is what goes on sale. Only on a
 * one-variant product (every test-box product so far: "2 Pack") — with more
 * variants the app can't tell which pack the RRP is for, so they're left as
 * they are. No RRP: the price is left as it is (the template's, on a new one).
 */
export function productPrice(rrp: unknown, variantCount: number, current: string | null): { price: string | null; summary: string } {
  const n = Number(rrp);
  const now = current != null && current !== "" ? `£${Number(current).toFixed(2)}` : null;
  if (!(n > 0)) return { price: null, summary: `No RRP on the recipe — ${now ? `stays ${now}` : "left as it is"}. Set the RRP on the recipe first.` };
  if (variantCount !== 1) return { price: null, summary: `Several variants — prices left as they are (RRP £${n.toFixed(2)}); set them in Shopify.` };
  const price = n.toFixed(2);
  return { price, summary: now && Number(current) === Number(price) ? `£${price} (the recipe's RRP)` : `£${price} from the recipe's RRP${now ? ` (was ${now})` : ""}` };
}

/**
 * Which of a new product's variants to link to the recipe: a one-variant
 * product (every test-box product so far: "2 Pack") links that variant;
 * otherwise only variants whose title matches a template variant that is the
 * MAIN mapping of its recipe — an "8 Pack Bag" is never linked as a 2-pack.
 */
export function variantsToLink(
  newVariants: Array<{ id: string; title: string }>,
  templateVariants: Array<{ id: string; title: string }>,
  templateMainVariantIds: string[],
): string[] {
  if (newVariants.length === 1) return [newVariants[0].id];
  const mainTitles = templateVariants.filter(v => templateMainVariantIds.includes(v.id)).map(v => norm(v.title));
  return newVariants.filter(v => mainTitles.includes(norm(v.title))).map(v => v.id);
}

/**
 * Shopify product search from what a person typed (or a recipe name):
 * every meaningful word must appear somewhere in the title, so "The Texican
 * Fajita Calzone 2.0" finds "The Texican - Fajita Calzone 2.0" (a plain
 * search for the whole name finds nothing). Null when nothing is searchable.
 */
const SEARCH_SKIP = new Set(["the", "and", "with", "calzone", "calzones"]);
export function productSearchQuery(text: string): string | null {
  const words = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !SEARCH_SKIP.has(w));
  const unique = [...new Set(words)].slice(0, 4);
  return unique.length ? unique.map(w => `title:*${w}*`).join(" ") : null;
}

/** Normalised product title, for spotting a product already made by hand. */
export function sameTitle(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  return n(a) === n(b);
}
