/**
 * What a back-label print would be, for the PDF route (routes/product-
 * label-print.ts) and the print-bridge route (routes/back-label-jobs.ts)
 * alike: which label prints, whether it may, and the dates on it. One copy
 * of the production rules — live label only, and only while it still
 * matches the recipe; production day from the plan item in the database.
 */
import { db, productionPlanItemsTable, productionPlansTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildPrintRecord, printRefusal, testPrintSource, TEST_STAMP_TEXT, type LabelRole, type LabelSnapshot, type PrintRecord, type PrintRefusal } from "@workspace/product-labels";
import { proofLabel, proofPng, stampTest } from "@workspace/product-labels/render";
import { londonDateString } from "./london-time";
import { buildRoleLabel, fonts, loadLiveVersion, loadRecipe } from "./product-labels-store";

/** The plan item's production day (and plan), checked against the recipe. */
async function planDay(planItemId: number | undefined, recipeId: number): Promise<{ planId: number | null; planItemId: number | null; productionDate: string } | { error: string }> {
  if (!planItemId) return { planId: null, planItemId: null, productionDate: londonDateString() };
  const [row] = await db
    .select({ planId: productionPlanItemsTable.planId, recipeId: productionPlanItemsTable.recipeId, planDate: productionPlansTable.planDate })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlansTable.id, productionPlanItemsTable.planId))
    .where(eq(productionPlanItemsTable.id, planItemId));
  if (!row) return { error: "That plan item doesn't exist." };
  if (row.recipeId !== recipeId) return { error: "That plan item is a different recipe." };
  return { planId: row.planId, planItemId, productionDate: String(row.planDate).slice(0, 10) };
}

/** Everything both endpoints need: which label prints, whether it may, and today's run. */
export async function prepare(recipeId: number, planItemId: number | undefined, test: boolean, role: LabelRole = "main") {
  const recipe = await loadRecipe(recipeId);
  if (!recipe) return { status: 404 as const, error: "Recipe not found" };
  // A test print is dated today, whatever plan it might belong to.
  const plan = await planDay(test ? undefined : planItemId, recipeId);
  if ("error" in plan) return { status: 400 as const, error: plan.error };
  const current = await buildRoleLabel(recipe, role);
  if (!current) return { status: 404 as const, error: `${recipe.name} has no wrapping label.` };
  const live = await loadLiveVersion(recipeId, role);
  const printDate = londonDateString();
  const matchesLive = !!live && live.snapshotHash === current.hash;

  const stamped = test && testPrintSource({ hasLive: !!live }) === "current-stamped";
  const snapshot: LabelSnapshot | null = live ? (live.snapshot as LabelSnapshot) : test ? current.snapshot : null;
  const proof = snapshot ? proofLabel(snapshot, { printDate, productionDate: plan.productionDate }, fonts()) : null;
  if (proof && stamped) for (const page of proof.pages) stampTest(page, fonts(), TEST_STAMP_TEXT);

  const refusal: PrintRefusal | null = test
    ? (proof?.layout.fits ? null : "doesnt-fit")
    : printRefusal({ hasLive: !!live, matchesLive, fits: proof?.layout.fits ?? false });
  return {
    status: 200 as const, role, recipe, plan, live, matchesLive, current, snapshot, proof, refusal, printDate, stamped,
    png: proof ? (stamped ? proofPng(proof) : proof.png) : null,
  };
}

export type Prepared = Extract<Awaited<ReturnType<typeof prepare>>, { status: 200 }>;

/** The product_label_prints record for a run of `count` packs. */
export async function printRecordFor(r: Prepared, count: number, test: boolean, userId: number | null): Promise<PrintRecord> {
  if (!r.proof) throw new Error("Can't print this label.");
  const [u] = userId ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)) : [];
  return buildPrintRecord({
    recipe: { id: r.recipe.id, name: r.recipe.name },
    live: r.live && !r.stamped
      ? { id: r.live.id, versionNo: r.live.versionNo, snapshotHash: r.live.snapshotHash }
      : { id: null, versionNo: null, snapshotHash: r.current.hash },
    count,
    dates: r.proof.dates,
    plan: { planId: r.plan.planId, planItemId: r.plan.planItemId },
    format: "pdf",
    kind: test ? "test" : "production",
    user: { id: userId, name: u?.name ?? null },
  });
}
