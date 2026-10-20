/**
 * The offer library (Graeme, 2026-10-20), mounted at
 * /api/marketing-calendar/offers. Objective I.
 *
 * "Keep a list of previous offers … 'Free pack for orders over 39.95' just
 * becomes a list item; we can type new ones, add, edit, delete."
 *
 * Phases hold their offers as TEXT, so editing or deleting an offer here
 * never changes a phase that used it. Delete is soft; archive keeps an
 * offer but stops it being suggested. Same access as the calendar.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, marketingEventsTable, marketingOffersTable, usersTable } from "@workspace/db";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { NOTE_EVENT_TYPE, cleanOfferText, offerKey, offerUsage } from "@workspace/marketing-calendar";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

type OfferRow = typeof marketingOffersTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function sessionUser(req: Request): Promise<{ id: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

function offerJson(o: OfferRow, usedBy: number) {
  return {
    id: o.id,
    text: o.text,
    notes: o.notes,
    archived: o.archived,
    /** Live phases whose offers include this text. */
    usedBy,
    updatedBy: o.updatedByName,
    updatedAt: o.updatedAt.toISOString(),
  };
}

async function usage(): Promise<Map<string, number>> {
  const phases = await db.select({ offers: marketingEventsTable.offers }).from(marketingEventsTable)
    .where(and(isNull(marketingEventsTable.deletedAt), ne(marketingEventsTable.eventType, NOTE_EVENT_TYPE)));
  return offerUsage(phases);
}

/** A live offer with the same wording (ignoring case and spaces), if any. */
async function sameWording(conn: Tx | typeof db, text: string, exceptId?: number): Promise<OfferRow | null> {
  const rows = await conn.select().from(marketingOffersTable).where(isNull(marketingOffersTable.deletedAt));
  return rows.find(r => r.id !== exceptId && offerKey(r.text) === offerKey(text)) ?? null;
}

/**
 * Add the offers a phase uses that the library doesn't have yet (typing a
 * new offer on a phase adds it to the list). Inside the phase's transaction.
 */
export async function addOffersToLibrary(tx: Tx, offers: readonly string[], user: { id: number; name: string }): Promise<void> {
  if (offers.length === 0) return;
  const live = await tx.select({ text: marketingOffersTable.text }).from(marketingOffersTable).where(isNull(marketingOffersTable.deletedAt));
  const have = new Set(live.map(r => offerKey(r.text)));
  for (const raw of offers) {
    const text = cleanOfferText(raw);
    if (!text || have.has(offerKey(text))) continue;
    have.add(offerKey(text));
    await tx.insert(marketingOffersTable).values({
      text, createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
    }).onConflictDoNothing();
  }
}

router.get("/", async (_req: Request, res: Response) => {
  const [rows, used] = await Promise.all([
    db.select().from(marketingOffersTable).where(isNull(marketingOffersTable.deletedAt))
      .orderBy(asc(marketingOffersTable.archived), asc(marketingOffersTable.text)),
    usage(),
  ]);
  res.json({ offers: rows.map(r => offerJson(r, used.get(offerKey(r.text)) ?? 0)) });
});

const OfferText = z.string().trim().min(1, "Type the offer").max(300);
const Notes = z.string().trim().max(2000).nullish();

router.post("/", validate(z.object({ text: OfferText, notes: Notes })), async (req: Request, res: Response) => {
  const b = req.body as { text: string; notes?: string | null };
  const user = await sessionUser(req);
  const text = cleanOfferText(b.text);
  const clash = await sameWording(db, text);
  if (clash) { res.status(409).json({ error: `“${clash.text}” is already in the list${clash.archived ? " (archived)" : ""}.` }); return; }
  const [row] = await db.insert(marketingOffersTable).values({
    text, notes: b.notes || null, createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
  }).returning();
  res.status(201).json({ offer: offerJson(row, (await usage()).get(offerKey(text)) ?? 0) });
});

const PatchBody = z.object({ text: OfferText.optional(), notes: Notes, archived: z.boolean().optional() });

router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof PatchBody>;
  const user = await sessionUser(req);
  const [before] = await db.select().from(marketingOffersTable).where(eq(marketingOffersTable.id, id));
  if (!before || before.deletedAt) { res.status(404).json({ error: "Offer not found (it may have been deleted)" }); return; }
  const text = b.text !== undefined ? cleanOfferText(b.text) : undefined;
  if (text !== undefined) {
    const clash = await sameWording(db, text, id);
    if (clash) { res.status(409).json({ error: `“${clash.text}” is already in the list.` }); return; }
  }
  const [row] = await db.update(marketingOffersTable).set({
    ...(text !== undefined ? { text } : {}),
    ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
    ...(b.archived !== undefined ? { archived: b.archived } : {}),
    updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
  }).where(eq(marketingOffersTable.id, id)).returning();
  res.json({ offer: offerJson(row, (await usage()).get(offerKey(row.text)) ?? 0) });
});

// Soft delete. Phases that used it keep their own copy of the words.
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const [row] = await db.update(marketingOffersTable).set({
    deletedAt: new Date(), deletedById: user.id, deletedByName: user.name, updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
  }).where(and(eq(marketingOffersTable.id, id), isNull(marketingOffersTable.deletedAt))).returning();
  if (!row) { res.status(404).json({ error: "Offer not found (it may already have been deleted)" }); return; }
  res.json({ ok: true });
});

// Undo a delete (the toast's Undo) — unless the same words were added again since.
router.post("/:id/restore", validate(z.object({}).passthrough()), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const [before] = await db.select().from(marketingOffersTable).where(eq(marketingOffersTable.id, id));
  if (!before) { res.status(404).json({ error: "Offer not found" }); return; }
  if (before.deletedAt == null) { res.json({ ok: true }); return; }
  if (await sameWording(db, before.text, id)) { res.status(409).json({ error: "That offer is already back in the list." }); return; }
  await db.update(marketingOffersTable).set({
    deletedAt: null, deletedById: null, deletedByName: null, updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
  }).where(eq(marketingOffersTable.id, id));
  res.json({ ok: true });
});

export default router;
