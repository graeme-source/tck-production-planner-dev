/**
 * Test box launch steps the app does after the products (Graeme, 2026-10-02):
 *   "Create the Shopify collection" — a smart collection named for the box,
 *     rule product tag = box name, sort order copied from the previous box's
 *     collection. Waits until "Decide on recipes" is ticked AND every recipe
 *     has a linked Shopify product.
 *   "Create the 20% discount code" — one shared code (CCOCT26-7K2P9Q style),
 *     20% off that collection only, settings copied from the last test-box
 *     code. Waits for the collection.
 * Each has a read-only status (the preview) and a guarded create; both are
 * idempotent (the ids live on the box, and an existing collection is found by
 * title / handle before one is made). Objectives A and I.
 */
import { db, testBoxesTable, testBoxTasksTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { shopifyAdminUrl, ShopifyWritesBlockedError } from "../services/shopify";
import { launchTaskKey } from "./test-box-launch-checklist";
import { scheduleForBox, type Actor } from "./test-box-data";
import { RunRefused, boxLinkState, tickEarnedLaunchSteps, type Ticks } from "./test-box-shopify-run";
import {
  collectionGid, createBoxCollection, createDiscountCode, discountCodeTaken, fetchAccessScopes, fetchCollections,
  fetchEarlierCodes, fetchTemplateCandidates, type ShopifyPort,
} from "./test-box-shopify";
import {
  DISCOUNT_WRITE_SCOPES, chooseTemplate, findBoxCollection, missingWriteScopes, newCollectionSettings, previousBoxCollection,
  templateSearchQuery,
} from "./test-box-shopify-rules";
import {
  collectionGate, describeSettings, discountCodePrefix, discountGate, discountInput, endOfLondonDay, generateDiscountCode,
  isTestBoxCode, settingsFromPrevious, suggestedEndDate,
} from "./test-box-discount-rules";

const blockedMessage = () => new ShopifyWritesBlockedError("preview").message;

async function loadBox(boxId: number) {
  const [box] = await db.select().from(testBoxesTable).where(eq(testBoxesTable.id, boxId));
  if (!box || box.deletedAt) throw new RunRefused(404, "Test box not found");
  return box;
}

async function recipesDecided(boxId: number): Promise<boolean> {
  const [t] = await db.select({ done: testBoxTasksTable.done }).from(testBoxTasksTable)
    .where(and(eq(testBoxTasksTable.testBoxId, boxId), eq(testBoxTasksTable.taskKey, launchTaskKey("decide-recipes"))));
  return t?.done === true;
}

// ── Collection ──────────────────────────────────────────────────────────────
export interface CollectionStatus {
  boxName: string;
  existing: { title: string; adminUrl: string } | null;
  plan: { title: string; rule: string; sortOrder: string; copiedFrom: string | null };
  gate: string | null;
  missingScopes: string[];
  writesBlocked: boolean;
  blockedMessage: string | null;
}

async function collectionContext(boxId: number, port: ShopifyPort, writesBlocked: boolean) {
  const box = await loadBox(boxId);
  const [scopes, collections, candidates, links, decided] = await Promise.all([
    fetchAccessScopes(port), fetchCollections(port), fetchTemplateCandidates(port, templateSearchQuery()),
    boxLinkState(db, boxId), recipesDecided(boxId),
  ]);
  const existing = findBoxCollection(box.name, box.shopifyCollectionId, collections);
  // The previous box's collection, found through the last test-box product's tags.
  const tpl = chooseTemplate({ candidates, boxName: box.name });
  const tplTags = candidates.find(c => c.productId === tpl.productId)?.tags ?? [];
  const settings = newCollectionSettings(box.name, previousBoxCollection(tplTags, box.name, collections));
  const status: CollectionStatus = {
    boxName: box.name,
    existing: existing ? { title: existing.title, adminUrl: shopifyAdminUrl("collections", existing.id) } : null,
    plan: { title: settings.title, rule: `product tag is equal to '${box.name}'`, sortOrder: settings.sortOrder, copiedFrom: settings.copiedFrom },
    gate: collectionGate({ recipesDecided: decided, recipeCount: links.recipeIds.length, linkedCount: links.linkedRecipeIds.length }),
    missingScopes: missingWriteScopes(scopes),
    writesBlocked,
    blockedMessage: writesBlocked ? blockedMessage() : null,
  };
  return { box, existing, settings, status };
}

export async function collectionStatus(boxId: number, port: ShopifyPort, writesBlocked: boolean): Promise<CollectionStatus> {
  return (await collectionContext(boxId, port, writesBlocked)).status;
}

export async function runCreateCollection(boxId: number, user: Actor, port: ShopifyPort, writesBlocked: boolean): Promise<{
  outcome: "created" | "exists"; title: string; adminUrl: string; ticked: Ticks;
}> {
  const { box, existing, settings, status } = await collectionContext(boxId, port, writesBlocked);
  if (existing) {
    // Already there (made by hand, or by an earlier run) — remember it, never make a second.
    if (box.shopifyCollectionId !== existing.id) {
      await db.update(testBoxesTable).set({ shopifyCollectionId: existing.id }).where(eq(testBoxesTable.id, boxId));
    }
    return { outcome: "exists", title: existing.title, adminUrl: shopifyAdminUrl("collections", existing.id), ticked: await tickEarnedLaunchSteps(boxId, user) };
  }
  if (status.gate) throw new RunRefused(409, status.gate);
  if (!writesBlocked && status.missingScopes.length) {
    throw new RunRefused(409, `Shopify hasn't given the app permission to create collections yet (missing: ${status.missingScopes.join(", ")}). Nothing was changed.`);
  }
  const id = await createBoxCollection(port, settings);
  await db.update(testBoxesTable).set({ shopifyCollectionId: id }).where(eq(testBoxesTable.id, boxId));
  return { outcome: "created", title: settings.title, adminUrl: shopifyAdminUrl("collections", id), ticked: await tickEarnedLaunchSteps(boxId, user) };
}

// ── Discount code ───────────────────────────────────────────────────────────
export interface DiscountStatus {
  boxName: string;
  existing: { code: string; endsOn: string | null; adminUrl: string | null } | null;
  proposedCode: string | null;
  settingsLines: string[];
  copiedFrom: string | null;
  suggestedEndOn: string | null;
  collectionTitle: string;
  gate: string | null;
  missingScopes: string[];
  writesBlocked: boolean;
  blockedMessage: string | null;
}

/** A code with the box's prefix that Shopify doesn't already have. */
async function freeCode(port: ShopifyPort, launchDate: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generateDiscountCode(launchDate);
    if (!(await discountCodeTaken(port, code))) return code;
  }
  throw new Error("Couldn't find an unused discount code after 5 tries");
}

export async function discountStatus(boxId: number, port: ShopifyPort, writesBlocked: boolean, endOn?: string | null): Promise<DiscountStatus> {
  const box = await loadBox(boxId);
  const schedule = await scheduleForBox(db, box);
  const suggestedEndOn = suggestedEndDate(schedule.deliveries);
  const base = {
    boxName: box.name, collectionTitle: box.name, suggestedEndOn, writesBlocked, blockedMessage: writesBlocked ? blockedMessage() : null,
  };
  if (box.discountCode) {
    return {
      ...base, existing: { code: box.discountCode, endsOn: box.discountEndsOn, adminUrl: box.shopifyDiscountId ? shopifyAdminUrl("discounts", box.shopifyDiscountId) : null },
      proposedCode: null, settingsLines: [], copiedFrom: null, gate: null, missingScopes: [],
    };
  }
  const [scopes, earlier] = await Promise.all([fetchAccessScopes(port), fetchEarlierCodes(port)]);
  const settings = settingsFromPrevious(earlier);
  const gate = discountGate({ collectionExists: box.shopifyCollectionId != null, existingCode: null });
  return {
    ...base,
    existing: null,
    proposedCode: gate ? null : await freeCode(port, box.launchDate),
    settingsLines: describeSettings(settings, box.name, endOn ?? null),
    copiedFrom: settings.copiedFrom,
    gate,
    missingScopes: missingWriteScopes(scopes, DISCOUNT_WRITE_SCOPES),
  };
}

export async function runCreateDiscount(
  boxId: number, proposedCode: string, endOn: string | null, user: Actor, port: ShopifyPort, writesBlocked: boolean,
): Promise<{ code: string; endsOn: string | null; adminUrl: string; regenerated: boolean; ticked: Ticks }> {
  const box = await loadBox(boxId);
  if (box.discountCode) {
    // Made already — the same code back, never a second one.
    return {
      code: box.discountCode, endsOn: box.discountEndsOn, adminUrl: box.shopifyDiscountId ? shopifyAdminUrl("discounts", box.shopifyDiscountId) : "",
      regenerated: false, ticked: await tickEarnedLaunchSteps(boxId, user),
    };
  }
  const gate = discountGate({ collectionExists: box.shopifyCollectionId != null, existingCode: null });
  if (gate) throw new RunRefused(409, gate);
  const [scopes, earlier] = await Promise.all([fetchAccessScopes(port), fetchEarlierCodes(port)]);
  const missing = missingWriteScopes(scopes, DISCOUNT_WRITE_SCOPES);
  if (!writesBlocked && missing.length) {
    throw new RunRefused(409, `Shopify hasn't given the app permission to create discount codes yet (missing: ${missing.join(", ")}). Nothing was changed.`);
  }
  const settings = settingsFromPrevious(earlier);
  const prefixOk = isTestBoxCode(proposedCode) && proposedCode.startsWith(`${discountCodePrefix(box.launchDate)}-`);
  let code = prefixOk ? proposedCode : generateDiscountCode(box.launchDate);
  let regenerated = !prefixOk;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await discountCodeTaken(port, code)) { code = generateDiscountCode(box.launchDate); regenerated = true; continue; }
    const r = await createDiscountCode(port, discountInput({
      code, collectionGid: collectionGid(box.shopifyCollectionId!), settings,
      startsAt: new Date().toISOString(), endsAt: endOn ? endOfLondonDay(endOn) : null,
    }));
    if (r === "taken") { code = generateDiscountCode(box.launchDate); regenerated = true; continue; }
    await db.update(testBoxesTable).set({ discountCode: code, shopifyDiscountId: r.id, discountEndsOn: endOn }).where(eq(testBoxesTable.id, boxId));
    return { code, endsOn: endOn, adminUrl: shopifyAdminUrl("discounts", r.id), regenerated, ticked: await tickEarnedLaunchSteps(boxId, user) };
  }
  throw new Error("Shopify said every code tried was taken — try again");
}
