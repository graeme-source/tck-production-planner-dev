/**
 * Barcodes — the database side (Graeme, 2026-10-10). Objectives A and F.
 *
 * sku_barcodes holds ONE barcode claim per Shopify variant and is the source
 * of truth for scanning. Who may actually SCAN with a code is decided on
 * every read by the identity rule (@workspace/barcodes identity.ts): one
 * code = one product; retired products never claim one; a current-vs-current
 * clash keeps it for at most one product. The packing scanner (both scan
 * paths), the pack label and the recipe page all read through loadOwnership()
 * — so they always agree, and a barcode saved in the app scans at once.
 *
 * Shopify is only ever READ: the one-time pull fills empty barcodes, the
 * hourly check records what Shopify has ("Different in Shopify" —
 * informational, Shopify's barcode also feeds Google Shopping GTINs) and
 * keeps unlinked products' copies in step. Nothing here writes to Shopify.
 *
 * Every decision is made by the pure, tested @workspace/barcodes; this file
 * only loads, writes and logs.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, appSettingsTable, recipesTable, skuBarcodesTable, barcodeEventsTable, packingScanRejectionsTable, type SkuBarcode } from "@workspace/db";
import {
  countOutcomes, decidePull, deriveLinkedVariants, describeClash, groupBarcode, gtinKey, identitiesFor, isDifferentInShopify,
  kindLabel, checkGtin, planAssignment, planScanBarcodes, resolveOwnership, clubSpecialScan, isClubSpecialTitle, suggestF2fLinks,
  type AlsoAccepts, type ClubSpecialScan, type CopyLink,
  type BarcodeHolder, type BarcodeMap, type Clash, type Holding, type Identity, type KnownCodes, type LinkKind, type LinkedVariant,
  type MappingRow, type Ownership, type PullCounts, type PullDecision, type Reuse,
} from "@workspace/barcodes";
import { getProducts, getVariantBarcodeDetails } from "../services/shopify";

export interface Actor { id: number | null; name: string | null }

// ── Loading ─────────────────────────────────────────────────────────────────

interface MappingFull extends MappingRow { packSize: number | null; recipeActive: boolean }

/** recipe_shopify_mappings has no Drizzle schema (boot DDL) — raw SQL. */
export async function loadMappings(): Promise<MappingFull[]> {
  const r = await db.execute<{ recipe_id: number; name: string; pack_size: string | null; active: boolean; shopify_variant_id: string; wonky_variant_id: string | null; eight_pack_variant_id: string | null }>(sql`
    SELECT m.recipe_id, r.name, r.pack_size, (r.archived_at IS NULL AND NOT r.is_draft) AS active,
           m.shopify_variant_id, m.wonky_variant_id, m.eight_pack_variant_id
      FROM recipe_shopify_mappings m
      JOIN recipes r ON r.id = m.recipe_id
     ORDER BY m.recipe_id, m.created_at
  `);
  return r.rows.map(row => ({
    recipeId: row.recipe_id,
    recipeName: row.name,
    packSize: row.pack_size == null ? null : Number(row.pack_size),
    recipeActive: !!row.active,
    shopifyVariantId: String(row.shopify_variant_id),
    wonkyVariantId: row.wonky_variant_id,
    eightPackVariantId: row.eight_pack_variant_id,
  }));
}

export const variantName = (r: Pick<SkuBarcode, "productTitle" | "variantTitle"> | undefined, fallback: string): string => {
  if (!r) return fallback;
  const v = r.variantTitle && r.variantTitle !== "Default Title" ? r.variantTitle : null;
  return [r.productTitle, v].filter(Boolean).join(" · ") || fallback;
};

type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface CurrentSpecial { recipeId: number; recipeName: string }

/** The recipe flagged is_current_special — what the Calzone Club Special
 *  delivers (and so scans as). */
export async function loadCurrentSpecial(exec: Exec = db): Promise<CurrentSpecial | null> {
  const [row] = await exec.select({ id: recipesTable.id, name: recipesTable.name }).from(recipesTable)
    .where(eq(recipesTable.isCurrentSpecial, true)).limit(1);
  return row ? { recipeId: row.id, recipeName: row.name } : null;
}

export interface OwnershipState {
  mappings: MappingFull[];
  rows: SkuBarcode[];
  byVariant: Map<string, SkuBarcode>;
  links: LinkedVariant[];
  linkOf: Map<string, LinkedVariant>;
  ambiguousBags: string[];
  identities: Map<string, Identity>;
  currentOf: Map<string, boolean>;
  ownership: Ownership;
  special: CurrentSpecial | null;
  /** Calzone Club Special listings: what each scans with (copies.ts). */
  clubSpecial: Map<string, ClubSpecialScan>;
}

/** Is a variant CURRENT? Linked to an active recipe, or its Shopify product
 *  is active. Before the first check (status unknown) it counts as current —
 *  the safe default that keeps today's scanning working. */
function isCurrent(link: LinkedVariant | undefined, recipeActive: Map<number, boolean>, status: string | null | undefined): boolean {
  if (link && recipeActive.get(link.recipeId)) return true;
  if (status == null) return true;
  return status === "active";
}

/** Build identities, holdings and ownership from rows (optionally with
 *  proposed barcodes and statuses, for a dry run). */
function ownershipFrom(
  mappings: MappingFull[],
  rows: Array<SkuBarcode>,
  links: LinkedVariant[],
  special: CurrentSpecial | null,
  override?: { barcode: Map<string, string | null>; status: Map<string, string | null>; shopify: Map<string, string | null> },
): { identities: Map<string, Identity>; currentOf: Map<string, boolean>; ownership: Ownership; clubSpecial: Map<string, ClubSpecialScan> } {
  const linkOf = new Map(links.map(l => [l.variantId, l]));
  const recipeActive = new Map(mappings.map(m => [m.recipeId, m.recipeActive]));
  const names = new Map(rows.map(r => [r.variantId, variantName(r, `Shopify variant ${r.variantId}`)]));
  const sameAs = new Map(rows.filter(r => r.sameProductAs).map(r => [r.variantId, r.sameProductAs!]));
  const ids = new Set([...rows.map(r => r.variantId), ...links.map(l => l.variantId), ...(override?.barcode.keys() ?? [])]);
  // The Calzone Club Special's listings ARE the current special's pack.
  const clubIds = new Set(rows.filter(r => isClubSpecialTitle(r.productTitle)).map(r => r.variantId));
  const identities = identitiesFor(ids, links, sameAs, names, new Map(mappings.map(m => [m.recipeId, m.packSize])),
    special ? { variantIds: clubIds, recipeId: special.recipeId, recipeName: special.recipeName } : null);
  const byVariant = new Map(rows.map(r => [r.variantId, r]));
  const currentOf = new Map<string, boolean>();
  const holdings: Holding[] = [];
  for (const id of ids) {
    const row = byVariant.get(id);
    const link = linkOf.get(id);
    const status = override?.status.has(id) ? override.status.get(id) : row?.shopifyProductStatus;
    const current = isCurrent(link, recipeActive, status);
    currentOf.set(id, current);
    const ours = override?.barcode.has(id) ? override.barcode.get(id)! : row?.barcode ?? null;
    const shopify = override?.shopify.has(id) ? override.shopify.get(id)! : row?.shopifyBarcode ?? null;
    // The Club Special never claims a code of its own (it follows the
    // special, below), so it can never clash.
    if (clubIds.has(id)) continue;
    holdings.push({
      variantId: id, name: names.get(id) ?? `Shopify variant ${id}`,
      // A retired variant never owns a code (resolveOwnership), but the code
      // it still carries in Shopify is listed as a reused one.
      barcode: current ? ours : ours ?? shopify,
      identity: identities.get(id)!, current,
      setInApp: row?.barcodeSource === "app" || row?.barcodeSource === "label",
      linkKind: link?.kind,
    });
  }
  const ownership = resolveOwnership(holdings);

  // Club Special: scans with the current special's pack code; during a
  // changeover it also accepts the incoming special's code (copies.ts).
  const clubSpecial = new Map<string, ClubSpecialScan>();
  if (clubIds.size) {
    const specialKey = special ? `r${special.recipeId}:pack` : null;
    const specialCode = special
      ? groupBarcode(links.filter(l => l.recipeId === special.recipeId && l.kind === "pack").map(l => ownership.barcodeOf.get(l.variantId))).barcode
      : null;
    const known: KnownCodes = {};
    for (const [vid, code] of ownership.barcodeOf) if (code) known[gtinKey(code)] = { identityKey: identities.get(vid)!.key, name: identities.get(vid)!.name };
    for (const id of clubIds) {
      const shopify = override?.shopify.has(id) ? override.shopify.get(id)! : byVariant.get(id)?.shopifyBarcode ?? null;
      const scan = clubSpecialScan(specialCode, specialKey, shopify, known);
      clubSpecial.set(id, scan);
      ownership.barcodeOf.set(id, currentOf.get(id) ? scan.barcode : null);
      if (!currentOf.get(id)) scan.alsoAccepts = [];
    }
  }
  return { identities, currentOf, ownership, clubSpecial };
}

export async function loadOwnership(exec: Exec = db): Promise<OwnershipState> {
  const [mappings, rows, special] = await Promise.all([loadMappings(), exec.select().from(skuBarcodesTable), loadCurrentSpecial(exec)]);
  const { links, ambiguousBags } = deriveLinkedVariants(mappings, rows.map(r => ({ variantId: r.variantId, productId: r.shopifyProductId, variantTitle: r.variantTitle })));
  const o = ownershipFrom(mappings, rows, links, special);
  return { mappings, rows, byVariant: new Map(rows.map(r => [r.variantId, r])), links, linkOf: new Map(links.map(l => [l.variantId, l])), ambiguousBags, special, ...o };
}

// ── Views ───────────────────────────────────────────────────────────────────

export interface VariantView {
  variantId: string;
  name: string;
  /** What the scanner and label use (after the identity rule). */
  barcode: string | null;
  /** Our stored claim, when it differs from what may be used. */
  claimed: string | null;
  /** Why the claim can't be used (a clash with another current product). */
  heldBack: string | null;
  /** Why ours fails the GTIN check digit (still used; flagged). */
  invalid: string | null;
  current: boolean;
  source: string | null;
  setByName: string | null;
  setAt: Date | null;
  shopifyBarcode: string | null;
  shopifyCheckedAt: Date | null;
  notInShopify: boolean;
  differentInShopify: boolean;
  sameProductAs: string | null;
}

export interface GroupView {
  recipeId: number;
  recipeName: string;
  kind: LinkKind;
  label: string;
  /** Identity name: "The Godfather · 2-pack". */
  productName: string;
  /** The barcode every listing in the group scans with (null = none or mixed). */
  barcode: string | null;
  mixed: boolean;
  variants: VariantView[];
}

function clashFor(code: string, clashes: Clash[]): Clash | undefined {
  const k = gtinKey(code);
  return clashes.find(c => gtinKey(c.barcode) === k);
}

function variantView(variantId: string, s: OwnershipState): VariantView {
  const row = s.byVariant.get(variantId);
  const barcode = s.ownership.barcodeOf.get(variantId) ?? null;
  const claimed = row?.barcode ?? null;
  const g = barcode ? checkGtin(barcode) : null;
  const shopifyCheckedAt = row?.shopifyCheckedAt ?? null;
  const notInShopify = row?.shopifyMissing ?? false;
  const current = s.currentOf.get(variantId) ?? true;
  let heldBack: string | null = null;
  if (claimed && !barcode) {
    const c = clashFor(claimed, s.ownership.clashes);
    heldBack = !current ? "An old (retired) product — it doesn't claim a barcode." : c ? describeClash(c) : "Held back.";
  }
  return {
    variantId,
    name: variantName(row, `Shopify variant ${variantId}`),
    barcode,
    claimed: claimed !== barcode ? claimed : null,
    heldBack,
    invalid: g && !g.ok ? g.reason : null,
    current,
    source: row?.barcodeSource ?? null,
    setByName: row?.barcodeSetByName ?? null,
    setAt: row?.barcodeSetAt ?? null,
    shopifyBarcode: row?.shopifyBarcode ?? null,
    shopifyCheckedAt,
    notInShopify,
    // The Club Special follows the current special — never "different".
    differentInShopify: !s.clubSpecial.has(variantId) && isDifferentInShopify({ ours: claimed, shopifyBarcode: row?.shopifyBarcode ?? null, shopifyCheckedAt, notInShopify }),
    sameProductAs: row?.sameProductAs ?? null,
  };
}

function groupsOf(s: OwnershipState, recipeId?: number): GroupView[] {
  const packSize = new Map(s.mappings.map(m => [m.recipeId, m.packSize]));
  const groups = new Map<string, GroupView>();
  for (const l of s.links) {
    if (recipeId != null && l.recipeId !== recipeId) continue;
    const key = `${l.recipeId}:${l.kind}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        recipeId: l.recipeId, recipeName: l.recipeName, kind: l.kind, label: kindLabel(l.kind, packSize.get(l.recipeId)),
        productName: s.identities.get(l.variantId)?.name ?? l.recipeName, barcode: null, mixed: false, variants: [],
      };
      groups.set(key, g);
    }
    g.variants.push(variantView(l.variantId, s));
  }
  for (const g of groups.values()) Object.assign(g, groupBarcode(g.variants.map(v => v.barcode)));
  return [...groups.values()];
}

export async function loadGroups(recipeId?: number): Promise<{ groups: GroupView[]; ambiguousBags: string[] }> {
  const s = await loadOwnership();
  return { groups: groupsOf(s, recipeId), ambiguousBags: s.ambiguousBags };
}

/** The barcode each recipe's pack label prints: what its pack listings SCAN
 *  with (batch form for the labels list). */
export async function loadPackBarcodes(): Promise<Map<number, { barcode: string | null; mixed: boolean }>> {
  const s = await loadOwnership();
  const out = new Map<number, { barcode: string | null; mixed: boolean }>();
  for (const g of groupsOf(s)) if (g.kind === "pack") out.set(g.recipeId, { barcode: g.barcode, mixed: g.mixed });
  return out;
}

export async function packBarcodeFor(recipeId: number): Promise<{ barcode: string | null; mixed: boolean }> {
  const s = await loadOwnership();
  const g = groupsOf(s, recipeId).find(x => x.kind === "pack");
  return g ? { barcode: g.barcode, mixed: g.mixed } : { barcode: null, mixed: false };
}

/** The overview: clashes needing a decision, reused codes (information),
 *  and every group. */
export async function loadOverview() {
  const s = await loadOwnership();
  const lastChecked = s.rows.reduce<Date | null>((a, r) => (r.shopifyCheckedAt && (!a || r.shopifyCheckedAt > a) ? r.shopifyCheckedAt : a), null);
  return {
    lastCheckedAt: lastChecked,
    firstPullAt: await firstPullAt(),
    groups: groupsOf(s),
    clashes: s.ownership.clashes.map(c => ({ ...c, message: describeClash(c) })),
    reused: s.ownership.reused,
    ambiguousBags: s.ambiguousBags.map(id => ({ variantId: id, name: variantName(s.byVariant.get(id), id) })),
    clubSpecial: clubSpecialViews(s),
    f2fSuggestions: f2fSuggestions(s),
  };
}

export interface ClubSpecialView {
  variantId: string;
  name: string;
  current: boolean;
  /** "The Benji · 2-pack", or null when no special is set. */
  scansAs: string | null;
  barcode: string | null;
  shopifyBarcode: string | null;
  /** Shopify already has the incoming special's code — expected. */
  changing: boolean;
  alsoAccepts: AlsoAccepts[];
  /** Shopify's code is neither special's pack — worth a look, not a clash. */
  unexpected: boolean;
}

function clubSpecialViews(s: OwnershipState): ClubSpecialView[] {
  return [...s.clubSpecial].map(([id, scan]) => {
    const row = s.byVariant.get(id);
    return {
      variantId: id, name: variantName(row, id), current: s.currentOf.get(id) ?? true,
      scansAs: s.special ? s.identities.get(id)?.name ?? null : null,
      barcode: s.ownership.barcodeOf.get(id) ?? null, shopifyBarcode: row?.shopifyBarcode ?? null,
      changing: scan.changing, alsoAccepts: scan.alsoAccepts, unexpected: scan.unexpected,
    };
  });
}

/** F2F copies to mark "same product as" their recipe's pack (copies.ts) —
 *  a reviewed list; nothing changes until a person applies it. */
export function f2fSuggestions(s: OwnershipState): CopyLink[] {
  const packs = s.links.filter(l => l.kind === "pack").map(l => ({
    variantId: l.variantId, recipeId: l.recipeId, name: variantName(s.byVariant.get(l.variantId), l.variantId),
    productName: s.identities.get(l.variantId)?.name ?? l.recipeName, barcode: s.ownership.barcodeOf.get(l.variantId) ?? null,
  }));
  const candidates = s.rows.map(r => ({
    variantId: r.variantId, name: variantName(r, r.variantId), productTitle: r.productTitle, current: s.currentOf.get(r.variantId) ?? true,
    linked: s.linkOf.has(r.variantId), sameProductAs: r.sameProductAs, barcode: r.barcode ?? r.shopifyBarcode,
  }));
  return suggestF2fLinks(candidates, packs);
}

/** Apply the F2F list: mark each chosen copy "same product as" its
 *  recipe's pack — only those still suggested now (re-checked here). */
export async function applyF2fLinks(variantIds: string[], actor: Actor): Promise<CopyLink[]> {
  const wanted = new Set(variantIds);
  const applied: CopyLink[] = [];
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261011)`);
    const s = await loadOwnership(tx);
    for (const link of f2fSuggestions(s)) {
      if (!wanted.has(link.variantId)) continue;
      await tx.update(skuBarcodesTable).set({ sameProductAs: link.sameAs, updatedAt: new Date() }).where(eq(skuBarcodesTable.variantId, link.variantId));
      await logEvent({ variantId: link.variantId, recipeId: link.recipeId, productName: link.name, action: "same-product", oldBarcode: link.barcode, newBarcode: link.barcode, result: "ok", message: `F2F copy — marked the same product as ${link.sameAsName}`, actor }, tx);
      applied.push(link);
    }
  });
  return applied;
}

// ── Packing scanner ─────────────────────────────────────────────────────────

export interface ScanMap {
  version: string | null;
  /** variant id → the barcode it scans with (resolved — one code, one product). */
  barcodes: BarcodeMap;
  /** variant id → product identity key. */
  identities: Record<string, string>;
  /** gtinKey(code) → the product it belongs to, for "Wrong item — this is …". */
  known: KnownCodes;
  /** variant id → other codes it accepts (the Club Special during a changeover). */
  alsoAccepts: Record<string, AlsoAccepts[]>;
}

export function scanMapFrom(s: OwnershipState): ScanMap {
  const barcodes: BarcodeMap = {};
  const identities: Record<string, string> = {};
  const known: KnownCodes = {};
  let latest = 0;
  for (const r of s.rows) latest = Math.max(latest, r.updatedAt.getTime());
  for (const [id, identity] of s.identities) identities[id] = identity.key;
  for (const [id, code] of s.ownership.barcodeOf) {
    if (!code) continue;
    barcodes[id] = code;
    const identity = s.identities.get(id)!;
    known[gtinKey(code)] = { identityKey: identity.key, name: identity.name };
  }
  const alsoAccepts: Record<string, AlsoAccepts[]> = {};
  for (const [id, scan] of s.clubSpecial) if (scan.alsoAccepts.length) alsoAccepts[id] = scan.alsoAccepts;
  return { version: latest ? new Date(latest).toISOString() : null, barcodes, identities, known, alsoAccepts };
}

export async function scanMap(): Promise<ScanMap> {
  return scanMapFrom(await loadOwnership());
}

/** Barcodes for the scan queue's variants: from our table (resolved);
 *  Shopify is read only for a variant we hold no row for, and what it
 *  returns is stored (logged as 'scan-fill') so from then on it is ours. A
 *  failed Shopify read leaves that variant without a barcode. */
export async function scanQueueBarcodes(variantIds: string[]): Promise<BarcodeMap> {
  if (!variantIds.length) return {};
  const rows = await db.select({ variantId: skuBarcodesTable.variantId, barcode: skuBarcodesTable.barcode })
    .from(skuBarcodesTable).where(inArray(skuBarcodesTable.variantId, variantIds));
  const plan = planScanBarcodes(variantIds, new Map(rows.map(r => [r.variantId, r.barcode])));
  if (plan.askShopify.length) {
    try {
      const live = await getVariantBarcodeDetails(plan.askShopify);
      const now = new Date();
      for (const [variantId, d] of live) {
        const barcode = (d.barcode ?? "").trim() || null;
        const inserted = await db.insert(skuBarcodesTable).values({
          variantId, barcode, shopifyProductId: d.productId, shopifyBarcode: barcode, shopifyCheckedAt: now,
          barcodeSource: "shopify", barcodeSetAt: barcode ? now : null, barcodeSetByName: barcode ? "Packing scan queue" : null,
        }).onConflictDoNothing().returning({ variantId: skuBarcodesTable.variantId });
        if (barcode && inserted.length) await logEvent({ variantId, action: "scan-fill", newBarcode: barcode, result: "ok", message: "not in our table yet — read from Shopify once and stored" });
      }
    } catch (err) {
      console.error("[barcodes] scan-queue Shopify fallback failed:", err instanceof Error ? err.message : err);
    }
  }
  const s = await loadOwnership();
  const out: BarcodeMap = {};
  for (const id of variantIds) { const b = s.ownership.barcodeOf.get(id); if (b) out[id] = b; }
  return out;
}

export async function logScanRejection(e: { actor: Actor; orderId: string | null; orderName: string | null; code: string; kind: string; message: string | null }): Promise<void> {
  await db.insert(packingScanRejectionsTable).values({
    userId: e.actor.id, userName: e.actor.name, orderId: e.orderId, orderName: e.orderName, code: e.code, kind: e.kind, message: e.message,
  });
}

export async function loadScanRejections(limit = 100) {
  return db.select().from(packingScanRejectionsTable).orderBy(desc(packingScanRejectionsTable.createdAt)).limit(limit);
}

// ── Log ────────────────────────────────────────────────────────────────────

type EventAction = "set" | "move" | "use-shopify" | "same-product" | "pull-fill" | "follow" | "scan-fill";

async function logEvent(e: { variantId: string; recipeId?: number | null; productName?: string | null; action: EventAction; oldBarcode?: string | null; newBarcode?: string | null; result: "ok" | "refused"; message?: string | null; actor?: Actor | null }, exec: Exec = db): Promise<void> {
  await exec.insert(barcodeEventsTable).values({
    variantId: e.variantId, recipeId: e.recipeId ?? null, productName: e.productName ?? null, action: e.action,
    oldBarcode: e.oldBarcode ?? null, newBarcode: e.newBarcode ?? null, result: e.result, message: e.message ?? null,
    userId: e.actor?.id ?? null, userName: e.actor?.name ?? null,
  });
}

export async function loadEvents(opts: { recipeId?: number; limit?: number }) {
  const where = opts.recipeId != null ? eq(barcodeEventsTable.recipeId, opts.recipeId) : undefined;
  return db.select().from(barcodeEventsTable).where(where).orderBy(desc(barcodeEventsTable.createdAt)).limit(opts.limit ?? 50);
}

// ── Set / move in the app ───────────────────────────────────────────────────

export class BarcodeRefused extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}

function holdersFrom(s: OwnershipState, exclude: Set<string>): BarcodeHolder[] {
  // The Club Special holds no code of its own (it follows the special).
  return s.rows.filter(r => !exclude.has(r.variantId) && !s.clubSpecial.has(r.variantId)).map(r => {
    const current = s.currentOf.get(r.variantId) ?? true;
    const identity = s.identities.get(r.variantId)!;
    return {
      variantId: r.variantId, name: variantName(r, r.variantId), identityKey: identity.key, identityName: identity.name, current,
      ours: current ? r.barcode : null,
      shopify: r.shopifyBarcode ?? (current ? null : r.barcode),
    };
  });
}

/** Write `code` onto `ids` (set by a person), after releasing it from
 *  `release` — all in the caller's transaction, all logged. */
async function assign(tx: Exec, s: OwnershipState, ids: string[], code: string, release: string[], movedTo: string, actor: Actor, recipeId: number | null, action: "set" | "use-shopify", extra: Partial<typeof skuBarcodesTable.$inferInsert> = {}) {
  const now = new Date();
  for (const id of release) {
    const row = s.byVariant.get(id);
    // Released rows become app-owned, so the hourly check won't hand the
    // code straight back from Shopify.
    await tx.update(skuBarcodesTable).set({ barcode: null, barcodeSource: "app", barcodeSetAt: now, barcodeSetById: actor.id, barcodeSetByName: actor.name, updatedAt: now }).where(eq(skuBarcodesTable.variantId, id));
    await logEvent({ variantId: id, recipeId: s.linkOf.get(id)?.recipeId ?? null, productName: variantName(row, id), action: "move", oldBarcode: row?.barcode ?? null, newBarcode: null, result: "ok", message: `moved to ${movedTo}`, actor }, tx);
  }
  for (const id of ids) {
    const row = s.byVariant.get(id);
    if (row?.barcode === code && (action === "set" ? row.barcodeSource === "app" || row.barcodeSource === "label" : true) && !Object.keys(extra).length) continue;
    const set = { barcode: code, barcodeSource: action === "set" ? "app" : "shopify", barcodeSetAt: now, barcodeSetById: actor.id, barcodeSetByName: actor.name, updatedAt: now, ...extra };
    await tx.insert(skuBarcodesTable).values({ variantId: id, ...set }).onConflictDoUpdate({ target: skuBarcodesTable.variantId, set });
    await logEvent({ variantId: id, recipeId, productName: variantName(row, id), action, oldBarcode: row?.barcode ?? null, newBarcode: code, result: "ok", actor }, tx);
  }
}

export interface Confirmations { move?: boolean; take?: boolean }

/** Set one barcode for every listing in a recipe's group (its pack
 *  listings, its 8-pack bag, its wonky pack). A code another product holds
 *  is moved only with the person's confirmation(s) — see planAssignment. */
export async function setGroupBarcode(recipeId: number, kind: LinkKind, input: string, actor: Actor, confirmed: Confirmations): Promise<GroupView | null> {
  let refusal: BarcodeRefused | null = null;
  await db.transaction(async tx => {
    // One barcode change at a time, so two people can't give two products
    // the same number in the same instant.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261011)`);
    const s = await loadOwnership(tx);
    const ids = s.links.filter(l => l.recipeId === recipeId && l.kind === kind).map(l => l.variantId);
    if (ids.length === 0) throw new BarcodeRefused(404, "That recipe has no Shopify listing of that kind linked.");
    const identity = s.identities.get(ids[0])!;
    const plan = planAssignment(input, { identityKey: identity.key, name: identity.name }, holdersFrom(s, new Set(ids)), confirmed);
    if (!plan.ok) {
      if ("confirm" in plan) { refusal = new BarcodeRefused(409, plan.reason, { confirm: plan.confirm, holders: plan.holders }); return; }
      for (const id of ids) await logEvent({ variantId: id, recipeId, productName: variantName(s.byVariant.get(id), id), action: "set", oldBarcode: s.byVariant.get(id)?.barcode, newBarcode: input.trim() || null, result: "refused", message: plan.reason, actor }, tx);
      refusal = new BarcodeRefused(422, plan.reason);
      return; // commit the refusal log; nothing else changed
    }
    await assign(tx, s, ids, plan.digits, plan.release, identity.name, actor, recipeId, "set");
  });
  if (refusal) throw refusal;
  const { groups } = await loadGroups(recipeId);
  return groups.find(g => g.kind === kind) ?? null;
}

/** "Use Shopify's": take Shopify's barcode for this variant's whole group
 *  (read live). Same move/confirm rules as typing it. */
export async function useShopifyBarcode(variantId: string, actor: Actor, confirmed: Confirmations): Promise<void> {
  const live = await getVariantBarcodeDetails([variantId]);
  const d = live.get(variantId);
  if (!d) throw new BarcodeRefused(404, "That variant isn't in Shopify any more.");
  const theirs = (d.barcode ?? "").trim();
  if (!theirs) throw new BarcodeRefused(409, "Shopify has no barcode on this variant — there's nothing to use.");
  let refusal: BarcodeRefused | null = null;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261011)`);
    const s = await loadOwnership(tx);
    const me = s.linkOf.get(variantId);
    const ids = me ? s.links.filter(l => l.recipeId === me.recipeId && l.kind === me.kind).map(l => l.variantId) : [variantId];
    const identity = s.identities.get(variantId) ?? { key: `v${variantId}`, name: variantId };
    const plan = planAssignment(theirs, { identityKey: identity.key, name: identity.name }, holdersFrom(s, new Set(ids)), confirmed);
    if (!plan.ok) {
      refusal = "confirm" in plan
        ? new BarcodeRefused(409, plan.reason, { confirm: plan.confirm, holders: plan.holders })
        : new BarcodeRefused(422, `Shopify's barcode ${theirs} can't be used: ${plan.reason}. Fix it in Shopify, or type the right number here.`);
      return;
    }
    const now = new Date();
    await assign(tx, s, ids, plan.digits, plan.release, identity.name, actor, me?.recipeId ?? null, "use-shopify", { shopifyProductId: d.productId, shopifyCheckedAt: now, shopifyMissing: false });
    await tx.update(skuBarcodesTable).set({ shopifyBarcode: theirs }).where(eq(skuBarcodesTable.variantId, variantId));
  });
  if (refusal) throw refusal;
}

/** "Same product as": this listing is the same physical product as another
 *  (an F2F / CFF / discounted copy), so it may share that product's code.
 *  null clears it. */
export async function setSameProductAs(variantId: string, target: string | null, actor: Actor): Promise<void> {
  if (target === variantId) throw new BarcodeRefused(422, "A listing can't be the same product as itself.");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261011)`);
    const s = await loadOwnership(tx);
    const row = s.byVariant.get(variantId);
    if (!row) throw new BarcodeRefused(404, "We hold nothing for that variant yet — run Check Shopify now first.");
    if (target && !s.byVariant.has(target) && !s.linkOf.has(target)) throw new BarcodeRefused(404, "The other listing isn't known yet.");
    await tx.update(skuBarcodesTable).set({ sameProductAs: target, updatedAt: new Date() }).where(eq(skuBarcodesTable.variantId, variantId));
    const targetName = target ? (s.identities.get(target)?.name ?? target) : null;
    await logEvent({ variantId, recipeId: target ? s.linkOf.get(target)?.recipeId ?? null : null, productName: variantName(row, variantId), action: "same-product", oldBarcode: row.barcode, newBarcode: row.barcode, result: "ok", message: targetName ? `marked the same product as ${targetName}` : "no longer marked the same product as another", actor }, tx);
  });
}

// ── Pull (one-time) and hourly check — Shopify is only READ ─────────────────

export interface PullItem {
  variantId: string;
  name: string;
  recipeId: number;
  recipeName: string;
  kind: LinkKind;
  outcome: PullDecision["outcome"];
  ours: string | null;
  shopify: string | null;
  invalid: string | null;
}

export interface PullReport {
  mode: "pull" | "check";
  dryRun: boolean;
  at: string;
  linkedVariants: number;
  counts: PullCounts;
  /** Variants not linked to a recipe whose copy followed Shopify. */
  followed: number;
  /** Retired variants whose stored barcode is no longer claimed. */
  retiredCleared: number;
  /** Linked variants only. */
  items: PullItem[];
  /** After this run: current-vs-current clashes (a decision is needed). */
  clashes: Array<Clash & { message: string }>;
  /** After this run: retired products still holding a reused code (information). */
  reused: Reuse[];
  ambiguousBags: Array<{ variantId: string; name: string }>;
}

/** app_settings key: when the one-time pull last ran for real. */
export const FIRST_PULL_KEY = "barcodes_first_pull_at";

export async function firstPullAt(): Promise<string | null> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, FIRST_PULL_KEY));
  return row?.value ?? null;
}

let running: Promise<PullReport> | null = null;

/** One run at a time; a second caller waits for the first, then runs. */
export async function reconcileBarcodes(opts: { mode: "pull" | "check"; dryRun: boolean; actor: Actor | null }): Promise<PullReport> {
  while (running) await running.catch(() => undefined);
  const run = runReconcile(opts);
  running = run;
  try { return await run; } finally { if (running === run) running = null; }
}

/** Why a barcode fails the GTIN check — ours first, then Shopify's. */
function invalidReason(ours: string | null, theirs: string | null): string {
  for (const [who, code] of [["Ours", ours], ["Shopify's", theirs]] as const) {
    if (!code) continue;
    const g = checkGtin(code);
    if (!g.ok) return `${who} (${code}): ${g.reason}`;
  }
  return "Check digit wrong";
}

async function runReconcile({ mode, dryRun, actor }: { mode: "pull" | "check"; dryRun: boolean; actor: Actor | null }): Promise<PullReport> {
  const startedAt = new Date();
  const [products, mappings, rows] = await Promise.all([getProducts(), loadMappings(), db.select().from(skuBarcodesTable)]);

  interface Live { productId: string; productTitle: string; status: string; variantTitle: string; sku: string | null; barcode: string | null; imageUrl: string | null }
  const live = new Map<string, Live>();
  for (const p of products) {
    // Variant.image_id points at one of product.images; fall back to the
    // featured image — the packing thumbnail just needs to look like the pack.
    const imageById = new Map(p.images.map(img => [img.id, img.src]));
    for (const v of p.variants) {
      live.set(String(v.id), {
        productId: String(p.id), productTitle: p.title, status: p.status, variantTitle: v.title, sku: v.sku || null,
        barcode: (v.barcode ?? "").trim() || null,
        imageUrl: (v.image_id && imageById.get(v.image_id)) || p.image?.src || null,
      });
    }
  }
  // Links from Shopify's CURRENT products (so a new bag is found today).
  const { links, ambiguousBags } = deriveLinkedVariants(mappings, [...live].map(([variantId, l]) => ({ variantId, productId: l.productId, variantTitle: l.variantTitle })));
  const linkOf = new Map(links.map(l => [l.variantId, l]));
  const byVariant = new Map(rows.map(r => [r.variantId, r]));
  const recipeActive = new Map(mappings.map(m => [m.recipeId, m.recipeActive]));

  const ids = new Set<string>([...live.keys(), ...links.map(l => l.variantId)]);
  const items: PullItem[] = [];
  const linkedDecisions: PullDecision[] = [];
  const proposed = { barcode: new Map<string, string | null>(), status: new Map<string, string | null>(), shopify: new Map<string, string | null>() };
  let followed = 0;
  let retiredCleared = 0;

  for (const id of ids) {
    const row = byVariant.get(id);
    const l = live.get(id);
    const link = linkOf.get(id);
    const current = isCurrent(link, recipeActive, l?.status ?? row?.shopifyProductStatus);
    const decision = decidePull({
      mode, linked: !!link, current, setInApp: row?.barcodeSource === "app" || row?.barcodeSource === "label",
      ours: row?.barcode ?? null, shopify: l ? { barcode: l.barcode } : null,
    });
    const name = l ? variantName({ productTitle: l.productTitle, variantTitle: l.variantTitle }, id) : variantName(row, `Shopify variant ${id}`);
    if (l) { proposed.status.set(id, l.status); proposed.shopify.set(id, l.barcode); }
    if (link) {
      linkedDecisions.push(decision);
      items.push({
        variantId: id, name, recipeId: link.recipeId, recipeName: link.recipeName, kind: link.kind, outcome: decision.outcome,
        ours: row?.barcode ?? null, shopify: l?.barcode ?? null,
        invalid: decision.invalid ? invalidReason(decision.setOurs ?? row?.barcode ?? null, l?.barcode ?? null) : null,
      });
    } else if (decision.outcome === "followed") {
      followed++;
    }
    if (decision.outcome === "retired" && decision.setOurs === null) retiredCleared++;
    const isNewRow = !row && l && (link || (l.barcode && current));
    if (decision.setOurs !== undefined && (row || isNewRow)) proposed.barcode.set(id, decision.setOurs);
    else if (isNewRow) proposed.barcode.set(id, null);
    if (dryRun) continue;

    const now = new Date();
    if (l) {
      // Catalogue + what Shopify has — never over a newer "Use Shopify's".
      const catalogue = {
        sku: l.sku, productTitle: l.productTitle, variantTitle: l.variantTitle, imageUrl: l.imageUrl, shopifyProductId: l.productId,
        shopifyProductStatus: l.status, shopifyBarcode: l.barcode, shopifyCheckedAt: now, shopifyMissing: false,
      };
      if (!row) {
        // New rows: every linked variant (so its empty field shows), and any
        // other CURRENT variant with a barcode (what the old sync stored).
        if (!isNewRow) continue;
        await db.insert(skuBarcodesTable).values({
          variantId: id, ...catalogue, barcode: decision.setOurs ?? null, barcodeSource: "shopify",
          barcodeSetAt: decision.setOurs ? now : null, barcodeSetByName: decision.setOurs ? (actor?.name ?? "Shopify check") : null,
        }).onConflictDoNothing();
        if (decision.setOurs) await logEvent({ variantId: id, recipeId: link?.recipeId, productName: name, action: link ? "pull-fill" : "follow", newBarcode: decision.setOurs, result: "ok", actor });
        continue;
      }
      await db.update(skuBarcodesTable).set(catalogue)
        .where(and(eq(skuBarcodesTable.variantId, id), sql`(${skuBarcodesTable.shopifyCheckedAt} IS NULL OR ${skuBarcodesTable.shopifyCheckedAt} <= ${startedAt})`));
    } else if (row && !row.shopifyMissing) {
      await db.update(skuBarcodesTable).set({ shopifyMissing: true, shopifyCheckedAt: now }).where(eq(skuBarcodesTable.variantId, id));
    }
    if (!row || decision.setOurs === undefined) continue;

    // Ours changes only where the rule says, and only if nobody changed it
    // since this run read it.
    const unchangedSinceRead = and(
      eq(skuBarcodesTable.variantId, id),
      row.barcode == null ? sql`${skuBarcodesTable.barcode} IS NULL` : eq(skuBarcodesTable.barcode, row.barcode),
      eq(skuBarcodesTable.barcodeSource, row.barcodeSource),
    );
    const changed = await db.update(skuBarcodesTable).set({
      barcode: decision.setOurs, barcodeSource: "shopify", barcodeSetAt: now, barcodeSetById: actor?.id ?? null,
      barcodeSetByName: actor?.name ?? "Shopify check", updatedAt: now,
    }).where(unchangedSinceRead).returning({ variantId: skuBarcodesTable.variantId });
    if (changed.length) {
      await logEvent({
        variantId: id, recipeId: link?.recipeId, productName: name, action: link ? "pull-fill" : "follow", oldBarcode: row.barcode,
        newBarcode: decision.setOurs, result: "ok", actor, message: decision.outcome === "retired" ? "old (retired) product — no longer claims a barcode" : null,
      });
    }
  }

  if (mode === "pull" && !dryRun) {
    // The hourly check waits for this: the first write to our table after
    // deploy is Graeme's own pull, not a timer.
    await db.insert(appSettingsTable).values({ key: FIRST_PULL_KEY, value: startedAt.toISOString() })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: startedAt.toISOString(), updatedAt: new Date() } });
  }

  // Clashes and reused codes as they stand after this run (simulated for a dry run).
  const after = dryRun
    ? ownershipFrom(mappings, rows, links, await loadCurrentSpecial(), proposed).ownership
    : (await loadOwnership()).ownership;

  items.sort((a, b) => a.recipeName.localeCompare(b.recipeName, "en-GB") || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return {
    mode, dryRun, at: startedAt.toISOString(),
    linkedVariants: linkedDecisions.length,
    counts: countOutcomes(linkedDecisions),
    followed,
    retiredCleared,
    items,
    clashes: after.clashes.map(c => ({ ...c, message: describeClash(c) })),
    reused: after.reused,
    ambiguousBags: ambiguousBags.map(id => {
      const l = live.get(id);
      return { variantId: id, name: l ? variantName({ productTitle: l.productTitle, variantTitle: l.variantTitle }, id) : id };
    }),
  };
}
