/**
 * Planned emails on the marketing calendar (Graeme, 2026-09-30), mounted at
 * /api/marketing-calendar/emails. "Campaigns are basically periods of
 * emails": each planned email sits on a send day and belongs to the campaign
 * (calendar event) whose dates contain that day — worked out on every read
 * by campaignForDate(), never stored, so moving an email's date re-files it.
 * Objectives I (the whole email plan in one place, with Klaviyo's reality
 * beside it) and F (every change attributed and kept; deletes are soft).
 *
 * Access: the founder, or anyone granted "founder.sales" — the same guard as
 * the rest of the marketing calendar. Nothing here writes to Klaviyo; a plan
 * only stores the id of the Klaviyo campaign it has been linked to.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, marketingEmailsTable, marketingEmailHistoryTable, marketingEventsTable, usersTable } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import {
  EMAIL_AUDIENCE_KEYS, EMAIL_STATUSES, campaignForDate, daysBetween, describeEmailFieldChanges,
  describeEmailMove, describeKlaviyoLink, diffEmailFields, type FieldChange,
} from "@workspace/marketing-calendar";
import { validate, validateQuery } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IsoDate = z.string().regex(DATE_RE, "Use YYYY-MM-DD");
const HmTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

type EmailRow = typeof marketingEmailsTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

async function sessionUser(req: Request): Promise<{ id: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Live campaigns (calendar events) touching [from, to]. */
async function campaignsBetween(from: string, to: string, tx: Tx | typeof db = db) {
  return tx.select({
    id: marketingEventsTable.id, title: marketingEventsTable.name,
    startDate: marketingEventsTable.startDate, endDate: marketingEventsTable.endDate,
  }).from(marketingEventsTable)
    .where(and(isNull(marketingEventsTable.deletedAt), gte(marketingEventsTable.endDate, from), lte(marketingEventsTable.startDate, to)));
}

async function campaignOn(date: string, tx: Tx | typeof db = db) {
  return campaignForDate(date, await campaignsBetween(date, date, tx));
}

function emailJson(e: EmailRow, campaign: { id: number; title: string } | null) {
  return {
    id: e.id,
    sendDate: e.sendDate,
    sendTime: e.sendTime,
    subject: e.subject,
    offer: e.offer,
    coreMessage: e.coreMessage,
    smsSuggestion: e.smsSuggestion,
    cadence: e.cadence,
    audiences: e.audiences ?? [],
    audienceOther: e.audienceOther,
    websiteChange: e.websiteChange,
    metaChange: e.metaChange,
    notes: e.notes,
    status: e.status,
    klaviyoCampaignId: e.klaviyoCampaignId,
    klaviyoCampaignName: e.klaviyoCampaignName,
    // Derived by date — see campaignForDate.
    campaignId: campaign?.id ?? null,
    campaignTitle: campaign?.title ?? null,
    createdBy: e.createdByName ? { id: e.createdById, name: e.createdByName } : null,
    updatedBy: e.updatedByName ? { id: e.updatedById, name: e.updatedByName } : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

async function oneEmailJson(e: EmailRow) {
  return emailJson(e, await campaignOn(e.sendDate));
}

async function loadHistory(emailId: number) {
  const rows = await db.select().from(marketingEmailHistoryTable)
    .where(eq(marketingEmailHistoryTable.emailId, emailId))
    .orderBy(desc(marketingEmailHistoryTable.createdAt), desc(marketingEmailHistoryTable.id));
  return rows.map(h => ({ id: h.id, userId: h.userId, userName: h.userName, action: h.action, summary: h.summary, at: h.createdAt.toISOString() }));
}

// ── List: live planned emails sending in [from, to] ────────────────────────
const ListQuery = z.object({ from: IsoDate, to: IsoDate })
  .refine(q => q.to >= q.from, { message: "to must be on or after from" })
  .refine(q => daysBetween(q.from, q.to) <= 800, { message: "Range too long (max ~2 years)" });

router.get("/", validateQuery(ListQuery), async (_req: Request, res: Response) => {
  const { from, to } = res.locals["query"] as z.infer<typeof ListQuery>;
  const rows = await db.select().from(marketingEmailsTable)
    .where(and(isNull(marketingEmailsTable.deletedAt), gte(marketingEmailsTable.sendDate, from), lte(marketingEmailsTable.sendDate, to)))
    .orderBy(asc(marketingEmailsTable.sendDate), asc(marketingEmailsTable.sendTime), asc(marketingEmailsTable.id));
  const campaigns = rows.length ? await campaignsBetween(from, to) : [];
  res.json({
    today: londonToday(),
    emails: rows.map(r => {
      const c = campaignForDate(r.sendDate, campaigns);
      return emailJson(r, c ? { id: c.id, title: c.title } : null);
    }),
  });
});

// ── One email + its history ────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, id));
  if (!row) { res.status(404).json({ error: "Email not found" }); return; }
  res.json({ email: await oneEmailJson(row), deleted: row.deletedAt != null, deletedBy: row.deletedByName, history: await loadHistory(id) });
});

// ── Create ─────────────────────────────────────────────────────────────────
const TextField = (max: number) => z.string().trim().max(max).nullish();
const Fields = {
  sendTime: HmTime.nullish().or(z.literal("")),
  offer: TextField(2000),
  coreMessage: TextField(4000),
  smsSuggestion: TextField(1000),
  cadence: TextField(200),
  audiences: z.array(z.enum(EMAIL_AUDIENCE_KEYS)).max(EMAIL_AUDIENCE_KEYS.length).optional(),
  audienceOther: TextField(200),
  websiteChange: TextField(2000),
  metaChange: TextField(2000),
  notes: TextField(10000),
  status: z.enum(EMAIL_STATUSES).optional(),
};

const CreateBody = z.object({
  sendDate: IsoDate,
  subject: z.string().trim().min(1, "Give it a subject line").max(300),
  ...Fields,
});

router.post("/", validate(CreateBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof CreateBody>;
  const user = await sessionUser(req);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(marketingEmailsTable).values({
      sendDate: b.sendDate,
      sendTime: b.sendTime || null,
      subject: b.subject,
      offer: b.offer || null,
      coreMessage: b.coreMessage || null,
      smsSuggestion: b.smsSuggestion || null,
      cadence: b.cadence || null,
      audiences: b.audiences ?? [],
      audienceOther: b.audienceOther || null,
      websiteChange: b.websiteChange || null,
      metaChange: b.metaChange || null,
      notes: b.notes || null,
      status: b.status ?? "planned",
      createdById: user.id, createdByName: user.name,
      updatedById: user.id, updatedByName: user.name,
    }).returning();
    await tx.insert(marketingEmailHistoryTable).values({
      emailId: created.id, userId: user.id, userName: user.name, action: "created", summary: "added this email",
    });
    return created;
  });
  res.status(201).json({ email: await oneEmailJson(row) });
});

// ── Edit fields (autosave from the email modal) ────────────────────────────
const PatchBody = z.object({
  subject: z.string().trim().min(1, "The subject line can't be empty").max(300).optional(),
  ...Fields,
});

// One person's run of autosaves within this window folds into one history line.
const EDIT_MERGE_MINUTES = 10;

router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof PatchBody>;
  const user = await sessionUser(req);

  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, id)).for("update");
    if (!before || before.deletedAt) return null;

    const patch: Record<string, string | string[] | null | undefined> = {};
    for (const key of ["subject", "sendTime", "offer", "coreMessage", "smsSuggestion", "cadence", "audienceOther", "websiteChange", "metaChange", "notes", "status"] as const) {
      const v = b[key];
      if (v !== undefined) patch[key] = key === "subject" || key === "status" ? v : (v || null);
    }
    if (b.audiences !== undefined) patch["audiences"] = b.audiences;
    const beforeFields: Record<string, string | string[] | null> = {
      subject: before.subject, sendTime: before.sendTime, offer: before.offer, coreMessage: before.coreMessage,
      smsSuggestion: before.smsSuggestion, cadence: before.cadence, audiences: before.audiences,
      audienceOther: before.audienceOther, websiteChange: before.websiteChange, metaChange: before.metaChange,
      notes: before.notes, status: before.status,
    };
    const changes = diffEmailFields(beforeFields, patch);
    if (Object.keys(changes).length === 0) return before;

    const set: Partial<typeof marketingEmailsTable.$inferInsert> = { updatedById: user.id, updatedByName: user.name, updatedAt: new Date() };
    for (const key of Object.keys(changes)) (set as Record<string, unknown>)[key] = patch[key];
    const [after] = await tx.update(marketingEmailsTable).set(set).where(eq(marketingEmailsTable.id, id)).returning();

    const [last] = await tx.select().from(marketingEmailHistoryTable)
      .where(eq(marketingEmailHistoryTable.emailId, id))
      .orderBy(desc(marketingEmailHistoryTable.createdAt), desc(marketingEmailHistoryTable.id))
      .limit(1);
    const recent = last && last.action === "edited" && last.userId === user.id
      && Date.now() - last.createdAt.getTime() < EDIT_MERGE_MINUTES * 60_000;
    if (recent) {
      const merged: Record<string, FieldChange> = { ...((last.changes as Record<string, FieldChange> | null) ?? {}) };
      for (const [k, v] of Object.entries(changes)) merged[k] = { from: merged[k]?.from ?? v.from, to: v.to };
      await tx.update(marketingEmailHistoryTable).set({
        changes: merged, summary: describeEmailFieldChanges(merged) ?? "edited this email", createdAt: new Date(),
      }).where(eq(marketingEmailHistoryTable.id, last.id));
    } else {
      await tx.insert(marketingEmailHistoryTable).values({
        emailId: id, userId: user.id, userName: user.name, action: "edited",
        summary: describeEmailFieldChanges(changes) ?? "edited this email", changes,
      });
    }
    return after;
  });
  if (!result) { res.status(404).json({ error: "Email not found (it may have been deleted)" }); return; }
  res.json({ email: await oneEmailJson(result) });
});

// ── Move to another day (drag on the month grid, or the modal's date) ──────
const DateBody = z.object({ sendDate: IsoDate });

router.put("/:id/date", validate(DateBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { sendDate } = req.body as z.infer<typeof DateBody>;
  const user = await sessionUser(req);
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, id)).for("update");
    if (!before || before.deletedAt) return null;
    if (before.sendDate === sendDate) return before;
    const [fromC, toC] = await Promise.all([campaignOn(before.sendDate, tx), campaignOn(sendDate, tx)]);
    const [after] = await tx.update(marketingEmailsTable).set({
      sendDate, updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(marketingEmailsTable.id, id)).returning();
    await tx.insert(marketingEmailHistoryTable).values({
      emailId: id, userId: user.id, userName: user.name, action: "moved",
      summary: describeEmailMove(before.sendDate, sendDate, fromC?.title ?? null, toC?.title ?? null) ?? "moved it",
      changes: { sendDate: { from: before.sendDate, to: sendDate }, campaignId: { from: fromC?.id ?? null, to: toC?.id ?? null } },
    });
    return after;
  });
  if (!result) { res.status(404).json({ error: "Email not found (it may have been deleted)" }); return; }
  res.json({ email: await oneEmailJson(result) });
});

// ── Link to / unlink from the real Klaviyo send ────────────────────────────
const KlaviyoBody = z.object({
  klaviyoCampaignId: z.string().trim().min(1).max(100).nullable(),
  klaviyoCampaignName: z.string().trim().max(300).nullish(),
});

router.put("/:id/klaviyo", validate(KlaviyoBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof KlaviyoBody>;
  const user = await sessionUser(req);
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, id)).for("update");
    if (!before || before.deletedAt) return { status: 404 as const };
    if (before.klaviyoCampaignId === b.klaviyoCampaignId) return { status: 200 as const, row: before };
    if (b.klaviyoCampaignId) {
      const [taken] = await tx.select({ id: marketingEmailsTable.id, subject: marketingEmailsTable.subject }).from(marketingEmailsTable)
        .where(and(eq(marketingEmailsTable.klaviyoCampaignId, b.klaviyoCampaignId), isNull(marketingEmailsTable.deletedAt), ne(marketingEmailsTable.id, id)));
      if (taken) return { status: 409 as const, error: `That Klaviyo email is already linked to the planned email “${taken.subject}”.` };
    }
    const nextName = b.klaviyoCampaignId ? (b.klaviyoCampaignName || b.klaviyoCampaignId) : null;
    const [after] = await tx.update(marketingEmailsTable).set({
      klaviyoCampaignId: b.klaviyoCampaignId, klaviyoCampaignName: nextName,
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(marketingEmailsTable.id, id)).returning();
    const change = describeKlaviyoLink(before.klaviyoCampaignName ?? before.klaviyoCampaignId, nextName)
      ?? { action: "linked" as const, summary: `linked it to the Klaviyo email “${nextName ?? ""}”` };
    await tx.insert(marketingEmailHistoryTable).values({
      emailId: id, userId: user.id, userName: user.name, action: change.action, summary: change.summary,
      changes: { klaviyoCampaignId: { from: before.klaviyoCampaignId, to: b.klaviyoCampaignId } },
    });
    return { status: 200 as const, row: after };
  });
  if (result.status === 404) { res.status(404).json({ error: "Email not found (it may have been deleted)" }); return; }
  if (result.status === 409) { res.status(409).json({ error: result.error }); return; }
  res.json({ email: await oneEmailJson(result.row) });
});

// ── Delete (soft — the row and its history stay) ───────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const ok = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, id)).for("update");
    if (!before || before.deletedAt) return false;
    await tx.update(marketingEmailsTable).set({
      deletedAt: new Date(), deletedById: user.id, deletedByName: user.name,
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(marketingEmailsTable.id, id));
    await tx.insert(marketingEmailHistoryTable).values({
      emailId: id, userId: user.id, userName: user.name, action: "deleted", summary: "deleted this email",
    });
    return true;
  });
  if (!ok) { res.status(404).json({ error: "Email not found (it may already have been deleted)" }); return; }
  res.json({ ok: true });
});

export default router;
