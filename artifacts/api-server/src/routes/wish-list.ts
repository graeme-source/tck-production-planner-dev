/**
 * Wish List — "Equipment & things we need" (migration 0260, Graeme 23 Oct
 * 2026). Objective E. Mounted at /api/wish-list, behind the session guard.
 *
 *   GET  /                 every item with its vote summary (anyone signed in)
 *   POST /read-link        read a pasted link: clean it, say if it's already
 *                          on the list, else read the shop page (name, price,
 *                          picture), with an AI fallback
 *   POST /                 add an item (counts as the adder's first vote); a
 *                          duplicate becomes a vote on the existing item
 *   POST /:id/vote         +1 today — once per person per item per London day
 *   PATCH /:id             edit (founder/admins any; requester while requested)
 *   POST /:id/status       approve / ordered / received / declined (+ note)
 *                          — founder/admins
 *   DELETE /:id            soft delete — founder/admins
 *   GET  /alerts           new items this founder/admin hasn't acknowledged
 *   POST /alerts/ack       "Got it" — acknowledges up to an item id
 *
 * Rules: lib/wish-list.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  wishListAlertAcksTable,
  wishListItemsTable,
  wishListVotesTable,
  type WishListItem,
} from "@workspace/db";
import { validate } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { fetchPage, isUrlSafe } from "./ingredient-scrape";
import {
  WISH_LIST_STATUSES,
  canEditItem,
  canManageWishList,
  canVoteToday,
  cleanProductUrl,
  decodeEntities,
  findDuplicate,
  parsePriceToPence,
  readProductPage,
  storeNameFor,
  summariseVotes,
  titleFromUrl,
  unacknowledgedItems,
  type ProductPageReading,
  type VoteRow,
} from "../lib/wish-list";

const router: IRouter = Router();

interface Me { id: number; name: string | null; canManage: boolean }

async function me(req: Request): Promise<Me | null> {
  const id = req.session.userId ?? null;
  if (!id) return null;
  const [u] = await db
    .select({ name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!u) return null;
  return { id, name: u.name ?? null, canManage: canManageWishList({ email: u.email, role: u.role }) };
}

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function toClient(item: WishListItem, votes: readonly VoteRow[], viewer: Me, today: string) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    pricePence: item.pricePence,
    priceIncludesVat: item.priceIncludesVat,
    priceExVatPence: item.priceExVatPence,
    currency: item.currency,
    imageUrl: item.imageUrl,
    storeName: item.storeName,
    notes: item.notes,
    quantity: item.quantity,
    status: item.status,
    statusNote: item.statusNote,
    statusChangedAt: item.statusChangedAt?.toISOString() ?? null,
    statusChangedByName: item.statusChangedByName,
    orderedAt: item.orderedAt?.toISOString() ?? null,
    orderedByName: item.orderedByName,
    receivedAt: item.receivedAt?.toISOString() ?? null,
    createdByName: item.createdByName,
    createdAt: item.createdAt.toISOString(),
    mine: item.createdByUserId === viewer.id,
    canEdit: canEditItem(item, viewer),
    votes: summariseVotes(votes, viewer.id, today),
  };
}

async function liveItems(): Promise<WishListItem[]> {
  return db.select().from(wishListItemsTable).where(isNull(wishListItemsTable.deletedAt)).orderBy(desc(wishListItemsTable.id));
}

async function votesByItem(itemIds: number[]): Promise<Map<number, VoteRow[]>> {
  const map = new Map<number, VoteRow[]>();
  if (itemIds.length === 0) return map;
  const rows = await db
    .select({ itemId: wishListVotesTable.itemId, userId: wishListVotesTable.userId, voteDate: wishListVotesTable.voteDate })
    .from(wishListVotesTable)
    .where(inArray(wishListVotesTable.itemId, itemIds));
  for (const r of rows) {
    const list = map.get(r.itemId) ?? [];
    list.push({ userId: r.userId, voteDate: r.voteDate });
    map.set(r.itemId, list);
  }
  return map;
}

async function oneItemForClient(id: number, viewer: Me) {
  const [item] = await db.select().from(wishListItemsTable).where(and(eq(wishListItemsTable.id, id), isNull(wishListItemsTable.deletedAt)));
  if (!item) return null;
  const votes = (await votesByItem([id])).get(id) ?? [];
  return toClient(item, votes, viewer, londonDateString());
}

/** Insert today's vote; false when this person already voted today (the
 *  UNIQUE constraint is the real guard — two taps at once can't both win). */
async function addVote(itemId: number, userId: number, today: string): Promise<boolean> {
  const rows = await db
    .insert(wishListVotesTable)
    .values({ itemId, userId, voteDate: today })
    .onConflictDoNothing()
    .returning({ id: wishListVotesTable.id });
  return rows.length > 0;
}

const ALREADY_VOTED = "You've already voted for this today — you can add another vote tomorrow.";

// ── List ───────────────────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  try {
    const viewer = await me(req);
    if (!viewer) { res.status(401).json({ error: "Not signed in" }); return; }
    const today = londonDateString();
    const items = await liveItems();
    const votes = await votesByItem(items.map(i => i.id));
    res.json({
      today,
      canManage: viewer.canManage,
      items: items.map(i => toClient(i, votes.get(i.id) ?? [], viewer, today)),
    });
  } catch (err) {
    console.error("[wish-list] list error:", err);
    res.status(500).json({ error: "Couldn't load the Wish List" });
  }
});

// ── Read a pasted link ─────────────────────────────────────────────────────

const READ_TIMEOUT_MS = 20_000;

const AI_TOOL = {
  name: "wish_list_item",
  description: "The product on this shop page.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: ["string", "null"], description: "The product's name as the shop shows it, without the shop name." },
      price: { type: ["number", "null"], description: "The price of one, as a number (e.g. 29.99). Null if not shown." },
      currency: { type: ["string", "null"], description: "ISO currency code, e.g. GBP." },
      includesVat: { type: ["boolean", "null"], description: "true if that price includes VAT, false if ex VAT, null if the page doesn't say." },
    },
    required: ["title", "price", "currency", "includesVat"],
  },
};

/** Ask Claude for the name/price when the page's own markup didn't give
 *  them. Best effort — any failure just leaves the gaps for the person. */
async function aiFill(html: string, url: string, reading: ProductPageReading): Promise<ProductPageReading> {
  if (!isClaudeConfigured()) return reading;
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15_000);
  try {
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 400,
      tool_choice: { type: "tool", name: AI_TOOL.name },
      tools: [AI_TOOL],
      messages: [{
        role: "user",
        content: `What product is this shop page selling, and for how much? URL: ${url}\n<title>${decodeEntities(titleTag)}</title>\n<page>\n${decodeEntities(text)}\n</page>`,
      }],
    });
    const block = response.content.find(b => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return reading;
    const out = block.input as Record<string, unknown>;
    const aiTitle = typeof out["title"] === "string" ? out["title"].trim().slice(0, 300) : "";
    const aiPrice = parsePriceToPence(out["price"]);
    return {
      ...reading,
      title: reading.title ?? (aiTitle || null),
      pricePence: reading.pricePence ?? aiPrice,
      priceIncludesVat: reading.pricePence == null && aiPrice != null
        ? (typeof out["includesVat"] === "boolean" ? out["includesVat"] : null)
        : reading.priceIncludesVat,
      currency: reading.currency ?? (typeof out["currency"] === "string" ? out["currency"].toUpperCase().slice(0, 3) : null),
    };
  } catch (err) {
    console.warn("[wish-list] AI read failed:", err instanceof Error ? err.message : err);
    return reading;
  }
}

const readLinkInput = z.object({ url: z.string().min(1).max(4000) });

router.post("/read-link", validate(readLinkInput), async (req: Request, res: Response) => {
  try {
    const viewer = await me(req);
    if (!viewer) { res.status(401).json({ error: "Not signed in" }); return; }
    const url = cleanProductUrl((req.body as z.infer<typeof readLinkInput>).url);
    if (!url) { res.status(400).json({ error: "That doesn't look like a web link" }); return; }

    const items = await liveItems();
    const byLink = findDuplicate(items, { url });
    if (byLink) {
      res.json({ url, duplicate: await oneItemForClient(byLink.id, viewer) });
      return;
    }

    const check = isUrlSafe(url);
    if (!check.ok) { res.status(400).json({ error: check.reason }); return; }

    const fallback: ProductPageReading = {
      title: titleFromUrl(url), pricePence: null, priceIncludesVat: null, priceExVatPence: null,
      currency: null, imageUrl: null, storeName: storeNameFor(url),
    };
    let reading = fallback;
    let readOk = false;
    try {
      const html = await Promise.race([
        fetchPage(check.url),
        new Promise<never>((_r, reject) => setTimeout(() => reject(new Error("timed out")), READ_TIMEOUT_MS)),
      ]);
      const fromPage = readProductPage(html, url);
      reading = { ...fromPage, title: fromPage.title, storeName: fromPage.storeName ?? fallback.storeName };
      if (!reading.title || reading.pricePence == null) reading = await aiFill(html, url, reading);
      if (!reading.title) reading = { ...reading, title: fallback.title };
      readOk = true;
    } catch (err) {
      console.warn("[wish-list] couldn't read", url, err instanceof Error ? err.message : err);
    }

    // A near-identical name already on the list (pasted from another shop).
    const byTitle = reading.title ? findDuplicate(items, { title: reading.title }) : null;
    res.json({
      url,
      readOk,
      reading,
      duplicate: byTitle ? await oneItemForClient(byTitle.id, viewer) : null,
    });
  } catch (err) {
    console.error("[wish-list] read-link error:", err);
    res.status(500).json({ error: "Couldn't read that link" });
  }
});

// ── Add ────────────────────────────────────────────────────────────────────

const httpsUrl = z.string().max(4000).refine(v => /^https?:\/\//i.test(v), "Must be a web link");

const itemFields = {
  url: z.string().max(4000).nullable().optional(),
  title: z.string().trim().min(1, "Say what you need").max(300),
  pricePence: z.number().int().min(0).max(100_000_000).nullable().optional(),
  priceIncludesVat: z.boolean().nullable().optional(),
  priceExVatPence: z.number().int().min(0).max(100_000_000).nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  imageUrl: httpsUrl.nullable().optional(),
  storeName: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
};

const addInput = z.object(itemFields);

router.post("/", validate(addInput), async (req: Request, res: Response) => {
  try {
    const viewer = await me(req);
    if (!viewer) { res.status(401).json({ error: "Not signed in" }); return; }
    const body = req.body as z.infer<typeof addInput>;
    const url = body.url ? cleanProductUrl(body.url) : null;
    if (body.url && !url) { res.status(400).json({ error: "That doesn't look like a web link" }); return; }
    const today = londonDateString();

    const existing = findDuplicate(await liveItems(), { url, title: body.title });
    if (existing) {
      const voted = await addVote(existing.id, viewer.id, today);
      res.status(200).json({
        duplicate: true,
        voted,
        message: voted
          ? "Already on the list — added your vote instead"
          : "Already on the list — and you've already voted for it today",
        item: await oneItemForClient(existing.id, viewer),
      });
      return;
    }

    const [row] = await db.insert(wishListItemsTable).values({
      url,
      title: body.title.trim(),
      pricePence: body.pricePence ?? null,
      priceIncludesVat: body.pricePence == null ? null : body.priceIncludesVat ?? null,
      priceExVatPence: body.priceExVatPence ?? null,
      currency: (body.currency ?? "GBP").toUpperCase(),
      imageUrl: body.imageUrl ?? null,
      storeName: body.storeName?.trim() || storeNameFor(url),
      notes: body.notes?.trim() || null,
      quantity: body.quantity ?? 1,
      createdByUserId: viewer.id,
      createdByName: viewer.name,
    }).returning();
    // Asking for it counts as your first vote.
    await addVote(row.id, viewer.id, today);
    res.status(201).json({ duplicate: false, voted: true, item: await oneItemForClient(row.id, viewer) });
  } catch (err) {
    console.error("[wish-list] add error:", err);
    res.status(500).json({ error: "Couldn't add it to the Wish List" });
  }
});

// ── Vote ───────────────────────────────────────────────────────────────────

router.post("/:id/vote", validate(z.object({}).optional()), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid item" }); return; }
  try {
    const viewer = await me(req);
    if (!viewer) { res.status(401).json({ error: "Not signed in" }); return; }
    const [item] = await db.select({ id: wishListItemsTable.id }).from(wishListItemsTable)
      .where(and(eq(wishListItemsTable.id, id), isNull(wishListItemsTable.deletedAt)));
    if (!item) { res.status(404).json({ error: "That item isn't on the list any more" }); return; }
    const today = londonDateString();
    const existing = (await votesByItem([id])).get(id) ?? [];
    if (!canVoteToday(existing, viewer.id, today) || !(await addVote(id, viewer.id, today))) {
      res.status(409).json({ error: ALREADY_VOTED });
      return;
    }
    res.json({ item: await oneItemForClient(id, viewer) });
  } catch (err) {
    console.error("[wish-list] vote error:", err);
    res.status(500).json({ error: "Couldn't save your vote" });
  }
});

// ── Edit ───────────────────────────────────────────────────────────────────

const editInput = z.object({
  ...itemFields,
  title: itemFields.title.optional(),
});

router.patch("/:id", validate(editInput), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid item" }); return; }
  try {
    const viewer = await me(req);
    if (!viewer) { res.status(401).json({ error: "Not signed in" }); return; }
    const [item] = await db.select().from(wishListItemsTable).where(and(eq(wishListItemsTable.id, id), isNull(wishListItemsTable.deletedAt)));
    if (!item) { res.status(404).json({ error: "That item isn't on the list any more" }); return; }
    if (!canEditItem(item, viewer)) {
      res.status(403).json({ error: "Only the person who asked can change it, and only until it's approved" });
      return;
    }
    const body = req.body as z.infer<typeof editInput>;
    const patch: Partial<typeof wishListItemsTable.$inferInsert> = { updatedAt: new Date() };
    if (body.url !== undefined) {
      const url = body.url ? cleanProductUrl(body.url) : null;
      if (body.url && !url) { res.status(400).json({ error: "That doesn't look like a web link" }); return; }
      patch.url = url;
    }
    if (body.title !== undefined) patch.title = body.title.trim();
    if (body.pricePence !== undefined) patch.pricePence = body.pricePence;
    if (body.priceIncludesVat !== undefined) patch.priceIncludesVat = body.priceIncludesVat;
    if (body.priceExVatPence !== undefined) patch.priceExVatPence = body.priceExVatPence;
    if (body.currency !== undefined) patch.currency = body.currency.toUpperCase();
    if (body.imageUrl !== undefined) patch.imageUrl = body.imageUrl;
    if (body.storeName !== undefined) patch.storeName = body.storeName?.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    await db.update(wishListItemsTable).set(patch).where(eq(wishListItemsTable.id, id));
    res.json({ item: await oneItemForClient(id, viewer) });
  } catch (err) {
    console.error("[wish-list] edit error:", err);
    res.status(500).json({ error: "Couldn't save the change" });
  }
});

// ── Status (founder/admins) ────────────────────────────────────────────────

const statusInput = z.object({
  status: z.enum(WISH_LIST_STATUSES),
  note: z.string().trim().max(1000).nullable().optional(),
});

router.post("/:id/status", validate(statusInput), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid item" }); return; }
  try {
    const viewer = await me(req);
    if (!viewer) { res.status(401).json({ error: "Not signed in" }); return; }
    if (!viewer.canManage) { res.status(403).json({ error: "Only Graeme or an admin can change this" }); return; }
    const { status, note } = req.body as z.infer<typeof statusInput>;
    const now = new Date();
    const patch: Partial<typeof wishListItemsTable.$inferInsert> = {
      status,
      statusNote: note?.trim() || null,
      statusChangedAt: now,
      statusChangedByName: viewer.name,
      updatedAt: now,
    };
    if (status === "ordered") { patch.orderedAt = now; patch.orderedByUserId = viewer.id; patch.orderedByName = viewer.name; }
    if (status === "received") patch.receivedAt = now;
    const rows = await db.update(wishListItemsTable).set(patch)
      .where(and(eq(wishListItemsTable.id, id), isNull(wishListItemsTable.deletedAt)))
      .returning({ id: wishListItemsTable.id });
    if (rows.length === 0) { res.status(404).json({ error: "That item isn't on the list any more" }); return; }
    res.json({ item: await oneItemForClient(id, viewer) });
  } catch (err) {
    console.error("[wish-list] status error:", err);
    res.status(500).json({ error: "Couldn't change the status" });
  }
});

// ── Delete (founder/admins; soft) ──────────────────────────────────────────

router.delete("/:id", validate(z.object({}).optional()), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid item" }); return; }
  try {
    const viewer = await me(req);
    if (!viewer) { res.status(401).json({ error: "Not signed in" }); return; }
    if (!viewer.canManage) { res.status(403).json({ error: "Only Graeme or an admin can remove items" }); return; }
    const rows = await db.update(wishListItemsTable)
      .set({ deletedAt: new Date(), deletedByName: viewer.name })
      .where(and(eq(wishListItemsTable.id, id), isNull(wishListItemsTable.deletedAt)))
      .returning({ id: wishListItemsTable.id });
    if (rows.length === 0) { res.status(404).json({ error: "Already removed" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[wish-list] delete error:", err);
    res.status(500).json({ error: "Couldn't remove it" });
  }
});

// ── Must-dismiss pop-up for the founder/admins ─────────────────────────────

router.get("/alerts", async (req: Request, res: Response) => {
  try {
    const viewer = await me(req);
    if (!viewer || !viewer.canManage) { res.json({ items: [] }); return; }
    const [ack] = await db.select().from(wishListAlertAcksTable).where(eq(wishListAlertAcksTable.userId, viewer.id));
    // Only the last 60 items can be "new"; older ones were seen long ago.
    const recent = await db.select().from(wishListItemsTable)
      .where(isNull(wishListItemsTable.deletedAt))
      .orderBy(desc(wishListItemsTable.id))
      .limit(60);
    const fresh = unacknowledgedItems(recent, viewer.id, ack?.ackedUpToId ?? null);
    const votes = await votesByItem(fresh.map(i => i.id));
    const today = londonDateString();
    res.json({ items: fresh.map(i => toClient(i, votes.get(i.id) ?? [], viewer, today)) });
  } catch (err) {
    console.error("[wish-list] alerts error:", err);
    res.status(500).json({ error: "Couldn't check for new requests" });
  }
});

const ackInput = z.object({ upToId: z.number().int().min(0) });

router.post("/alerts/ack", validate(ackInput), async (req: Request, res: Response) => {
  try {
    const viewer = await me(req);
    if (!viewer || !viewer.canManage) { res.status(403).json({ error: "Not for you" }); return; }
    const { upToId } = req.body as z.infer<typeof ackInput>;
    // Never move the marker backwards (another tab may have acknowledged more).
    await db.insert(wishListAlertAcksTable)
      .values({ userId: viewer.id, ackedUpToId: upToId, ackedAt: new Date() })
      .onConflictDoUpdate({
        target: wishListAlertAcksTable.userId,
        set: { ackedUpToId: sql`GREATEST(${wishListAlertAcksTable.ackedUpToId}, ${upToId})`, ackedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (err) {
    console.error("[wish-list] ack error:", err);
    res.status(500).json({ error: "Couldn't save — try again" });
  }
});

export default router;
