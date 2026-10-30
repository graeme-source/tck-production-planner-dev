/**
 * Barcodes — the database side (Graeme, 2026-10-10; two-way 2026-10-12).
 * Objectives A, D and F.
 *
 * sku_barcodes holds ONE barcode claim per Shopify variant and is the source
 * of truth for scanning. Who may actually SCAN with a code is decided on
 * every read by the identity rule (@workspace/barcodes identity.ts): one
 * code = one product; retired products never claim one; a current-vs-current
 * clash keeps it for at most one product. The packing scanner (both scan
 * paths), the pack label and the recipe page all read through loadOwnership()
 * — so they always agree, and a barcode saved in the app scans at once.
 *
 * A barcode can be set before the recipe has a Shopify listing: it is held in
 * recipe_pending_barcodes against the product (recipe + kind), printed on the
 * label at once, and moved onto sku_barcodes when a listing is linked
 * (afterListingLinked) — never both at once.
 *
 * Shopify, both ways (12 Oct 2026):
 *   app → Shopify  every save in the app (typed on the label or recipe page,
 *                  "Use Shopify's", a move, the packing bench, a pull fill,
 *                  a held barcode applied) queues a push of that product's
 *                  listings — barcode-push.ts is the only writer, the rules
 *                  are decidePush (Club Special and archived products never
 *                  written; a different number in Shopify is a disagreement,
 *                  not overwritten; blocked writes = waiting to send).
 *   Shopify → app  the hourly check adopts Shopify's barcode where we have
 *                  none (decidePull), and keeps unlinked products' copies in
 *                  step.
 *   one-time       previewSync() lists what a bulk sync of existing
 *                  differences would change; applySync() does it (admin).
 *
 * Every decision is made by the pure, tested @workspace/barcodes; this file
 * only loads, writes and logs.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, appSettingsTable, recipesTable, skuBarcodesTable, barcodeEventsTable, packingScanRejectionsTable, recipePendingBarcodesTable, usersTable, type SkuBarcode } from "@workspace/db";
import {
  countOutcomes, countSync, decidePull, decideSync, deriveLinkedVariants, describeClash, groupBarcode, gtinKey, identitiesFor, isDifferentInShopify,
  kindLabel, checkGtin, pickShareHolder, planAssignment, planPackerBarcode, planScanBarcodes, resolveOwnership, clubSpecialScan, isClubSpecialTitle, suggestF2fLinks,
  MANAGED_BY_HAND,
  type AlsoAccepts, type ClubSpecialScan, type CopyLink,
  type BarcodeHolder, type BarcodeMap, type Clash, type Holding, type Identity, type KnownCodes, type LinkKind, type LinkedVariant,
  type MappingRow, type Ownership, type PullCounts, type PullDecision, type Reuse, type SyncAction, type SyncCounts,
} from "@workspace/barcodes";
import { getProducts, getVariantBarcodeDetails } from "../services/shopify";
import { pushBarcodes, type PushResult, type PushSink, type PushTarget, type ShopifyBarcodePort } from "./barcode-push";
import { barcodeWritesBlockedReason, liveBarcodePort } from "./barcode-push-live";

export interface Actor { id: number | null; name: string | null }

/** Who is signed in, for the log. */
export async function actorOf(userId: number | null | undefined): Promise<Actor> {
  if (!userId) return { id: null, name: null };
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return { id: userId, name: u?.name ?? null };
}

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

/** A barcode held for a recipe that has no Shopify listing of that kind yet. */
export interface PendingRow {
  recipeId: number;
  recipeName: string;
  packSize: number | null;
  kind: LinkKind;
  barcode: string;
  setByName: string | null;
  setAt: Date;
}

const pendingKey = (recipeId: number, kind: string) => `pending:${recipeId}:${kind}`;
const pendingIdentity = (p: Pick<PendingRow, "recipeId" | "recipeName" | "packSize" | "kind">): Identity => {
  const k = p.kind === "bag" ? "bag" : "pack";
  return { key: `r${p.recipeId}:${k}`, name: `${p.recipeName} · ${kindLabel(k, p.packSize)}` };
};

export async function loadPending(exec: Exec = db): Promise<PendingRow[]> {
  try {
    const r = await exec.execute<{ recipe_id: number; name: string; pack_size: string | null; kind: string; barcode: string; set_by_name: string | null; set_at: string | Date }>(sql`
      SELECT p.recipe_id, r.name, r.pack_size, p.kind, p.barcode, p.set_by_name, p.set_at
        FROM recipe_pending_barcodes p JOIN recipes r ON r.id = p.recipe_id
    `);
    return r.rows.map(row => ({
      recipeId: Number(row.recipe_id), recipeName: row.name, packSize: row.pack_size == null ? null : Number(row.pack_size),
      kind: row.kind as LinkKind, barcode: row.barcode, setByName: row.set_by_name, setAt: new Date(row.set_at),
    }));
  } catch (err) {
    // Before migration 0326 has run (the boot applies it), there is nothing held.
    if ((err as { code?: string })?.code === "42P01") return [];
    throw err;
  }
}

export interface OwnershipState {
  /** Barcodes held for recipes with no listing of that kind yet. */
  pending: PendingRow[];
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

/** Is a variant CURRENT? Linked to an active recipe, its Shopify product
 *  is active, or a PERSON set its barcode in the app. Before the first check
 *  (status unknown) it counts as current — the safe default that keeps
 *  today's scanning working.
 *  The "set by a person" rule (12 Oct 2026): the first-order Order Insert is
 *  a deliberately DRAFT Shopify product, added to new customers' orders and
 *  linked to no recipe — it was judged retired, lost its barcode, and the
 *  packing team couldn't scan it. A barcode someone sets on purpose always
 *  counts. */
export function isCurrent(link: LinkedVariant | undefined, recipeActive: Map<number, boolean>, status: string | null | undefined, setByPerson = false): boolean {
  if (setByPerson) return true;
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
    const current = isCurrent(link, recipeActive, status, row?.barcodeSource === "app" || row?.barcodeSource === "label");
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
  const [mappings, rows, special, pending] = await Promise.all([loadMappings(), exec.select().from(skuBarcodesTable), loadCurrentSpecial(exec), loadPending(exec)]);
  const { links, ambiguousBags } = deriveLinkedVariants(mappings, rows.map(r => ({ variantId: r.variantId, productId: r.shopifyProductId, variantTitle: r.variantTitle })));
  const o = ownershipFrom(mappings, rows, links, special);
  return { pending, mappings, rows, byVariant: new Map(rows.map(r => [r.variantId, r])), links, linkOf: new Map(links.map(l => [l.variantId, l])), ambiguousBags, special, ...o };
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
  /** The last send of ours to Shopify (null = never sent). */
  push: { state: string; barcode: string | null; at: Date | null; message: string | null } | null;
  /** The Calzone Club Special — never synced either way. */
  managedByHand: boolean;
  /** Archived in Shopify — never written to. */
  archived: boolean;
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
  /** No Shopify listing of this kind yet: `barcode` is the one HELD for the
   *  product (recipe_pending_barcodes) — printed on the label, sent to
   *  Shopify when a listing is linked. */
  pending: boolean;
  heldSetByName: string | null;
  heldSetAt: Date | null;
  /** A held barcode that couldn't be moved onto a newly linked listing. */
  heldProblem: string | null;
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
  const managedByHand = s.clubSpecial.has(variantId);
  // Ours is on its way to Shopify (sending, or waiting / failed with Shopify
  // still holding what we're replacing) — a change in flight, not a disagreement.
  const st = row?.shopifyPushState;
  const theirs = row?.shopifyBarcode ?? null;
  const inFlight = st === "sending" || ((st === "waiting" || st === "failed") && (theirs == null || (row?.shopifyPushFrom != null && gtinKey(row.shopifyPushFrom) === gtinKey(theirs))));
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
    differentInShopify: !managedByHand && !inFlight && isDifferentInShopify({ ours: claimed, shopifyBarcode: row?.shopifyBarcode ?? null, shopifyCheckedAt, notInShopify }),
    sameProductAs: row?.sameProductAs ?? null,
    push: row?.shopifyPushState
      ? { state: row.shopifyPushState, barcode: row.shopifyPushBarcode, at: row.shopifyPushAt, message: row.shopifyPushMessage }
      : null,
    managedByHand,
    archived: (row?.shopifyProductStatus ?? "").toLowerCase() === "archived",
  };
}

export interface RecipeInfo { recipeId: number; recipeName: string; packSize: number | null }

function heldGroup(p: Pick<PendingRow, "recipeId" | "recipeName" | "packSize" | "kind"> & Partial<PendingRow>, problem: string | null = null): GroupView {
  return {
    recipeId: p.recipeId, recipeName: p.recipeName, kind: p.kind, label: kindLabel(p.kind, p.packSize),
    productName: pendingIdentity(p).name, barcode: p.barcode ?? null, mixed: false, variants: [],
    pending: true, heldSetByName: p.setByName ?? null, heldSetAt: p.setAt ?? null, heldProblem: problem,
  };
}

/** Every group, plus — for a recipe with no pack listing — its held pack
 *  barcode (or an empty one to type into when `blankFor` names the recipe). */
function groupsOf(s: OwnershipState, recipeId?: number, blankFor?: RecipeInfo | null): GroupView[] {
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
        pending: false, heldSetByName: null, heldSetAt: null, heldProblem: null,
      };
      groups.set(key, g);
    }
    g.variants.push(variantView(l.variantId, s));
  }
  for (const g of groups.values()) Object.assign(g, groupBarcode(g.variants.map(v => v.barcode)));
  for (const p of s.pending) {
    if (recipeId != null && p.recipeId !== recipeId) continue;
    const key = `${p.recipeId}:${p.kind}`;
    const linked = groups.get(key);
    if (linked) {
      // Linked since, but the held number couldn't be moved on (another
      // current product holds it) — say so on the card.
      linked.heldProblem = `${p.barcode} was held for this product before its listing was linked, but couldn't be applied — another product you sell has it. Type the right number here.`;
      continue;
    }
    groups.set(key, heldGroup(p));
  }
  if (blankFor && !groups.has(`${blankFor.recipeId}:pack`)) groups.set(`${blankFor.recipeId}:pack`, heldGroup({ ...blankFor, kind: "pack" }));
  const order = (k: LinkKind) => ["pack", "bag", "wonky"].indexOf(k);
  return [...groups.values()].sort((a, b) => a.recipeName.localeCompare(b.recipeName, "en-GB") || a.recipeId - b.recipeId || order(a.kind) - order(b.kind));
}

async function recipeInfo(recipeId: number, exec: Exec = db): Promise<RecipeInfo | null> {
  const [r] = await exec.select({ name: recipesTable.name, packSize: recipesTable.packSize }).from(recipesTable).where(eq(recipesTable.id, recipeId));
  return r ? { recipeId, recipeName: r.name, packSize: r.packSize == null ? null : Number(r.packSize) } : null;
}

export async function loadGroups(recipeId?: number): Promise<{ groups: GroupView[]; ambiguousBags: string[] }> {
  const [s, info] = await Promise.all([loadOwnership(), recipeId != null ? recipeInfo(recipeId) : Promise.resolve(null)]);
  return { groups: groupsOf(s, recipeId, info), ambiguousBags: s.ambiguousBags };
}

/** The barcode each recipe's pack label prints: what its pack listings SCAN
 *  with, or the one held for it before it has a listing (batch form for the
 *  labels list). */
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
    /** Why barcodes can't be sent to Shopify right now (null = they can). */
    shopifyWritesBlocked: await barcodeWritesBlockedReason(),
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

type EventAction = "set" | "move" | "use-shopify" | "same-product" | "pull-fill" | "follow" | "scan-fill" | "push" | "adopt" | "pending-set" | "pending-apply";
type EventResult = "ok" | "refused" | "failed" | "waiting" | "skipped" | "conflict";

async function logEvent(e: { variantId: string; recipeId?: number | null; productName?: string | null; action: EventAction; oldBarcode?: string | null; newBarcode?: string | null; result: EventResult; message?: string | null; actor?: Actor | null }, exec: Exec = db): Promise<void> {
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

// ── Pushing to Shopify (barcode-push.ts is the only writer) ────────────────

/** Records each push on the variant's row and in barcode_events. */
function dbSink(actor: Actor | null): PushSink {
  return {
    async record(r) {
      const now = new Date();
      const live = r.live;
      await db.update(skuBarcodesTable).set({
        shopifyPushState: r.state, shopifyPushBarcode: r.barcode, shopifyPushFrom: r.from, shopifyPushAt: now, shopifyPushMessage: r.message,
        ...(live ? {
          shopifyBarcode: live.barcode, shopifyCheckedAt: now, shopifyProductId: live.productId, shopifyProductStatus: live.status, shopifyMissing: false,
          productTitle: sql`COALESCE(${skuBarcodesTable.productTitle}, ${live.productTitle})`,
          variantTitle: sql`COALESCE(${skuBarcodesTable.variantTitle}, ${live.variantTitle})`,
        } : {}),
      }).where(eq(skuBarcodesTable.variantId, r.variantId));
    },
    async log(e) {
      await logEvent({ variantId: e.variantId, recipeId: e.recipeId, productName: e.name, action: "push", oldBarcode: e.from, newBarcode: e.to, result: e.result, message: e.message, actor });
    },
  };
}

/** Tests swap the Shopify side; everything else uses the live one. */
let shopifyPort: ShopifyBarcodePort = liveBarcodePort;
export function setBarcodeShopifyPortForTests(port: ShopifyBarcodePort): void { shopifyPort = port; }

// One push at a time, in order — a quick second edit can't be overtaken by
// the first one's slower call.
let pushChain: Promise<unknown> = Promise.resolve();

/** Push now (in order with any other push) and wait for the result. */
export function runPush(targets: PushTarget[], actor: Actor | null): Promise<PushResult[]> {
  const run = pushChain.then(() => pushBarcodes(targets, shopifyPort, dbSink(actor)));
  pushChain = run.catch(() => undefined);
  return run;
}

/** Wait (at most `timeoutMs`) for the pushes queued so far to finish — so
 *  "Create Shopify product" can say whether its barcode reached Shopify.
 *  Never throws; a slow push carries on in the background. */
export async function barcodePushesSettled(timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    pushChain.catch(() => undefined),
    new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Mark the targets "Sending…" and push in the background — a save in the
 *  app never waits for (or fails because of) Shopify. */
export async function queuePush(targets: PushTarget[], actor: Actor | null): Promise<void> {
  const sending = targets.filter(t => t.ours);
  if (!sending.length) return;
  const now = new Date();
  for (const t of sending) {
    await db.update(skuBarcodesTable).set({ shopifyPushState: "sending", shopifyPushBarcode: t.ours, shopifyPushAt: now, shopifyPushMessage: null })
      .where(eq(skuBarcodesTable.variantId, t.variantId));
  }
  void runPush(targets, actor).catch(async err => {
    const message = `Not sent: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[barcodes] push failed:", message);
    for (const t of sending) {
      await db.update(skuBarcodesTable).set({ shopifyPushState: "failed", shopifyPushMessage: message, shopifyPushAt: new Date() })
        .where(eq(skuBarcodesTable.variantId, t.variantId)).catch(e => console.error("[barcodes] couldn't record the failed push:", e));
    }
  });
}

/** Shopify numbers a push may replace: what we held before (`before`) and
 *  what we last sent. Anything else in Shopify is a disagreement. */
function replaceableFor(id: string, s: OwnershipState, before: OwnershipState | null): Array<string | null> {
  const row = s.byVariant.get(id);
  return [
    before?.byVariant.get(id)?.barcode ?? null,
    before?.ownership.barcodeOf.get(id) ?? null,
    row?.shopifyPushState === "sent" ? row.shopifyPushBarcode : null,
  ];
}

/**
 * The push targets for one product (a recipe's listings of one kind) after a
 * change: each listing with the barcode it scans with, plus every other
 * CURRENT listing that is the same product (an F2F copy marked "same
 * product as" — it shares the main code; the Club Special is a target only
 * to be recorded as managed by hand).
 */
function groupTargets(s: OwnershipState, recipeId: number, kind: LinkKind, before: OwnershipState | null, opts: { force?: boolean; replaceAny?: boolean } = {}): PushTarget[] {
  const ids = s.links.filter(l => l.recipeId === recipeId && l.kind === kind).map(l => l.variantId);
  if (!ids.length) return [];
  const identityKey = s.identities.get(ids[0])?.key;
  const code = groupBarcode(ids.map(id => s.ownership.barcodeOf.get(id))).barcode;
  const beforeCode = before ? groupBarcode(ids.map(id => before.ownership.barcodeOf.get(id))).barcode : null;
  const copies = s.rows
    .filter(r => !s.linkOf.has(r.variantId) && identityKey && s.identities.get(r.variantId)?.key === identityKey && (s.currentOf.get(r.variantId) ?? true))
    .map(r => r.variantId);
  const name = (id: string) => variantName(s.byVariant.get(id), id);
  return [
    ...ids.map(id => ({
      variantId: id, ours: s.ownership.barcodeOf.get(id) ?? null, replaceable: replaceableFor(id, s, before), clubSpecial: s.clubSpecial.has(id),
      force: opts.force, recipeId, name: name(id),
    })),
    // A copy's own number follows Shopify, so it may be replaced by the main code.
    ...copies.map(id => ({
      variantId: id, ours: code, replaceable: [s.byVariant.get(id)?.barcode ?? null, beforeCode, ...replaceableFor(id, s, before)], clubSpecial: s.clubSpecial.has(id),
      force: opts.force, recipeId, name: name(id),
    })),
  ];
}

/** After a change to one product: load the new state and queue its push. */
async function pushProduct(recipeId: number | null, kind: LinkKind | null, variantId: string | null, before: OwnershipState | null, actor: Actor): Promise<void> {
  try {
    const s = await loadOwnership();
    const targets = recipeId != null && kind
      ? groupTargets(s, recipeId, kind, before)
      : variantId ? [{ variantId, ours: s.ownership.barcodeOf.get(variantId) ?? null, replaceable: replaceableFor(variantId, s, before), clubSpecial: s.clubSpecial.has(variantId), name: variantName(s.byVariant.get(variantId), variantId) }] : [];
    await queuePush(targets, actor);
  } catch (err) {
    // The save itself is done; the card shows the push never started.
    console.error("[barcodes] couldn't start the Shopify push:", err instanceof Error ? err.message : err);
  }
}

/** "Send ours to Shopify": a person chose ours over a different number in
 *  Shopify. Replaces it (never on the Club Special or an archived product). */
export async function sendOursToShopify(variantId: string, actor: Actor): Promise<PushResult> {
  const s = await loadOwnership();
  const link = s.linkOf.get(variantId);
  const identityKey = s.identities.get(variantId)?.key;
  let ours = s.ownership.barcodeOf.get(variantId) ?? null;
  if (!link && identityKey) {
    // A copy: the main product's code.
    const main = s.links.filter(l => s.identities.get(l.variantId)?.key === identityKey).map(l => s.ownership.barcodeOf.get(l.variantId));
    ours = groupBarcode(main).barcode ?? ours;
  }
  if (!ours) throw new BarcodeRefused(409, "The app has no barcode for this listing — there's nothing to send.");
  const [r] = await runPush([{ variantId, ours, replaceable: [], clubSpecial: s.clubSpecial.has(variantId), force: true, recipeId: link?.recipeId ?? null, name: variantName(s.byVariant.get(variantId), variantId) }], actor);
  return r;
}

/** Retry: send again, replacing only what Shopify had when it was first
 *  decided (a newer number there is a disagreement). */
export async function retryPush(variantId: string, actor: Actor | null): Promise<PushResult | null> {
  const s = await loadOwnership();
  const row = s.byVariant.get(variantId);
  if (!row) throw new BarcodeRefused(404, "We hold nothing for that listing.");
  const link = s.linkOf.get(variantId);
  // Only a send that was going ahead (waiting / failed) may replace what
  // Shopify had then; a disagreement stays one until a person chooses.
  const wasGoing = row.shopifyPushState === "waiting" || row.shopifyPushState === "failed" || row.shopifyPushState === "sending";
  const from = wasGoing ? row.shopifyPushFrom : null;
  if (link) {
    const targets = groupTargets(s, link.recipeId, link.kind, null).filter(t => t.variantId === variantId)
      .map(t => ({ ...t, replaceable: [...t.replaceable, from] }));
    const [r] = await runPush(targets, actor);
    return r ?? null;
  }
  const ours = row.shopifyPushBarcode ?? s.ownership.barcodeOf.get(variantId) ?? null;
  const [r] = await runPush([{ variantId, ours, replaceable: [from], clubSpecial: s.clubSpecial.has(variantId), name: variantName(row, variantId) }], actor);
  return r ?? null;
}

/** Hourly: send everything left "waiting" or "failed" once writes are
 *  allowed. Does nothing (and logs nothing) while they are still blocked. */
export async function retryWaitingPushes(): Promise<{ tried: number; blocked: string | null }> {
  const blocked = await barcodeWritesBlockedReason();
  if (blocked) return { tried: 0, blocked };
  const waiting = await db.select({ variantId: skuBarcodesTable.variantId }).from(skuBarcodesTable)
    .where(inArray(skuBarcodesTable.shopifyPushState, ["waiting", "failed"]));
  for (const w of waiting) await retryPush(w.variantId, null).catch(err => console.error("[barcodes] retry failed:", err));
  return { tried: waiting.length, blocked: null };
}

// ── Set / move in the app ───────────────────────────────────────────────────

export class BarcodeRefused extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}

function holdersFrom(s: OwnershipState, exclude: Set<string>): BarcodeHolder[] {
  // The Club Special holds no code of its own (it follows the special).
  const rows: BarcodeHolder[] = s.rows.filter(r => !exclude.has(r.variantId) && !s.clubSpecial.has(r.variantId)).map(r => {
    const current = s.currentOf.get(r.variantId) ?? true;
    const identity = s.identities.get(r.variantId)!;
    return {
      variantId: r.variantId, name: variantName(r, r.variantId), identityKey: identity.key, identityName: identity.name, current,
      ours: current ? r.barcode : null,
      shopify: r.shopifyBarcode ?? (current ? null : r.barcode),
    };
  });
  // Barcodes held for recipes with no listing yet are claims too.
  const held: BarcodeHolder[] = s.pending.filter(p => !exclude.has(pendingKey(p.recipeId, p.kind))).map(p => {
    const identity = pendingIdentity(p);
    return { variantId: pendingKey(p.recipeId, p.kind), name: identity.name, identityKey: identity.key, identityName: identity.name, current: true, ours: p.barcode, shopify: null };
  });
  return [...rows, ...held];
}

/** Release a code from the products it is moving away from (a person
 *  confirmed the move) — in the caller's transaction, logged. */
async function releaseFrom(tx: Exec, s: OwnershipState, release: string[], movedTo: string, actor: Actor): Promise<void> {
  const now = new Date();
  for (const id of release) {
    if (id.startsWith("pending:")) {
      const [, rid, kind] = id.split(":");
      const p = s.pending.find(x => x.recipeId === Number(rid) && x.kind === kind);
      await tx.delete(recipePendingBarcodesTable).where(and(eq(recipePendingBarcodesTable.recipeId, Number(rid)), eq(recipePendingBarcodesTable.kind, kind)));
      await logEvent({ variantId: `recipe:${rid}`, recipeId: Number(rid), productName: p ? pendingIdentity(p).name : null, action: "move", oldBarcode: p?.barcode ?? null, newBarcode: null, result: "ok", message: `moved to ${movedTo}`, actor }, tx);
      continue;
    }
    const row = s.byVariant.get(id);
    // Released rows become app-owned, so the hourly check won't hand the
    // code straight back from Shopify. Shopify's own barcode on the old
    // product is left as it is (never blanked).
    await tx.update(skuBarcodesTable).set({ barcode: null, barcodeSource: "app", barcodeSetAt: now, barcodeSetById: actor.id, barcodeSetByName: actor.name, updatedAt: now }).where(eq(skuBarcodesTable.variantId, id));
    await logEvent({ variantId: id, recipeId: s.linkOf.get(id)?.recipeId ?? null, productName: variantName(row, id), action: "move", oldBarcode: row?.barcode ?? null, newBarcode: null, result: "ok", message: `moved to ${movedTo}`, actor }, tx);
  }
}

/** Write `code` onto `ids` (set by a person), after releasing it from
 *  `release` — all in the caller's transaction, all logged. */
async function assign(tx: Exec, s: OwnershipState, ids: string[], code: string, release: string[], movedTo: string, actor: Actor, recipeId: number | null, action: "set" | "use-shopify" | "pending-apply", extra: Partial<typeof skuBarcodesTable.$inferInsert> = {}, message: string | null = null) {
  const now = new Date();
  await releaseFrom(tx, s, release, movedTo, actor);
  for (const id of ids) {
    const row = s.byVariant.get(id);
    if (row?.barcode === code && (action !== "use-shopify" ? row.barcodeSource === "app" || row.barcodeSource === "label" : true) && !Object.keys(extra).length) continue;
    const set = { barcode: code, barcodeSource: action === "use-shopify" ? "shopify" : "app", barcodeSetAt: now, barcodeSetById: actor.id, barcodeSetByName: actor.name, updatedAt: now, ...extra };
    await tx.insert(skuBarcodesTable).values({ variantId: id, ...set }).onConflictDoUpdate({ target: skuBarcodesTable.variantId, set });
    await logEvent({ variantId: id, recipeId, productName: variantName(row, id), action, oldBarcode: row?.barcode ?? null, newBarcode: code, result: "ok", message, actor }, tx);
  }
}

export interface Confirmations { move?: boolean; take?: boolean }

/** Set one barcode for every listing in a recipe's group (its pack
 *  listings, its 8-pack bag, its wonky pack). A code another product holds
 *  is moved only with the person's confirmation(s) — see planAssignment.
 *  With no pack listing yet, the pack barcode is HELD for the recipe
 *  (recipe_pending_barcodes) until one is linked. Saved, then sent to
 *  Shopify in the background. */
export async function setGroupBarcode(recipeId: number, kind: LinkKind, input: string, actor: Actor, confirmed: Confirmations): Promise<GroupView | null> {
  let refusal: BarcodeRefused | null = null;
  let before: OwnershipState | null = null;
  let held = false;
  await db.transaction(async tx => {
    // One barcode change at a time, so two people can't give two products
    // the same number in the same instant.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261011)`);
    const s = await loadOwnership(tx);
    before = s;
    const ids = s.links.filter(l => l.recipeId === recipeId && l.kind === kind).map(l => l.variantId);
    if (ids.length === 0) {
      if (kind !== "pack") throw new BarcodeRefused(404, "That recipe has no Shopify listing of that kind linked.");
      held = true;
      refusal = await holdForRecipe(tx, s, recipeId, input, actor, confirmed);
      return;
    }
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
  if (!held) await pushProduct(recipeId, kind, null, before, actor);
  const { groups } = await loadGroups(recipeId);
  return groups.find(g => g.kind === kind) ?? null;
}

/** A pack barcode for a recipe with no pack listing yet: checked exactly
 *  like a listing's (valid GTIN; another product's code only moved with
 *  confirmation), then held against the product until a listing is linked. */
async function holdForRecipe(tx: Exec, s: OwnershipState, recipeId: number, input: string, actor: Actor, confirmed: Confirmations): Promise<BarcodeRefused | null> {
  const info = await recipeInfo(recipeId, tx);
  if (!info) return new BarcodeRefused(404, "Recipe not found.");
  const identity = pendingIdentity({ ...info, kind: "pack" });
  const key = pendingKey(recipeId, "pack");
  const plan = planAssignment(input, { identityKey: identity.key, name: identity.name }, holdersFrom(s, new Set([key])), confirmed);
  const old = s.pending.find(p => p.recipeId === recipeId && p.kind === "pack")?.barcode ?? null;
  if (!plan.ok) {
    if ("confirm" in plan) return new BarcodeRefused(409, plan.reason, { confirm: plan.confirm, holders: plan.holders });
    await logEvent({ variantId: `recipe:${recipeId}`, recipeId, productName: identity.name, action: "pending-set", oldBarcode: old, newBarcode: input.trim() || null, result: "refused", message: plan.reason, actor }, tx);
    return new BarcodeRefused(422, plan.reason);
  }
  await releaseFrom(tx, s, plan.release, identity.name, actor);
  if (old === plan.digits) return null;
  const now = new Date();
  const values = { recipeId, kind: "pack", barcode: plan.digits, setById: actor.id, setByName: actor.name, setAt: now };
  await tx.insert(recipePendingBarcodesTable).values(values)
    .onConflictDoUpdate({ target: [recipePendingBarcodesTable.recipeId, recipePendingBarcodesTable.kind], set: { barcode: plan.digits, setById: actor.id, setByName: actor.name, setAt: now } });
  await logEvent({ variantId: `recipe:${recipeId}`, recipeId, productName: identity.name, action: "pending-set", oldBarcode: old, newBarcode: plan.digits, result: "ok", message: "no Shopify listing yet — held for the product, sent when one is linked", actor }, tx);
  return null;
}

/**
 * A Shopify listing was just linked to a recipe (recipe page, test-box
 * creator) — or the hourly check found one linked. For each of the recipe's
 * products:
 *   - a barcode HELD for it moves onto the listing(s) (and stops being held);
 *   - a newly linked listing with no barcode gets the one its product
 *     already scans with;
 * then the product is pushed to Shopify — where Shopify already has a
 * different number it is a disagreement for a person, never overwritten.
 */
export async function afterListingLinked(recipeId: number, actor: Actor): Promise<void> {
  const touched = new Set<LinkKind>();
  let before: OwnershipState | null = null;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261011)`);
    const s = await loadOwnership(tx);
    before = s;
    for (const p of s.pending.filter(x => x.recipeId === recipeId)) {
      const ids = s.links.filter(l => l.recipeId === recipeId && l.kind === p.kind).map(l => l.variantId);
      if (!ids.length) continue;
      const identity = s.identities.get(ids[0])!;
      // The person already confirmed moving it from an old product when they
      // set it; a CURRENT product holding it now is left for a person.
      const plan = planAssignment(p.barcode, { identityKey: identity.key, name: identity.name }, holdersFrom(s, new Set([...ids, pendingKey(p.recipeId, p.kind)])), { move: true });
      if (!plan.ok) {
        await logEvent({ variantId: `recipe:${recipeId}`, recipeId, productName: identity.name, action: "pending-apply", oldBarcode: p.barcode, result: "refused", message: plan.reason, actor }, tx);
        continue;
      }
      const by: Actor = { id: actor.id, name: p.setByName ?? actor.name };
      await assign(tx, s, ids, plan.digits, plan.release, identity.name, by, recipeId, "pending-apply", {}, "held barcode applied — the Shopify listing was linked");
      await tx.delete(recipePendingBarcodesTable).where(and(eq(recipePendingBarcodesTable.recipeId, recipeId), eq(recipePendingBarcodesTable.kind, p.kind)));
      touched.add(p.kind);
    }
    // New listings with no barcode take their product's.
    for (const kind of ["pack", "bag", "wonky"] as LinkKind[]) {
      if (touched.has(kind)) continue;
      const ids = s.links.filter(l => l.recipeId === recipeId && l.kind === kind).map(l => l.variantId);
      const { barcode: code } = groupBarcode(ids.map(id => s.ownership.barcodeOf.get(id)));
      if (!code) continue;
      const empty = ids.filter(id => {
        const row = s.byVariant.get(id);
        // Never refill one a person cleared on purpose (source 'app', empty).
        return !row || (row.barcode == null && row.barcodeSource !== "app");
      });
      if (!empty.length) continue;
      const identity = s.identities.get(ids[0])!;
      await assign(tx, s, empty, code, [], identity.name, actor, recipeId, "set", {}, "new listing — given its product's barcode");
      touched.add(kind);
    }
  });
  for (const kind of touched) await pushProduct(recipeId, kind, null, before, actor);
}

/** "Use Shopify's": take Shopify's barcode for this variant's whole group
 *  (read live). Same move/confirm rules as typing it. The group's other
 *  listings are then sent the same number. */
export async function useShopifyBarcode(variantId: string, actor: Actor, confirmed: Confirmations): Promise<void> {
  const live = await getVariantBarcodeDetails([variantId]);
  const d = live.get(variantId);
  if (!d) throw new BarcodeRefused(404, "That variant isn't in Shopify any more.");
  const theirs = (d.barcode ?? "").trim();
  if (!theirs) throw new BarcodeRefused(409, "Shopify has no barcode on this variant — there's nothing to use.");
  let refusal: BarcodeRefused | null = null;
  let before: OwnershipState | null = null;
  let me: LinkedVariant | undefined;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261011)`);
    const s = await loadOwnership(tx);
    before = s;
    me = s.linkOf.get(variantId);
    const ids = me ? s.links.filter(l => l.recipeId === me!.recipeId && l.kind === me!.kind).map(l => l.variantId) : [variantId];
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
    await tx.update(skuBarcodesTable).set({ shopifyBarcode: theirs, shopifyPushState: "sent", shopifyPushBarcode: plan.digits, shopifyPushFrom: theirs, shopifyPushAt: now, shopifyPushMessage: null })
      .where(eq(skuBarcodesTable.variantId, variantId));
  });
  if (refusal) throw refusal;
  const link = me as LinkedVariant | undefined;
  await pushProduct(link?.recipeId ?? null, link?.kind ?? null, link ? null : variantId, before, actor);
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

/** A packer at the bench sets the barcode of a product that has NONE, from
 *  the code scanned off the pack after checking it by eye (Graeme, 12 Oct
 *  2026). Never changes an existing barcode (manager-only, above) and never
 *  takes a number another product holds — planPackerBarcode. Saved as set
 *  by a person (source 'app'), so isCurrent keeps it; logged with who/when.
 *  A linked recipe listing sets its whole group, like the Barcodes page. */
export async function setPackerBarcode(variantId: string, input: string, actor: Actor, fallbackName: string | null): Promise<{ barcode: string; name: string }> {
  let refusal: BarcodeRefused | null = null;
  let result: { barcode: string; name: string } | null = null;
  let before: OwnershipState | null = null;
  let link: LinkedVariant | undefined;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261011)`);
    const s = await loadOwnership(tx);
    const row = s.byVariant.get(variantId);
    const name = s.identities.get(variantId)?.name ?? (row ? variantName(row, fallbackName ?? variantId) : fallbackName ?? `Shopify variant ${variantId}`);
    if (s.clubSpecial.has(variantId)) {
      refusal = new BarcodeRefused(409, `${name} scans with the current special's barcode, which is set on the Barcodes page. Please fetch a manager.`);
      return;
    }
    const me = s.linkOf.get(variantId);
    const ids = me ? s.links.filter(l => l.recipeId === me.recipeId && l.kind === me.kind).map(l => l.variantId) : [variantId];
    // The barcode these listings already scan with (or hold, while current).
    const existing = ids.map(id => s.ownership.barcodeOf.get(id) ?? (s.currentOf.get(id) !== false ? s.byVariant.get(id)?.barcode ?? null : null)).find(Boolean) ?? null;
    const identityKey = s.identities.get(variantId)?.key ?? `v${variantId}`;
    const plan = planPackerBarcode(input, { identityKey, name, existing }, holdersFrom(s, new Set(ids)));
    if (!plan.ok) {
      await logEvent({ variantId, recipeId: me?.recipeId ?? null, productName: name, action: "set", oldBarcode: row?.barcode ?? null, newBarcode: input.trim() || null, result: "refused", message: `packing bench: ${plan.reason}`, actor }, tx);
      refusal = new BarcodeRefused(plan.why === "invalid" ? 422 : 409, plan.reason, { why: plan.why, ...(plan.product ? { product: plan.product } : {}) });
      return; // commit the refusal log; nothing else changed
    }
    // A variant we've never stored yet gets its name, so the Barcodes page
    // can show it before the hourly check fills the rest in.
    const extra = !row && !me && fallbackName ? { productTitle: fallbackName } : {};
    await assign(tx, s, ids, plan.digits, [], name, actor, me?.recipeId ?? null, "set", extra);
    result = { barcode: plan.digits, name };
    before = s;
    link = me;
  });
  if (refusal) throw refusal;
  const l = link as LinkedVariant | undefined;
  await pushProduct(l?.recipeId ?? null, l?.kind ?? null, l ? null : variantId, before, actor);
  return result!;
}

/** Packing bench, manager or admin (Graeme, 28 Oct 2026): this listing is
 *  the SAME physical product as the one that already holds the scanned
 *  barcode — "Buttermilk Fried Chicken 400g + rice", where a Shopify flow
 *  adds the rice and the pack is the plain 400g pack. Marks it "same product
 *  as" that listing (barcodes only, like an F2F copy) so both scan with the
 *  one code, then sets it if it has none yet. Never for a recipe's own
 *  listing: two recipes must never share a code. */
export async function sharePackerBarcode(variantId: string, input: string, actor: Actor, fallbackName: string | null): Promise<{ barcode: string; name: string; sameAs: string }> {
  const g = checkGtin(input);
  if (!g.ok) throw new BarcodeRefused(422, `That isn't a valid barcode: ${g.reason}. Scan it again.`);
  const key = gtinKey(g.digits);
  const s = await loadOwnership(db);
  if (s.linkOf.has(variantId)) {
    throw new BarcodeRefused(409, "This listing is a recipe's own pack, so it can't share another product's barcode. Set it on the Barcodes page.");
  }
  if (s.clubSpecial.has(variantId)) {
    throw new BarcodeRefused(409, "The Club Special follows the current special's barcode, set on the Barcodes page.");
  }
  const myKey = s.identities.get(variantId)?.key ?? `v${variantId}`;
  const holder = pickShareHolder(g.digits, myKey, holdersFrom(s, new Set([variantId])));
  if (!holder) throw new BarcodeRefused(409, `No product we sell has ${g.digits} — use "Set its barcode" instead.`);
  await setSameProductAs(variantId, holder.variantId, actor);
  // Already holding that very number (the identity was all that blocked
  // it): nothing more to set.
  const mine = s.byVariant.get(variantId)?.barcode;
  if (mine && gtinKey(mine) === key) return { barcode: g.digits, name: holder.identityName, sameAs: holder.identityName };
  const r = await setPackerBarcode(variantId, g.digits, actor, fallbackName);
  return { ...r, sameAs: holder.identityName };
}

// ── Pull (one-time) and hourly check — Shopify → app (adopt where we have none) ──

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
  const [products, mappings, rows, before] = await Promise.all([getProducts(), loadMappings(), db.select().from(skuBarcodesTable), loadOwnership()]);
  // Who scans with each code now — Shopify's number is never adopted onto a
  // product when another current product here already has it.
  const ownerOf = new Map<string, string>();
  for (const [vid, code] of before.ownership.barcodeOf) if (code) ownerOf.set(gtinKey(code), before.identities.get(vid)?.key ?? `v${vid}`);
  for (const p of before.pending) ownerOf.set(gtinKey(p.barcode), pendingIdentity(p).key);
  const touched = new Map<string, { recipeId: number; kind: LinkKind }>();

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
    const current = isCurrent(link, recipeActive, l?.status ?? row?.shopifyProductStatus, row?.barcodeSource === "app" || row?.barcodeSource === "label");
    const owner = l?.barcode ? ownerOf.get(gtinKey(l.barcode)) : undefined;
    const decision = decidePull({
      mode, linked: !!link, current, setInApp: row?.barcodeSource === "app" || row?.barcodeSource === "label",
      ours: row?.barcode ?? null, shopify: l ? { barcode: l.barcode } : null,
      heldElsewhere: owner != null && owner !== (before.identities.get(id)?.key ?? `v${id}`),
    });
    // Shopify → app: in the hourly check a fill is an ADOPT.
    const fillAction = mode === "check" && decision.outcome === "filled" ? "adopt" : "pull-fill";
    if (link && decision.outcome === "filled" && !dryRun) touched.set(`${link.recipeId}:${link.kind}`, { recipeId: link.recipeId, kind: link.kind });
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
        if (decision.setOurs) await logEvent({ variantId: id, recipeId: link?.recipeId, productName: name, action: link ? fillAction : "follow", newBarcode: decision.setOurs, result: "ok", actor });
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
        variantId: id, recipeId: link?.recipeId, productName: name, action: link ? fillAction : "follow", oldBarcode: row.barcode,
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

  if (!dryRun) {
    // A listing linked since a barcode was held for its recipe: apply it.
    const linkedKinds = new Set(links.map(l => `${l.recipeId}:${l.kind}`));
    for (const recipeId of new Set(before.pending.filter(p => linkedKinds.has(`${p.recipeId}:${p.kind}`)).map(p => p.recipeId))) {
      await afterListingLinked(recipeId, actor ?? { id: null, name: "Shopify check" })
        .catch(err => console.error(`[barcodes] applying the held barcode of recipe ${recipeId} failed:`, err));
    }
    // Shopify → app adopts: send the number to the product's other listings.
    for (const t of touched.values()) await pushProduct(t.recipeId, t.kind, null, before, actor ?? { id: null, name: "Shopify check" });
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

// ── One-time preview + bulk sync of existing differences ────────────────────

export interface SyncItem {
  variantId: string;
  name: string;
  recipeId: number | null;
  recipeName: string | null;
  kind: LinkKind | null;
  action: SyncAction;
  reason: string;
  ours: string | null;
  shopify: string | null;
}

export interface SyncPreview {
  at: string;
  counts: SyncCounts;
  /** What a sync would change: overwrite / fill (in Shopify) and adopt (here). */
  changes: SyncItem[];
  /** Left alone on purpose: the Club Special, archived products, held-back codes… */
  skipped: SyncItem[];
  /** Why the sends would wait (writes off / missing permission), null = they'd go. */
  writesBlocked: string | null;
}

/** "Preview what would change in Shopify": every listing the app owns
 *  (linked to a recipe, or set by a person) compared with Shopify live.
 *  Reads only — sends and saves nothing. */
export async function previewSync(): Promise<SyncPreview> {
  const at = new Date().toISOString();
  const [products, s, writesBlocked] = await Promise.all([getProducts(), loadOwnership(), barcodeWritesBlockedReason()]);
  const live = new Map<string, { barcode: string | null; status: string; name: string }>();
  for (const p of products) for (const v of p.variants) {
    live.set(String(v.id), { barcode: (v.barcode ?? "").trim() || null, status: (p.status ?? "").toLowerCase(), name: variantName({ productTitle: p.title, variantTitle: v.title }, String(v.id)) });
  }
  const ownerOf = new Map<string, string>();
  for (const [vid, code] of s.ownership.barcodeOf) if (code) ownerOf.set(gtinKey(code), s.identities.get(vid)?.key ?? `v${vid}`);
  for (const p of s.pending) ownerOf.set(gtinKey(p.barcode), pendingIdentity(p).key);

  const setInApp = (r: SkuBarcode | undefined) => r?.barcodeSource === "app" || r?.barcodeSource === "label";
  const ids = new Set([...s.links.map(l => l.variantId), ...s.rows.filter(r => setInApp(r)).map(r => r.variantId), ...s.clubSpecial.keys()]);
  const changes: SyncItem[] = [];
  const skipped: SyncItem[] = [];
  const actions: SyncAction[] = [];
  for (const id of ids) {
    const row = s.byVariant.get(id);
    const link = s.linkOf.get(id);
    const l = live.get(id);
    const current = s.currentOf.get(id) ?? true;
    const ours = s.ownership.barcodeOf.get(id) ?? null;
    const owner = l?.barcode ? ownerOf.get(gtinKey(l.barcode)) : undefined;
    let d = decideSync({
      ours, shopify: l ? { barcode: l.barcode, status: l.status } : null, clubSpecial: s.clubSpecial.has(id),
      appOwned: !!link || setInApp(row), current,
      clearedByPerson: setInApp(row) && row?.barcode == null,
      heldElsewhere: owner != null && owner !== (s.identities.get(id)?.key ?? `v${id}`),
    });
    // Ours is held back (it clashes with another product) — never sent, never replaced.
    if (current && row?.barcode && !ours && !s.clubSpecial.has(id)) d = { action: "skip", reason: "Ours shares a code with another product — sort that out first" };
    actions.push(d.action);
    const item: SyncItem = {
      variantId: id, name: l?.name ?? variantName(row, `Shopify variant ${id}`), recipeId: link?.recipeId ?? null, recipeName: link?.recipeName ?? null,
      kind: link?.kind ?? null, action: d.action, reason: d.reason, ours, shopify: l?.barcode ?? null,
    };
    if (d.action === "overwrite" || d.action === "fill" || d.action === "adopt") changes.push(item);
    else if (d.action === "skip" && (l || row?.barcode)) skipped.push(item);
  }
  const order: Record<SyncAction, number> = { overwrite: 0, fill: 1, adopt: 2, skip: 3, same: 4 };
  const sort = (a: SyncItem, b: SyncItem) => order[a.action] - order[b.action] || (a.recipeName ?? a.name).localeCompare(b.recipeName ?? b.name, "en-GB") || a.name.localeCompare(b.name);
  return { at, counts: countSync(actions), changes: changes.sort(sort), skipped: skipped.sort(sort), writesBlocked };
}

export interface SyncResult {
  adopted: number;
  sent: number;
  waiting: number;
  failed: number;
  /** Changed since the preview, so left alone (preview again). */
  changedSincePreview: number;
  results: PushResult[];
}

/** The real bulk sync, after the preview: only the items the person saw,
 *  and only where the same action still applies now. Adopts are saved here;
 *  overwrites and fills are sent to Shopify (never the Club Special or an
 *  archived product — re-checked live by decidePush). */
export async function applySync(items: Array<{ variantId: string; action: SyncAction }>, actor: Actor): Promise<SyncResult> {
  const wanted = new Map(items.map(i => [i.variantId, i.action]));
  const preview = await previewSync();
  const now = new Date();
  let adopted = 0;
  let changedSincePreview = 0;
  const targets: PushTarget[] = [];
  const s = await loadOwnership();
  const seen = new Set<string>();
  for (const c of preview.changes) {
    const want = wanted.get(c.variantId);
    if (!want) continue;
    seen.add(c.variantId);
    if (want !== c.action) { changedSincePreview++; continue; }
    if (c.action === "adopt" && c.shopify) {
      const row = s.byVariant.get(c.variantId);
      const set = { barcode: c.shopify, barcodeSource: "shopify", barcodeSetAt: now, barcodeSetById: actor.id, barcodeSetByName: actor.name, updatedAt: now, shopifyBarcode: c.shopify, shopifyCheckedAt: now };
      const done = row
        ? await db.update(skuBarcodesTable).set(set).where(and(eq(skuBarcodesTable.variantId, c.variantId), sql`${skuBarcodesTable.barcode} IS NULL`)).returning({ v: skuBarcodesTable.variantId })
        : await db.insert(skuBarcodesTable).values({ variantId: c.variantId, ...set }).onConflictDoNothing().returning({ v: skuBarcodesTable.variantId });
      if (done.length) {
        adopted++;
        await logEvent({ variantId: c.variantId, recipeId: c.recipeId, productName: c.name, action: "adopt", newBarcode: c.shopify, result: "ok", message: "bulk sync after the preview", actor });
      } else changedSincePreview++;
      continue;
    }
    if (c.ours) {
      targets.push({ variantId: c.variantId, ours: c.ours, replaceable: [], clubSpecial: s.clubSpecial.has(c.variantId), force: true, recipeId: c.recipeId, name: c.name });
    }
  }
  changedSincePreview += [...wanted.keys()].filter(id => !seen.has(id)).length;
  const results = await runPush(targets, actor);
  return {
    adopted, changedSincePreview, results,
    sent: results.filter(r => r.outcome === "send").length,
    waiting: results.filter(r => r.outcome === "waiting").length,
    failed: results.filter(r => r.outcome === "failed").length,
  };
}
