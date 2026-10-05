/**
 * Club Special changeovers — the database + Shopify side. Rules (dates,
 * validation, the Zapiet to-dos) are pure and tested in
 * club-special-rules.ts. Objectives F and I.
 *
 * runDueChangeovers() runs on the special-sync interval (index.ts). For
 * each scheduled changeover whose switch day has come it:
 *   1. claims the row (scheduled → switched; atomic, so two app instances
 *      can't both apply it) and flips recipes.is_current_special;
 *   2. sets the Club Special's Shopify price, if the changeover has one;
 *   3. runs syncSpecialToShopify(), which rewrites the tck.current_special
 *      snapshot (recipe, delivering_from, announcement, what's next) and
 *      moves the current-special product tag.
 * Shopify failures are stored on the row (shopify_error) and retried on the
 * next run; the planner flip itself is never undone.
 */
import { db, appSettingsTable, clubSpecialChangeoversTable, recipesTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { shopifyGraphQL, shopifyGraphQLWrite, shopifyWritesBlocked } from "../services/shopify";
import { londonDateString } from "./london-time";
import { dueChangeovers } from "./club-special-rules";
import { syncSpecialToShopify } from "./special-shopify-sync";

type Row = typeof clubSpecialChangeoversTable.$inferSelect;

/** The Club Special's Shopify product handle (app setting, migration 0148). */
export async function clubSpecialProductHandle(): Promise<string | null> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable)
    .where(eq(appSettingsTable.key, "club_special_product_handle"));
  return row?.value?.trim() || null;
}

interface ClubProduct { productId: string; variants: Array<{ id: string; price: string }> }

export async function loadClubProduct(): Promise<ClubProduct | null> {
  const handle = await clubSpecialProductHandle();
  if (!handle) return null;
  const r = await shopifyGraphQL<{ productByHandle: { id: string; variants: { nodes: Array<{ id: string; price: string }> } } | null }>(
    `query($h: String!) { productByHandle(handle: $h) { id variants(first: 10) { nodes { id price } } } }`,
    { h: handle },
  );
  if (!r.productByHandle) return null;
  return { productId: r.productByHandle.id, variants: r.productByHandle.variants.nodes };
}

/** Current Club Special price in pence (first variant), or null. */
export async function currentClubPricePence(): Promise<number | null> {
  const p = await loadClubProduct();
  const price = p?.variants[0]?.price;
  return price != null ? Math.round(parseFloat(price) * 100) : null;
}

/** Set every Club Special variant to the new price. Returns a problem
 *  description, or null when it went through (or was already right). */
async function setClubPrice(pence: number): Promise<string | null> {
  const p = await loadClubProduct();
  if (!p) return "Couldn't find the Calzone Club Special product in Shopify (app setting club_special_product_handle).";
  const price = (pence / 100).toFixed(2);
  const changes = p.variants.filter(v => Math.round(parseFloat(v.price) * 100) !== pence);
  if (changes.length === 0) return null;
  const r = await shopifyGraphQLWrite<{ productVariantsBulkUpdate: { userErrors: Array<{ message: string }> } | null }>(
    "club-special.price",
    `mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }`,
    { p: p.productId, v: changes.map(v => ({ id: v.id, price })) },
  );
  const errs = r?.productVariantsBulkUpdate?.userErrors ?? [];
  return errs.length ? `Price change refused by Shopify: ${errs.map(e => e.message).join("; ")}` : null;
}

/** Flip the planner's current special to this recipe (one at a time). */
async function makeCurrentSpecial(recipeId: number): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(recipesTable).set({ isCurrentSpecial: false }).where(ne(recipesTable.id, recipeId));
    await tx.update(recipesTable).set({ isCurrentSpecial: true }).where(eq(recipesTable.id, recipeId));
  });
}

/** Apply one changeover now. Returns the stored Shopify problem, if any. */
async function applyChangeover(row: Row): Promise<string | null> {
  const [recipe] = await db.select({ isDraft: recipesTable.isDraft, name: recipesTable.name })
    .from(recipesTable).where(eq(recipesTable.id, row.recipeId));
  if (!recipe || recipe.isDraft) {
    // Leave it scheduled: a draft can't be the special (migration 0142).
    const msg = recipe ? `${recipe.name} is a draft — put it on the menu and it will switch on the next run.` : "The recipe no longer exists.";
    await db.update(clubSpecialChangeoversTable).set({ shopifyError: msg }).where(eq(clubSpecialChangeoversTable.id, row.id));
    return msg;
  }

  // Claim: only the instance that moves it from scheduled gets to apply it.
  const claimed = await db.update(clubSpecialChangeoversTable)
    .set({ status: "switched", switchedAt: new Date() })
    .where(and(eq(clubSpecialChangeoversTable.id, row.id), eq(clubSpecialChangeoversTable.status, "scheduled")))
    .returning({ id: clubSpecialChangeoversTable.id });
  if (claimed.length === 0) return null;

  await makeCurrentSpecial(row.recipeId);
  console.log(`[club-special] switched to ${recipe.name}, delivering from ${row.deliveringFrom}`);
  return pushToShopify(row);
}

/** Shopify half of a changeover (price + snapshot + tag); safe to repeat. */
export async function pushToShopify(row: Row): Promise<string | null> {
  const problems: string[] = [];
  try {
    if (row.clubPricePence != null) {
      const p = await setClubPrice(row.clubPricePence);
      if (p) problems.push(p);
    }
    await syncSpecialToShopify();
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }
  const msg = problems.length ? problems.join(" ") : null;
  await db.update(clubSpecialChangeoversTable).set({ shopifyError: msg }).where(eq(clubSpecialChangeoversTable.id, row.id));
  if (msg) console.error(`[club-special] Shopify update for changeover ${row.id} failed: ${msg}`);
  return msg;
}

/** Switch every changeover whose day has come, then retry any switched
 *  changeover still carrying a Shopify problem (the latest one only). */
export async function runDueChangeovers(today: string = londonDateString()): Promise<void> {
  const rows = await db.select().from(clubSpecialChangeoversTable)
    .where(ne(clubSpecialChangeoversTable.status, "cancelled"));
  for (const row of dueChangeovers(rows, today)) {
    await applyChangeover(row);
  }

  const [latestSwitched] = await db.select().from(clubSpecialChangeoversTable)
    .where(eq(clubSpecialChangeoversTable.status, "switched"))
    .orderBy(sql`${clubSpecialChangeoversTable.deliveringFrom} DESC`)
    .limit(1);
  // Staging refuses Shopify writes by design — don't retry into that wall.
  if (latestSwitched?.shopifyError && !shopifyWritesBlocked()) await pushToShopify(latestSwitched);
}
