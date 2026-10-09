/**
 * Marketing calendar API (Graeme, 2026-09-29): the founder and the marketing
 * team plan campaigns, emails, offers and launches together on a month grid
 * and a timeline. Objectives I (always something on, planned well ahead) and
 * F (every change is attributed and kept — nothing silently overwritten or
 * lost).
 *
 * Access: the founder, or anyone granted "founder.sales" (Sales & Marketing).
 * Every write is stamped with the signed-in person and adds a line to the
 * event's history. Deletes are soft, so the history survives.
 *
 * Dates are plain calendar days (YYYY-MM-DD). Any range can be listed — the
 * old 6-week limit is gone so Black Friday can be planned months out.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, marketingEventsTable, marketingEventHistoryTable, testBoxesTable, testBoxDeliveriesTable, usersTable } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import {
  NOTE_EVENT_TYPE, addDays, describeDateChange, describeFieldChanges, diffFields, daysBetween, noteDatesValid, type FieldChange,
} from "@workspace/marketing-calendar";
import { syncTestBox, testBoxCalendarInfo } from "../lib/test-box-data";
import { validate, validateQuery } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { klaviyoEmailsForRange } from "../lib/klaviyo-campaign-calendar";
import { runKlaviyoAutoLink, type AutoLinkOutcome } from "../lib/klaviyo-auto-link-run";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import type Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IsoDate = z.string().regex(DATE_RE, "Use YYYY-MM-DD");

// Types a person can pick. "test_box" is set only by the test-box tool —
// those events are created, dated and deleted from the test box itself.
// "note" (2026-10-01) is a one-day idea or note on a day: it is created as a
// note and stays one (a phase can't turn into a note or back), it is always
// one day, and it never takes emails (filingEvents in @workspace/marketing-calendar).
export const EVENT_TYPES = ["campaign", "email", "offer", "product_launch", "seasonal", "other", NOTE_EVENT_TYPE] as const;
export const CHANNELS = ["vip_email", "public_email", "social", "website", "ads", "sms", "in_box_insert", "other"] as const;
export const STATUSES = ["idea", "planned", "live", "done"] as const;

type EventRow = typeof marketingEventsTable.$inferSelect;

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

async function sessionUser(req: Request): Promise<{ id: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

function eventJson(e: EventRow) {
  return {
    id: e.id,
    title: e.name,
    startDate: e.startDate,
    endDate: e.endDate,
    summary: e.summary,
    notes: e.notes,
    offer: e.offer,
    type: e.eventType,
    channels: e.channels ?? [],
    audience: e.audience,
    status: e.status,
    source: e.source,
    createdBy: e.createdByName ? { id: e.createdById, name: e.createdByName } : null,
    updatedBy: e.updatedByName ? { id: e.updatedById, name: e.updatedByName } : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    testBoxId: e.testBoxId,
  };
}

/** Events as JSON, test-box events carrying their box's name and deadlines. */
async function eventsJson(rows: EventRow[]) {
  const info = await testBoxCalendarInfo(rows.map(r => r.testBoxId).filter((x): x is number => x != null));
  return rows.map(r => ({ ...eventJson(r), testBox: r.testBoxId != null ? info.get(r.testBoxId) ?? null : null }));
}
async function oneEventJson(row: EventRow) {
  return (await eventsJson([row]))[0];
}

function historyJson(h: typeof marketingEventHistoryTable.$inferSelect) {
  return {
    id: h.id,
    userId: h.userId,
    userName: h.userName,
    action: h.action,
    summary: h.summary,
    at: h.createdAt.toISOString(),
  };
}

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── List: every live event overlapping [from, to] ──────────────────────────
const ListQuery = z.object({ from: IsoDate, to: IsoDate })
  .refine(q => q.to >= q.from, { message: "to must be on or after from" })
  .refine(q => daysBetween(q.from, q.to) <= 800, { message: "Range too long (max ~2 years)" });

router.get("/events", validateQuery(ListQuery), async (_req: Request, res: Response) => {
  const { from, to } = res.locals["query"] as z.infer<typeof ListQuery>;
  const rows = await db.select().from(marketingEventsTable)
    .where(and(
      isNull(marketingEventsTable.deletedAt),
      gte(marketingEventsTable.endDate, from),
      lte(marketingEventsTable.startDate, to),
    ))
    .orderBy(asc(marketingEventsTable.startDate), asc(marketingEventsTable.id));
  res.json({ today: londonToday(), events: await eventsJson(rows) });
});

// ── Klaviyo emails in the range (read-only) ────────────────────────────────
// Sent and scheduled one-off email campaigns on their send day, so offers
// and the emails announcing them sit in one place (Graeme, 2026-09-30).
// A Klaviyo hiccup never breaks the calendar — it answers with an error flag.
// Drafts come too (2026-09-30) — the page shows them only where they help
// (linking, approvals, the List view). recentDrafts=1 also returns drafts
// edited in the last ~4 months whatever their placeholder day, for linking.
const KlaviyoQuery = z.object({ from: IsoDate, to: IsoDate, recentDrafts: z.enum(["0", "1"]).optional() })
  .refine(q => q.to >= q.from, { message: "to must be on or after from" })
  .refine(q => daysBetween(q.from, q.to) <= 800, { message: "Range too long (max ~2 years)" });

router.get("/klaviyo-emails", validateQuery(KlaviyoQuery), async (_req: Request, res: Response) => {
  const { from, to, recentDrafts } = res.locals["query"] as z.infer<typeof KlaviyoQuery>;
  try {
    const out = await klaviyoEmailsForRange(from, to, { withRecentDrafts: recentDrafts === "1" });
    // Auto-link (2026-10-09): plans and the Klaviyo emails built for them
    // link themselves when the match is clear; the rest come back as
    // suggestions. A failure here never stops the calendar showing Klaviyo.
    let auto: AutoLinkOutcome = { autoLinked: [], suggestions: [] };
    if (out.connected) {
      try { auto = await runKlaviyoAutoLink(); } catch (err) {
        console.error("[marketing-calendar] Klaviyo auto-link failed:", err instanceof Error ? err.message : String(err));
      }
    }
    res.json({ ...out, ...auto });
  } catch (err) {
    console.error("[marketing-calendar] Klaviyo emails failed:", err instanceof Error ? err.message : String(err));
    res.json({ connected: true, emails: [], error: "Couldn't reach Klaviyo just now" });
  }
});

// ── One event + its history ────────────────────────────────────────────────
async function loadHistory(eventId: number) {
  const rows = await db.select().from(marketingEventHistoryTable)
    .where(eq(marketingEventHistoryTable.eventId, eventId))
    .orderBy(desc(marketingEventHistoryTable.createdAt), desc(marketingEventHistoryTable.id));
  return rows.map(historyJson);
}

router.get("/events/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, id));
  if (!row) { res.status(404).json({ error: "Event not found" }); return; }
  res.json({ event: await oneEventJson(row), deleted: row.deletedAt != null, deletedBy: row.deletedByName, history: await loadHistory(id) });
});

router.get("/events/:id/history", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  res.json({ history: await loadHistory(id) });
});

// ── Create ─────────────────────────────────────────────────────────────────
const TextField = (max: number) => z.string().trim().max(max).nullish();

const CreateBody = z.object({
  title: z.string().trim().min(1, "Give it a title").max(160),
  startDate: IsoDate,
  endDate: IsoDate,
  summary: TextField(300),
  notes: TextField(10000),
  offer: TextField(2000),
  type: z.enum(EVENT_TYPES).optional(),
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length).optional(),
  audience: TextField(200),
  status: z.enum(STATUSES).optional(),
  // "ai" = the event came from an AI suggestion; the person who locked it in
  // is still stamped as the one who added it.
  source: z.enum(["manual", "ai"]).optional(),
}).refine(b => b.endDate >= b.startDate, { message: "The end date can't be before the start date" })
  .refine(b => b.type !== NOTE_EVENT_TYPE || noteDatesValid(b), { message: "A note sits on one day" });

router.post("/events", validate(CreateBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof CreateBody>;
  const user = await sessionUser(req);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(marketingEventsTable).values({
      name: b.title,
      startDate: b.startDate,
      endDate: b.endDate,
      summary: b.summary || null,
      notes: b.notes || null,
      offer: b.offer || null,
      eventType: b.type ?? "campaign",
      channels: b.channels ?? [],
      audience: b.audience || null,
      status: b.status ?? "planned",
      source: b.source ?? "manual",
      createdById: user.id, createdByName: user.name,
      updatedById: user.id, updatedByName: user.name,
    }).returning();
    await tx.insert(marketingEventHistoryTable).values({
      eventId: created.id, userId: user.id, userName: user.name, action: "created",
      summary: b.source === "ai" ? "added this from an AI suggestion" : "added this",
    });
    return created;
  });
  res.status(201).json({ event: await oneEventJson(row) });
});

// ── Edit fields (autosave from the event modal) ────────────────────────────
const PatchBody = z.object({
  title: z.string().trim().min(1, "The title can't be empty").max(160).optional(),
  summary: TextField(300),
  notes: TextField(10000),
  offer: TextField(2000),
  type: z.enum(EVENT_TYPES).optional(),
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length).optional(),
  audience: TextField(200),
  status: z.enum(STATUSES).optional(),
});

// Autosave sends a save every pause in typing. Rather than a history line per
// pause, one person's run of edits within this window folds into one line.
const EDIT_MERGE_MINUTES = 10;

router.patch("/events/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof PatchBody>;
  const user = await sessionUser(req);

  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, id)).for("update");
    if (!before || before.deletedAt) return { status: 404 as const };
    if (before.eventType === "test_box" && b.type !== undefined && b.type !== ("test_box" as string)) {
      return { status: 409 as const, error: "A test box's calendar event keeps the test-box type." };
    }
    if (b.type !== undefined && (before.eventType === NOTE_EVENT_TYPE) !== (b.type === NOTE_EVENT_TYPE)) {
      return { status: 409 as const, error: "A note stays a note (and a phase can't become one) — add a new one instead." };
    }

    // Compare in stored-column terms.
    const patch: Record<string, string | string[] | null | undefined> = {};
    if (b.title !== undefined) patch["name"] = b.title;
    if (b.summary !== undefined) patch["summary"] = b.summary || null;
    if (b.notes !== undefined) patch["notes"] = b.notes || null;
    if (b.offer !== undefined) patch["offer"] = b.offer || null;
    if (b.type !== undefined) patch["eventType"] = b.type;
    if (b.channels !== undefined) patch["channels"] = b.channels;
    if (b.audience !== undefined) patch["audience"] = b.audience || null;
    if (b.status !== undefined) patch["status"] = b.status;
    const beforeFields = {
      name: before.name, summary: before.summary, notes: before.notes, offer: before.offer,
      eventType: before.eventType, channels: before.channels, audience: before.audience, status: before.status,
    };
    const changes = diffFields(beforeFields, patch);
    if (Object.keys(changes).length === 0) return { status: 200 as const, row: before };

    const [after] = await tx.update(marketingEventsTable).set({
      ...(changes["name"] ? { name: patch["name"] as string } : {}),
      ...(changes["summary"] ? { summary: patch["summary"] as string | null } : {}),
      ...(changes["notes"] ? { notes: patch["notes"] as string | null } : {}),
      ...(changes["offer"] ? { offer: patch["offer"] as string | null } : {}),
      ...(changes["eventType"] ? { eventType: patch["eventType"] as string } : {}),
      ...(changes["channels"] ? { channels: patch["channels"] as string[] } : {}),
      ...(changes["audience"] ? { audience: patch["audience"] as string | null } : {}),
      ...(changes["status"] ? { status: patch["status"] as string } : {}),
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(marketingEventsTable.id, id)).returning();

    // Fold into this person's recent "edited" line when there is one.
    const [last] = await tx.select().from(marketingEventHistoryTable)
      .where(eq(marketingEventHistoryTable.eventId, id))
      .orderBy(desc(marketingEventHistoryTable.createdAt), desc(marketingEventHistoryTable.id))
      .limit(1);
    const recent = last && last.action === "edited" && last.userId === user.id
      && Date.now() - last.createdAt.getTime() < EDIT_MERGE_MINUTES * 60_000;
    if (recent) {
      const merged: Record<string, FieldChange> = { ...((last.changes as Record<string, FieldChange> | null) ?? {}) };
      for (const [k, v] of Object.entries(changes)) merged[k] = { from: merged[k]?.from ?? v.from, to: v.to };
      await tx.update(marketingEventHistoryTable).set({
        changes: merged,
        summary: describeFieldChanges(merged) ?? "edited this",
        createdAt: new Date(),
      }).where(eq(marketingEventHistoryTable.id, last.id));
    } else {
      await tx.insert(marketingEventHistoryTable).values({
        eventId: id, userId: user.id, userName: user.name, action: "edited",
        summary: describeFieldChanges(changes) ?? "edited this", changes,
      });
    }
    return { status: 200 as const, row: after };
  });

  if (result.status === 404) { res.status(404).json({ error: "Event not found (it may have been deleted)" }); return; }
  if (result.status === 409) { res.status(409).json({ error: result.error }); return; }
  res.json({ event: await oneEventJson(result.row) });
});

// ── Move / resize (drag on the calendar) ───────────────────────────────────
const DatesBody = z.object({ startDate: IsoDate, endDate: IsoDate })
  .refine(b => b.endDate >= b.startDate, { message: "The end date can't be before the start date" });

router.put("/events/:id/dates", validate(DatesBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof DatesBody>;
  const user = await sessionUser(req);

  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, id)).for("update");
    if (!before || before.deletedAt) return { status: 404 as const };
    if (before.testBoxId != null) {
      // A test box's event is dragged as a whole: its VIP launch, public
      // launch and every delivery date still OPEN move by the same number of
      // days (closed ones are already committed) and every deadline follows.
      // The box keeps the calendar, email, note and to-dos in step.
      const delta = daysBetween(before.startDate, b.startDate) || daysBetween(before.endDate, b.endDate);
      const [box] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, before.testBoxId)).for("update");
      if (!box || box.deletedAt) return { status: 404 as const };
      if (delta === 0) return { status: 200 as const, row: before };
      await tx.update(testBoxesTable).set({
        launchDate: addDays(box.launchDate, delta),
        publicLaunchDate: box.publicLaunchDate ? addDays(box.publicLaunchDate, delta) : null,
        updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
      }).where(eq(testBoxesTable.id, box.id));
      await tx.update(testBoxDeliveriesTable).set({
        deliveryDate: sql`${testBoxDeliveriesTable.deliveryDate} + ${delta}::int`,
        updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
      }).where(and(eq(testBoxDeliveriesTable.testBoxId, box.id), eq(testBoxDeliveriesTable.status, "open"), isNull(testBoxDeliveriesTable.deletedAt)));
      await syncTestBox(tx, box.id, user);
      const [after] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, id));
      return { status: 200 as const, row: after };
    }
    if (before.eventType === NOTE_EVENT_TYPE && !noteDatesValid(b)) return { status: 400 as const };
    const change = describeDateChange(before, b);
    if (!change) return { status: 200 as const, row: before };
    const [after] = await tx.update(marketingEventsTable).set({
      startDate: b.startDate, endDate: b.endDate,
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(marketingEventsTable.id, id)).returning();
    await tx.insert(marketingEventHistoryTable).values({
      eventId: id, userId: user.id, userName: user.name, action: change.action, summary: change.summary,
      changes: { startDate: { from: before.startDate, to: b.startDate }, endDate: { from: before.endDate, to: b.endDate } },
    });
    return { status: 200 as const, row: after };
  });
  if (result.status === 404) { res.status(404).json({ error: "Event not found (it may have been deleted)" }); return; }
  if (result.status === 400) { res.status(400).json({ error: "A note sits on one day" }); return; }
  res.json({ event: await oneEventJson(result.row) });
});

// ── Delete (soft — the row and its history stay) ───────────────────────────
router.delete("/events/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, id)).for("update");
    if (!before || before.deletedAt) return 404;
    if (before.testBoxId != null) return 409;
    await tx.update(marketingEventsTable).set({
      deletedAt: new Date(), deletedById: user.id, deletedByName: user.name,
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(marketingEventsTable.id, id));
    await tx.insert(marketingEventHistoryTable).values({
      eventId: id, userId: user.id, userName: user.name, action: "deleted", summary: "deleted this",
    });
    return 200;
  });
  if (result === 404) { res.status(404).json({ error: "Event not found (it may already have been deleted)" }); return; }
  if (result === 409) { res.status(409).json({ error: "This is a test box's event — delete or cancel the test box instead." }); return; }
  res.json({ ok: true });
});

// ── AI event suggestions (moved here from founder-sales with the calendar) ─
const SUGGEST_TOOL: Anthropic.Tool = {
  name: "suggest_events",
  description: "Suggest marketing calendar events for The Calzone Kitchen.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Catchy event/offer name" },
            startDate: { type: "string", description: "YYYY-MM-DD" },
            endDate: { type: "string", description: "YYYY-MM-DD" },
            angle: { type: "string", description: "One sentence: the hook and why now" },
            offerIdea: { type: "string", description: "Concrete offer mechanic (e.g. free pack over £X, bundle, limited flavour)" },
          },
          required: ["name", "startDate", "endDate", "angle", "offerIdea"],
        },
      },
    },
    required: ["suggestions"],
  },
};

router.post("/suggest-events", validate(z.object({}).passthrough()), async (_req: Request, res: Response) => {
  if (!isClaudeConfigured()) { res.status(503).json({ error: "AI is not configured on this server." }); return; }
  try {
    const today = londonToday();
    const horizonEnd = new Date(Date.parse(`${today}T12:00:00Z`) + 56 * 86_400_000).toISOString().slice(0, 10);
    const events = await db.select().from(marketingEventsTable)
      .where(and(
        isNull(marketingEventsTable.deletedAt),
        ne(marketingEventsTable.eventType, NOTE_EVENT_TYPE), // notes aren't cover
        gte(marketingEventsTable.endDate, today),
        lte(marketingEventsTable.startDate, horizonEnd),
      ))
      .orderBy(asc(marketingEventsTable.startDate));

    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 1500,
      system: [
        "You plan the marketing calendar for The Calzone Kitchen — a UK artisan business delivering treat-night calzones and mac & cheese nationwide (D2C via Shopify, email via Klaviyo, Meta ads).",
        "Their rule: there is ALWAYS a named offer or event running. Past examples: a football World Cup box, Black Friday, a summer-holiday free pack offer.",
        "Suggest 3-5 events covering the UNCOVERED weeks in the next ~8 weeks. UK calendar awareness (bank holidays, back to school, Halloween, Bonfire Night, payday weekends). Events should feel like TCK: warm, family, treat-night — not corporate.",
        "Dates must be realistic windows (5-14 days each), not overlapping existing planned events. Use the suggest_events tool only.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: `Today: ${today}\nExisting events (do not overlap these):\n${events.map(e => `- ${e.name}: ${e.startDate} → ${e.endDate} [${e.status}]`).join("\n") || "(none)"}`,
      }],
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: "suggest_events" },
    });

    const toolUse = response.content.find((blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use");
    const input = (toolUse?.input ?? { suggestions: [] }) as { suggestions: Array<{ name: string; startDate: string; endDate: string; angle: string; offerIdea: string }> };
    const clean = input.suggestions.filter(s => DATE_RE.test(s.startDate) && DATE_RE.test(s.endDate) && s.endDate >= s.startDate);
    res.json({ suggestions: clean });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
