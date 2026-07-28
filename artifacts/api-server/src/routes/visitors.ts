// Digital visitor book.
//
// The check-in screen (/visitor-check-in) is a kiosk the team hands to a
// visitor: they type their name, answer the illness question, and tick the
// jewellery + PPE declarations. The server stamps signed_in_at, so the time on
// the record is evidence rather than something typed in.
//
// Entry is refused when the visitor reports sickness or diarrhoea in the last
// 48 hours. The row is still written (entry_permitted = false) — an inspector
// wants to see that we asked and acted, not a gap in the book.
//
// The HACCP → Visitor Book report reads GET / over a date range; the kiosk and
// the dashboard badge read GET /on-site (anyone with no sign-out).

import { Router, type IRouter } from "express";
import { db, visitorLogTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, isNull, desc } from "drizzle-orm";
import * as z from "zod";
import { londonEndOfDay, londonStartOfDay } from "../lib/london-time";

const router: IRouter = Router();

const checkInSchema = z.object({
  visitorName: z.string().trim().min(1, "Name is required").max(120),
  company: z.string().trim().max(120).optional(),
  visiting: z.string().trim().max(120).optional(),
  purpose: z.string().trim().max(300).optional(),
  // TRUE = they HAVE had sickness/diarrhoea in the last 48h (the fail case).
  illnessLast48h: z.boolean(),
  jewelleryRemoved: z.boolean(),
  ppeAgreed: z.boolean(),
});

/** The logged-in staff account the kiosk is running as — supervision trail. */
async function sessionUser(userId: number | null | undefined) {
  if (!userId) return { id: null as number | null, name: null as string | null };
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return { id: userId, name: u?.name ?? null };
}

// ── Check in ────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const parsed = checkInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  // A visitor who reports recent illness is not let into the production area.
  // The other two declarations are recorded as-answered but don't block —
  // jewellery and PPE are things a host can fix on the spot at the door.
  const entryPermitted = !d.illnessLast48h;

  const recorder = await sessionUser(req.session?.userId);

  const [entry] = await db.insert(visitorLogTable).values({
    visitorName: d.visitorName,
    company: d.company || null,
    visiting: d.visiting || null,
    purpose: d.purpose || null,
    illnessLast48h: d.illnessLast48h,
    jewelleryRemoved: d.jewelleryRemoved,
    ppeAgreed: d.ppeAgreed,
    entryPermitted,
    recordedByUserId: recorder.id,
    recordedByName: recorder.name,
    // Refused visitors never entered, so close the record immediately —
    // otherwise they'd sit in the on-site list and the fire roll-call.
    signedOutAt: entryPermitted ? null : new Date(),
  }).returning();

  res.json(entry);
});

// ── Currently on site (fire roll-call) ──────────────────────────────────────
router.get("/on-site", async (_req, res) => {
  const rows = await db
    .select()
    .from(visitorLogTable)
    .where(and(isNull(visitorLogTable.signedOutAt), eq(visitorLogTable.entryPermitted, true)))
    .orderBy(desc(visitorLogTable.signedInAt));
  res.json(rows);
});

// ── Log over a date range ───────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;

  // Midday probe so the London day boundary lands on the right calendar date
  // regardless of BST — same idiom as the temperature-records report.
  const filters = [];
  if (from) filters.push(gte(visitorLogTable.signedInAt, londonStartOfDay(new Date(`${from}T12:00:00Z`))));
  if (to) filters.push(lte(visitorLogTable.signedInAt, londonEndOfDay(new Date(`${to}T12:00:00Z`))));

  const rows = await db
    .select()
    .from(visitorLogTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(visitorLogTable.signedInAt));

  res.json(rows);
});

// ── Sign out ────────────────────────────────────────────────────────────────
router.patch("/:id/sign-out", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const signer = await sessionUser(req.session?.userId);

  // Only close a record that's still open, so a second tap can't overwrite the
  // original sign-out time.
  const [updated] = await db
    .update(visitorLogTable)
    .set({
      signedOutAt: new Date(),
      signedOutByUserId: signer.id,
      signedOutByName: signer.name,
    })
    .where(and(eq(visitorLogTable.id, id), isNull(visitorLogTable.signedOutAt)))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Visitor not found or already signed out" });
    return;
  }
  res.json(updated);
});

// ── Manager note on an entry ────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = z.object({ notes: z.string().max(1000).nullable() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }

  const [updated] = await db
    .update(visitorLogTable)
    .set({ notes: parsed.data.notes || null })
    .where(eq(visitorLogTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Visitor not found" });
    return;
  }
  res.json(updated);
});

export default router;
