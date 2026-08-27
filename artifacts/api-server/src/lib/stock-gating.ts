// Stock gate — automatically holds products back from next-day delivery.
//
// Every cycle the poller recomputes, per product, the same number the pack
// report shows: surplus = (fridge stock + packs still to wrap today) − packs
// still to go out on today's dispatch. Fulfilling an order moves both sides
// equally, so the surplus only shrinks when NEW orders land — exactly the
// event we're defending against. When it reaches the threshold, the product
// gets a Shopify tag; a Zapiet product-specific preparation-time rule keyed
// to that tag (2 days) removes tomorrow from the delivery-date picker. When
// the surplus recovers past the release bar, the tag comes off.
//
// Safety:
//   • stock_gate_enabled defaults to false; nothing runs until switched on.
//   • stock_gate_dry_run defaults to true: holds are computed and recorded
//     but no Shopify tag is written — flip it off once the Zapiet rule is
//     confirmed on live.
//   • Shopify writes go through shouldSkipSideEffect() like every other
//     outbound side-effect, so staging never touches the live store.
//   • Only holds created here are released here. A tag added by hand in
//     Shopify admin is invisible to this table and never touched.
//
// After tagging, later cycles verify through Zapiet's own calendar API that
// tomorrow really disappeared for that product (compared against an empty-cart
// baseline, so a day Zapiet wasn't offering anyway records "skipped" rather
// than a false failure). The check REPEATS with a settling period — a single
// early reading was producing false negatives on holds that were working.
// See lib/stock-gate-verify.ts.

import { db, stockGateHoldsTable, appSettingsTable } from "@workspace/db";
import { sql, eq, isNull, desc, inArray } from "drizzle-orm";
import { londonDateString } from "./london-time";
import { isStaging, shouldSkipSideEffect, logSkippedSideEffect } from "./app-env";
import { shouldVerify, nextVerifyStatus, CONFIDENCE_ATTEMPTS } from "./stock-gate-verify";

// ── Settings ────────────────────────────────────────────────────────────────

export type StockGateSettings = {
  enabled: boolean;
  dryRun: boolean;
  thresholdPacks: number;
  releasePacks: number;
  autoRelease: boolean;
  tag: string;
  intervalMinutes: number;
  zapietLocationId: string;
  /** Recipe ids explicitly opted OUT of the gate (on top of the built-in
   *  scope of core-menu / fridge-held recipes). Frozen lines live here until
   *  their stock recording is reliable (Graeme, 2026-08-26). */
  excludedRecipeIds: number[];
};

const KEYS = {
  enabled: "stock_gate_enabled",
  dryRun: "stock_gate_dry_run",
  thresholdPacks: "stock_gate_threshold_packs",
  releasePacks: "stock_gate_release_packs",
  autoRelease: "stock_gate_auto_release",
  tag: "stock_gate_tag",
  intervalMinutes: "stock_gate_interval_minutes",
  zapietLocationId: "stock_gate_zapiet_location_id",
  excludedRecipeIds: "stock_gate_excluded_recipe_ids",
} as const;

const DEFAULTS: StockGateSettings = {
  enabled: false,
  dryRun: true,
  thresholdPacks: 5,
  releasePacks: 10,
  autoRelease: true,
  tag: "low-stock-hold",
  intervalMinutes: 5,
  zapietLocationId: "270812",
  excludedRecipeIds: [],
};

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "true";
}
function parseNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function getStockGateSettings(): Promise<StockGateSettings> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, Object.values(KEYS)));
  const map = new Map(rows.map(r => [r.key, r.value ?? undefined]));
  return {
    enabled: parseBool(map.get(KEYS.enabled), DEFAULTS.enabled),
    dryRun: parseBool(map.get(KEYS.dryRun), DEFAULTS.dryRun),
    thresholdPacks: parseNum(map.get(KEYS.thresholdPacks), DEFAULTS.thresholdPacks),
    releasePacks: parseNum(map.get(KEYS.releasePacks), DEFAULTS.releasePacks),
    autoRelease: parseBool(map.get(KEYS.autoRelease), DEFAULTS.autoRelease),
    tag: (map.get(KEYS.tag) || DEFAULTS.tag).trim(),
    intervalMinutes: Math.max(1, parseNum(map.get(KEYS.intervalMinutes), DEFAULTS.intervalMinutes)),
    zapietLocationId: (map.get(KEYS.zapietLocationId) || DEFAULTS.zapietLocationId).trim(),
    excludedRecipeIds: (map.get(KEYS.excludedRecipeIds) ?? "")
      .split(",")
      .map(v => Number(v.trim()))
      .filter(n => Number.isInteger(n) && n > 0),
  };
}

export async function setStockGateSettings(patch: Partial<Record<keyof typeof KEYS, string>>): Promise<void> {
  for (const [field, value] of Object.entries(patch)) {
    const key = KEYS[field as keyof typeof KEYS];
    if (!key || typeof value !== "string") continue;
    await db.insert(appSettingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
  }
}

// ── Shopify: variant → product resolution and product tagging ───────────────

type ProductRef = { productGid: string; productId: string; title: string };

async function resolveProductForVariant(variantId: string): Promise<ProductRef | null> {
  const { shopifyGraphQL } = await import("../services/shopify");
  const data = await shopifyGraphQL<{
    nodes: Array<{ id: string; product: { id: string; title: string } } | null>;
  }>(
    `query ($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant { id product { id title } }
      }
    }`,
    { ids: [`gid://shopify/ProductVariant/${variantId}`] },
  );
  const node = data.nodes.find(n => n && n.product);
  if (!node) return null;
  return {
    productGid: node.product.id,
    productId: node.product.id.split("/").pop() ?? "",
    title: node.product.title,
  };
}

async function setProductTag(productGid: string, tag: string, add: boolean): Promise<void> {
  if (shouldSkipSideEffect()) {
    logSkippedSideEffect(add ? "stock-gate.tagsAdd" : "stock-gate.tagsRemove", { productGid, tag });
    return;
  }
  const { shopifyGraphQL } = await import("../services/shopify");
  const mutation = add ? "tagsAdd" : "tagsRemove";
  const data = await shopifyGraphQL<Record<string, { userErrors: Array<{ message: string }> }>>(
    `mutation ($id: ID!, $tags: [String!]!) {
      ${mutation}(id: $id, tags: $tags) { userErrors { field message } }
    }`,
    { id: productGid, tags: [tag] },
  );
  const errs = data[mutation]?.userErrors ?? [];
  if (errs.length > 0) {
    throw new Error(`Shopify ${mutation}: ${errs.map(e => e.message).join("; ")}`);
  }
}

// ── Zapiet verification ─────────────────────────────────────────────────────

type CartItem = { variant_id: number; product_id: number; quantity: number };

async function zapietCalendar(locationId: string, cart: CartItem[]): Promise<{ minDate?: string; disabled?: unknown[] } | null> {
  const apiKey = process.env["ZAPIET_API_KEY"];
  const shop = process.env["SHOPIFY_STORE_DOMAIN"];
  if (!apiKey || !shop) return null;
  const url = `https://api.zapiet.com/v1.0/delivery/locations/${locationId}/calendar?shop=${shop}&api_key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shoppingCart: cart }),
  });
  if (!res.ok) throw new Error(`Zapiet calendar HTTP ${res.status}`);
  return (await res.json()) as { minDate?: string; disabled?: unknown[] };
}

function nextCalendarDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** True when `dateStr` is not selectable in a Zapiet calendar response —
 *  either before minDate or listed in `disabled` (as [year, monthIndex, day]
 *  triplets; plain integers in that array are disabled weekdays, ignored
 *  here because minDate/triplets cover the date-specific cases we create). */
function zapietDateBlocked(cal: { minDate?: string; disabled?: unknown[] }, dateStr: string): boolean {
  if (cal.minDate && dateStr < cal.minDate) return true;
  const [y, m, d] = dateStr.split("-").map(Number);
  return (cal.disabled ?? []).some(entry =>
    Array.isArray(entry) && entry[0] === y && entry[1] === m - 1 && entry[2] === d
  );
}

/** Check through Zapiet's own calendar API that tomorrow is gone for this
 *  product. Returns a verify_status + note. */
async function verifyTomorrowBlocked(
  locationId: string,
  variantId: string,
  productId: string,
): Promise<{ status: "verified" | "failed" | "skipped"; note: string }> {
  const tomorrow = nextCalendarDay(londonDateString());
  const cart: CartItem[] = [{ variant_id: Number(variantId), product_id: Number(productId), quantity: 1 }];
  const withProduct = await zapietCalendar(locationId, cart);
  if (!withProduct) return { status: "skipped", note: "ZAPIET_API_KEY or SHOPIFY_STORE_DOMAIN not set" };
  if (zapietDateBlocked(withProduct, tomorrow)) {
    return { status: "verified", note: `Zapiet confirms ${tomorrow} unavailable (minDate ${withProduct.minDate ?? "?"})` };
  }
  // Not blocked with the product in the cart — but maybe tomorrow isn't
  // offered at all today (weekend/holiday), which would make this check
  // meaningless rather than a failure.
  const baseline = await zapietCalendar(locationId, []);
  if (baseline && zapietDateBlocked(baseline, tomorrow)) {
    return { status: "skipped", note: `${tomorrow} not offered for any product today` };
  }
  return { status: "failed", note: `Zapiet still offers ${tomorrow} — check the preparation-time rule for the tag` };
}

// ── Core cycle ──────────────────────────────────────────────────────────────

export type StockGateLastRun = {
  at: string;
  trigger: "timer" | "manual";
  ok: boolean;
  note: string;
  productsChecked: number;
  activeHolds: number;
  held: string[];
  released: string[];
};

let lastRun: StockGateLastRun | null = null;
export function getStockGateLastRun(): StockGateLastRun | null {
  return lastRun;
}

async function loadMainVariantIds(recipeIds: number[]): Promise<Map<number, string>> {
  if (recipeIds.length === 0) return new Map();
  const result = await db.execute<{ recipe_id: number; shopify_variant_id: string }>(sql`
    SELECT recipe_id, shopify_variant_id
    FROM recipe_shopify_mappings
    WHERE recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
  `);
  return new Map(result.rows.map(r => [Number(r.recipe_id), String(r.shopify_variant_id)]));
}

export async function releaseHold(
  hold: { id: number; productGid: string | null; tag: string; dryRun: boolean },
  releasedBy: string,
  surplusAtRelease: number | null,
): Promise<void> {
  if (!hold.dryRun && hold.productGid) {
    await setProductTag(hold.productGid, hold.tag, false);
  }
  await db.update(stockGateHoldsTable)
    .set({ releasedAt: new Date(), releasedBy, surplusAtRelease })
    .where(eq(stockGateHoldsTable.id, hold.id));
}

export async function runStockGateCycle(trigger: "timer" | "manual"): Promise<StockGateLastRun> {
  const startedAt = new Date().toISOString();
  const held: string[] = [];
  const released: string[] = [];
  let note = "ok";
  let productsChecked = 0;

  const settings = await getStockGateSettings();
  try {
    if (!settings.enabled) {
      const active = await db.select({ id: stockGateHoldsTable.id }).from(stockGateHoldsTable).where(isNull(stockGateHoldsTable.releasedAt));
      lastRun = { at: startedAt, trigger, ok: true, note: "gate disabled", productsChecked: 0, activeHolds: active.length, held, released };
      return lastRun;
    }

    // Same engine as the Create Plan screen and the pack report.
    const { calculatePlanData } = await import("../routes/production-plans");
    const today = londonDateString();
    const data = await calculatePlanData(today);
    type Row = {
      recipeId: number | null;
      recipeName: string;
      fridgeStock: number;
      remainingWrappingPacksToday: number;
      dispatch2RemainingQty?: number;
      dispatch2Qty: number;
      salesSource: "shopify" | "dpt";
    };
    const allRows = (data.recipes as Row[]).filter(r => r.recipeId != null);

    // Scope: only recipes whose fridge stock the system actually tracks —
    // core menu and fridge-held products — minus any explicit opt-outs.
    // Frozen lines (fried chicken, cinnamon buns) run on kanban and have no
    // live counts, so gating them held products on fictional surpluses
    // (2026-08-26). Re-inclusion later is: fix the stock recording, then
    // untick the exclusion in Settings.
    const scopeRes = await db.execute<{ id: number }>(sql`
      SELECT id FROM recipes WHERE is_core_menu = TRUE OR is_fridge_product = TRUE
    `);
    const scopedIds = new Set(scopeRes.rows.map(r => Number(r.id)));
    const excluded = new Set(settings.excludedRecipeIds);
    const inScope = (rid: number) => scopedIds.has(rid) && !excluded.has(rid);
    const rows = allRows.filter(r => inScope(r.recipeId as number));

    const activeHolds = await db.select().from(stockGateHoldsTable).where(isNull(stockGateHoldsTable.releasedAt));
    const holdByRecipe = new Map(activeHolds.map(h => [h.recipeId, h]));
    const variantByRecipe = await loadMainVariantIds(rows.map(r => r.recipeId as number));

    // Holds on recipes no longer in scope are released immediately — a
    // product we can't measure must not stay blocked on a stale number.
    for (const h of activeHolds) {
      if (inScope(h.recipeId)) continue;
      try {
        await releaseHold(h, "auto (out of gate scope)", null);
        holdByRecipe.delete(h.recipeId);
        released.push(`${h.recipeName} (out of scope)`);
      } catch (err) {
        console.error(`[stock-gate] out-of-scope release failed for ${h.recipeName}:`, err);
      }
    }

    for (const row of rows) {
      const recipeId = row.recipeId as number;
      // Only real Shopify order counts can drive the gate — a DPT estimate
      // says nothing about live demand, and an unmapped recipe has no
      // product to tag anyway.
      const variantId = variantByRecipe.get(recipeId);
      if (row.salesSource !== "shopify" || !variantId) continue;
      productsChecked++;

      const surplus = Math.round(
        row.fridgeStock + row.remainingWrappingPacksToday - (row.dispatch2RemainingQty ?? row.dispatch2Qty),
      );
      const hold = holdByRecipe.get(recipeId);

      if (!hold && surplus <= settings.thresholdPacks) {
        let product: ProductRef | null = null;
        try {
          product = await resolveProductForVariant(variantId);
        } catch (err) {
          console.error(`[stock-gate] product lookup failed for ${row.recipeName}:`, err);
        }
        if (!product) continue;
        if (!settings.dryRun) {
          try {
            await setProductTag(product.productGid, settings.tag, true);
          } catch (err) {
            console.error(`[stock-gate] tagging failed for ${row.recipeName}:`, err);
            continue; // no hold row for a tag that never landed
          }
        }
        await db.insert(stockGateHoldsTable).values({
          recipeId,
          recipeName: row.recipeName,
          tag: settings.tag,
          productGid: product.productGid,
          productTitle: product.title,
          shopifyVariantId: variantId,
          surplusAtHold: surplus,
          thresholdAtHold: settings.thresholdPacks,
          dryRun: settings.dryRun,
          verifyStatus: settings.dryRun ? "skipped" : null,
          verifyNote: settings.dryRun ? "dry run — no tag written" : null,
        }).onConflictDoNothing();
        held.push(row.recipeName);
        console.log(`[stock-gate] HOLD ${row.recipeName}: surplus ${surplus} ≤ ${settings.thresholdPacks}${settings.dryRun ? " (dry run)" : ""}`);
      } else if (hold && settings.autoRelease && surplus >= settings.releasePacks) {
        try {
          await releaseHold(hold, "auto", surplus);
          released.push(row.recipeName);
          console.log(`[stock-gate] RELEASE ${row.recipeName}: surplus ${surplus} ≥ ${settings.releasePacks}`);
        } catch (err) {
          console.error(`[stock-gate] release failed for ${row.recipeName}:`, err);
        }
      }
    }

    // Verify holds tagged on a previous cycle: has Zapiet actually pulled
    // tomorrow? This is a REPEATED check with a settling period — see
    // lib/stock-gate-verify.ts for why one early reading isn't evidence.
    const now = new Date();
    const dueForVerify = activeHolds.filter(h => shouldVerify(h, now));
    for (const h of dueForVerify) {
      try {
        const productId = h.productGid!.split("/").pop() ?? "";
        const v = await verifyTomorrowBlocked(settings.zapietLocationId, h.shopifyVariantId!, productId);
        const attempts = h.verifyAttempts + 1;
        const status = nextVerifyStatus(v.status, h, attempts, new Date());
        await db.update(stockGateHoldsTable)
          .set({
            verifyStatus: status,
            // Say what we actually observed, and how many times. "Not
            // blocking" was a stronger claim than the check can support.
            verifyNote: status === "unconfirmed"
              ? `${v.note} (check ${attempts} of ${CONFIDENCE_ATTEMPTS} — still settling)`
              : status === "failed"
                ? `${v.note} (still offered after ${attempts} checks)`
                : v.note,
            verifyAttempts: attempts,
            verifyCheckedAt: new Date(),
          })
          .where(eq(stockGateHoldsTable.id, h.id));
        if (status === "failed") console.error(`[stock-gate] VERIFY UNCONFIRMED after ${attempts} checks — ${h.recipeName}: ${v.note}`);
      } catch (err) {
        console.error(`[stock-gate] verify errored for ${h.recipeName}:`, err);
      }
    }
  } catch (err) {
    note = err instanceof Error ? err.message : String(err);
    console.error("[stock-gate] cycle error:", err);
    const active = await db.select({ id: stockGateHoldsTable.id }).from(stockGateHoldsTable).where(isNull(stockGateHoldsTable.releasedAt)).catch(() => []);
    lastRun = { at: startedAt, trigger, ok: false, note, productsChecked, activeHolds: active.length, held, released };
    return lastRun;
  }

  const active = await db.select({ id: stockGateHoldsTable.id }).from(stockGateHoldsTable).where(isNull(stockGateHoldsTable.releasedAt));
  lastRun = { at: startedAt, trigger, ok: true, note, productsChecked, activeHolds: active.length, held, released };
  return lastRun;
}

// ── Status for the API / dashboard ──────────────────────────────────────────

export async function getStockGateStatus() {
  const settings = await getStockGateSettings();
  const active = await db.select().from(stockGateHoldsTable)
    .where(isNull(stockGateHoldsTable.releasedAt))
    .orderBy(desc(stockGateHoldsTable.heldAt));
  const recent = await db.select().from(stockGateHoldsTable)
    .orderBy(desc(stockGateHoldsTable.heldAt))
    .limit(25);
  return {
    settings,
    zapietKeyConfigured: Boolean(process.env["ZAPIET_API_KEY"]),
    lastRun,
    activeHolds: active,
    recent,
  };
}

// ── Poller (govee-poller shape) ─────────────────────────────────────────────

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function loop(): Promise<void> {
  let nextDelayMs = DEFAULTS.intervalMinutes * 60_000;
  try {
    const settings = await getStockGateSettings();
    nextDelayMs = settings.intervalMinutes * 60_000;
    await runStockGateCycle("timer");
  } catch (err) {
    console.error("[stock-gate] loop error:", err);
  } finally {
    if (running) timer = setTimeout(() => { void loop(); }, nextDelayMs);
  }
}

export function startStockGatePoller(): void {
  if (running) return;
  if (isStaging()) {
    console.log("[stock-gate] staging: poller disabled");
    return;
  }
  running = true;
  // First cycle shortly after boot, then on the configured cadence.
  timer = setTimeout(() => { void loop(); }, 20_000);
  console.log("[stock-gate] poller started");
}

export function stopStockGatePoller(): void {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
}
