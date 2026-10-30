/**
 * Putting a recipe's label live — the ONE server path, shared by the label
 * page ("I've checked it — update live", routes/product-labels.ts POST
 * /recipes/:id/publish) and "Create Shopify product" on a recipe (Graeme,
 * 30 Oct 2026: generate the back label at the same time — the Create
 * confirmation is the human tick). Objectives A and D.
 *
 * Re-checks everything on the server: the snapshot must be the one the
 * person looked at (expectedHash), it must fit and nothing may block it
 * (labelPublishBlockers), and it mustn't already be live. Then one new
 * version row: the frozen snapshot + hash, the fit summary, the template and
 * its version, who published it, and the exact PNG going live (label
 * history, migration 0172).
 *
 * Also: switching the front name label on as the product's front label
 * (migration 0269) — the label page's PUT /api/product-front-label/:id/default
 * and Create both go through setFrontLabelDefault.
 */
import { db, pool, productLabelSettingsTable } from "@workspace/db";
import { frontLabelName, type LabelRole } from "@workspace/product-labels";
import { encodePng, renderFrontLabel } from "@workspace/product-labels/render";
import {
  buildRoleLabel, fitSummary, fonts, labelPublishBlockers, loadLiveVersion, loadRecipe, loadSettingsRow, renderProof, settingsFromRow,
} from "./product-labels-store";

export type PublishOutcome =
  | { ok: true; versionNo: number; publishedByName: string | null }
  | { ok: false; status: number; error: string; blockers?: string[] };

export async function publishRecipeLabel(
  recipeId: number,
  role: LabelRole,
  expectedHash: string,
  who: { id: number | null; name: string | null },
): Promise<PublishOutcome> {
  const recipe = await loadRecipe(recipeId);
  if (!recipe) return { ok: false, status: 404, error: "Recipe not found" };
  // Rebuild on the server — never trust what the page sent.
  const current = await buildRoleLabel(recipe, role);
  if (!current) return { ok: false, status: 404, error: `${recipe.name} has no wrapping label.` };
  if (current.hash !== expectedHash) {
    return { ok: false, status: 409, error: "The label changed while you were checking it (someone edited the recipe or the template). Look at the new proof and confirm again." };
  }
  const proof = renderProof(current.snapshot);
  const blockers = labelPublishBlockers(current, proof);
  if (blockers.length) return { ok: false, status: 422, error: "This label can't go live yet.", blockers };
  const live = await loadLiveVersion(recipe.id, role);
  if (live && live.snapshotHash === current.hash) return { ok: false, status: 409, error: "The live label is already this version." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise publishes of one recipe so version numbers can't collide.
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [20261010, recipe.id]);
    // Each label role has its own version numbers (migration 0310).
    const { rows } = await client.query<{ next: number }>(
      "SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM product_label_versions WHERE recipe_id = $1 AND role = $2", [recipe.id, role],
    );
    const versionNo = Number(rows[0].next);
    await client.query(
      `INSERT INTO product_label_versions
         (recipe_id, recipe_name, role, version_no, snapshot, snapshot_hash, fit, template_id, template_version, published_by_id, published_by_name,
          proof_png, proof_dpi)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [recipe.id, recipe.name, role, versionNo, JSON.stringify(current.snapshot), current.hash, JSON.stringify(fitSummary(proof)),
        current.template.id, current.template.version, who.id, who.name,
        // The exact image going live (dated today, the publish day) — the
        // label history shows this, never a later re-draw (migration 0172).
        Buffer.from(encodePng(proof.bitmap)), proof.layout.dpi],
    );
    await client.query("COMMIT");
    return { ok: true, versionNo, publishedByName: who.name };
  } catch (err) {
    await client.query("ROLLBACK").catch(e => console.error("[product-labels] rollback failed:", e));
    throw err;
  } finally {
    client.release();
  }
}

/** Make the printed front name label the product's front label (or stop
 *  it being). The caller checks the recipe exists. */
export async function setFrontLabelDefault(recipeId: number, on: boolean): Promise<void> {
  await db.insert(productLabelSettingsTable).values({ recipeId, frontLabelPrinted: on })
    .onConflictDoUpdate({ target: productLabelSettingsTable.recipeId, set: { frontLabelPrinted: on } });
}

/** The front label's name (the recipe's label name, or its name) and
 *  whether it is switched on as the product's front label. */
export async function frontLabelNameFor(recipeId: number): Promise<{ id: number; recipeName: string; name: string; isDefault: boolean } | null> {
  const recipe = await loadRecipe(recipeId);
  if (!recipe) return null;
  const row = await loadSettingsRow(recipe.id);
  const settings = settingsFromRow(row);
  return { id: recipe.id, recipeName: recipe.name, name: frontLabelName(settings.labelName, recipe.name), isDefault: !!row?.frontLabelPrinted };
}

/** The front label as the label page draws it (no second line). */
export async function frontLabelProof(recipeId: number): Promise<{ name: string; isDefault: boolean; canPrint: boolean; png: string | null } | null> {
  const r = await frontLabelNameFor(recipeId);
  if (!r) return null;
  const { png, layout } = renderFrontLabel({ name: r.name, secondLine: null }, fonts());
  return { name: r.name, isDefault: r.isDefault, canPrint: layout.ok, png: layout.ok ? png : null };
}
