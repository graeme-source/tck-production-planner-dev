/**
 * Marketing calendar API — PHASES + Klaviyo emails (Graeme, 2026-10-20:
 * "strip this back and make it a lot easier to manage"). Objectives I (there
 * is always something on, planned well ahead, every email approved) and F
 * (every change is attributed and kept — nothing silently overwritten).
 *
 * A phase is a dated period (any length) with zero or more offers (text —
 * typing a new one adds it to the offer library, routes/marketing-offers.ts),
 * an optional customer group (all / new / returning / subscription) and
 * notes. Emails are never made here: they are built in Klaviyo and read
 * back (GET /klaviyo-emails), each with ONE approval status
 * (routes/marketing-approvals.ts).
 *
 * Access: the founder, or anyone granted "founder.sales" (Sales & Marketing).
 * Every write is stamped with the signed-in person and adds a line to the
 * phase's history. Deletes are soft (and undoable), so the history survives.
 *
 * Stored in marketing_events. Old "note" events (2026-10-01) stay in the
 * table but are never listed. A test box's own event (test_box_id) is a
 * phase like any other, except its dates follow the box.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, marketingEventsTable, marketingEventHistoryTable, testBoxesTable, testBoxDeliveriesTable, usersTable } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import {
  CUSTOMER_GROUPS, NOTE_EVENT_TYPE, PHASE_COLOUR_KEYS, addDays, dedupeOffers, describeDateChange, describeFieldChanges, diffFields, daysBetween, offersSummary,
  type FieldChange,
} from "@workspace/marketing-calendar";
import { syncTestBox } from "../lib/test-box-data";
import { validate, validateQuery } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { calendarEmails } from "../lib/marketing-klaviyo-emails";
import { canApproveEmails } from "./marketing-approvals";
import { addOffersToLibrary } from "./marketing-offers";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import type Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IsoDate = z.string().regex(DATE_RE, "Use YYYY-MM-DD");

type EventRow = typeof marketingEventsTable.$inferSelect;

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

async function sessionUser(req: Request): Promise<{ id: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

function phaseJson(e: EventRow) {
  return {
    id: e.id,
    title: e.name,
    startDate: e.startDate,
    endDate: e.endDate,
    offers: e.offers ?? [],
    customerGroup: e.customerGroup,
    /** Palette key (phase-colours.ts); null = the default, soft lavender. */
    color: e.color,
    notes: e.notes,
    source: e.source,
    /** Set on a test box's own phase: its dates follow the box. */
    testBoxId: e.testBoxId,
    createdBy: e.createdByName ? { id: e.createdById, name: e.createdByName } : null,
    updatedBy: e.updatedByName ? { id: e.updatedById, name: e.updatedByName } : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

function historyJson(h: typeof marketingEventHistoryTable.$inferSelect) {
  return { id: h.id, userId: h.userId, userName: h.userName, action: h.action, summary: h.summary, at: h.createdAt.toISOString() };
}

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const livePhase = and(isNull(marketingEventsTable.deletedAt), ne(marketingEventsTable.eventType, NOTE_EVENT_TYPE));

// ── List: every live phase overlapping [from, to] ──────────────────────────
const RangeQuery = z.object({ from: IsoDate, to: IsoDate })
  .refine(q => q.to >= q.from, { message: "to must be on or after from" })
  .refine(q => daysBetween(q.from, q.to) <= 800, { message: "Range too long (max ~2 years)" });

router.get("/events", validateQuery(RangeQuery), async (_req: Request, res: Response) => {
  const { from, to } = res.locals["query"] as z.infer<typeof RangeQuery>;
  const rows = await db.select().from(marketingEventsTable)
    .where(and(livePhase, gte(marketingEventsTable.endDate, from), lte(marketingEventsTable.startDate, to)))
    .orderBy(asc(marketingEventsTable.startDate), asc(marketingEventsTable.id));
  res.json({ today: londonToday(), events: rows.map(phaseJson) });
});

// ── Every phase ever (newest first) — "Re-use a past phase" searches these ─
router.get("/phases/all", async (_req: Request, res: Response) => {
  const rows = await db.select().from(marketingEventsTable).where(livePhase)
    .orderBy(desc(marketingEventsTable.startDate), desc(marketingEventsTable.id)).limit(1000);
  res.json({ phases: rows.map(phaseJson) });
});

// ── Klaviyo emails in the range, each with its approval (read-only) ────────
// Drafts, scheduled and sent one-off email campaigns on their send day, plus
// drafts with no date yet. A Klaviyo hiccup never breaks the calendar — it
// answers with an error flag.
router.get("/klaviyo-emails", validateQuery(RangeQuery), async (req: Request, res: Response) => {
  const { from, to } = res.locals["query"] as z.infer<typeof RangeQuery>;
  const canApprove = await canApproveEmails(req);
  try {
    const out = await calendarEmails(from, to, londonToday());
    res.json({ ...out, canApprove });
  } catch (err) {
    console.error("[marketing-calendar] Klaviyo emails failed:", err instanceof Error ? err.message : String(err));
    res.json({ connected: true, emails: [], undatedDrafts: [], canApprove, error: "Couldn't reach Klaviyo just now" });
  }
});

// ── One phase + its history ────────────────────────────────────────────────
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
  if (!row || row.eventType === NOTE_EVENT_TYPE) { res.status(404).json({ error: "Phase not found" }); return; }
  res.json({ event: phaseJson(row), deleted: row.deletedAt != null, deletedBy: row.deletedByName, history: await loadHistory(id) });
});

// ── Create ─────────────────────────────────────────────────────────────────
const Offers = z.array(z.string().trim().max(300)).max(20);
const Notes = z.string().trim().max(10000).nullish();
const Group = z.enum(CUSTOMER_GROUPS);
/** A palette key, or null for the default colour (Graeme, 2026-10-21). */
const Colour = z.enum(PHASE_COLOUR_KEYS).nullable();

const CreateBody = z.object({
  title: z.string().trim().min(1, "Give it a name").max(160),
  startDate: IsoDate,
  endDate: IsoDate,
  offers: Offers.optional(),
  customerGroup: Group.optional(),
  color: Colour.optional(),
  notes: Notes,
  // "ai" =the phase came from an AI suggestion; "reuse" = copied from a past phase.
  source: z.enum(["manual", "ai", "reuse"]).optional(),
  /** Re-use: the phase it was copied from (for the history line). */
  copiedFromId: z.number().int().positive().optional(),
}).refine(b => b.endDate >= b.startDate, { message: "The end date can't be before the start date" });

router.post("/events", validate(CreateBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof CreateBody>;
  const user = await sessionUser(req);
  const offers = dedupeOffers(b.offers ?? []);
  const row = await db.transaction(async (tx) => {
    let copied: string | null = null;
    if (b.copiedFromId) {
      const [src] = await tx.select({ name: marketingEventsTable.name, startDate: marketingEventsTable.startDate })
        .from(marketingEventsTable).where(eq(marketingEventsTable.id, b.copiedFromId));
      if (src) copied = `“${src.name}” (${src.startDate})`;
    }
    const [created] = await tx.insert(marketingEventsTable).values({
      name: b.title,
      startDate: b.startDate,
      endDate: b.endDate,
      offers,
      offer: offersSummary(offers),
      customerGroup: b.customerGroup ?? "all",
      color: b.color ?? null,
      notes: b.notes || null,
      eventType: "campaign",
      status: "planned",
      source: b.source === "ai" ? "ai" : "manual",
      createdById: user.id, createdByName: user.name,
      updatedById: user.id, updatedByName: user.name,
    }).returning();
    await tx.insert(marketingEventHistoryTable).values({
      eventId: created.id, userId: user.id, userName: user.name, action: "created",
      summary: b.source === "ai" ? "added this from an AI suggestion" : copied ? `added this as a copy of ${copied}` : "added this",
    });
    await addOffersToLibrary(tx, offers, user);
    return created;
  });
  res.status(201).json({ event: phaseJson(row) });
});

// ── Edit fields (autosave from the phase modal) ────────────────────────────
const PatchBody = z.object({
  title: z.string().trim().min(1, "The name can't be empty").max(160).optional(),
  offers: Offers.optional(),
  customerGroup: Group.optional(),
  color: Colour.optional(),
  notes: Notes,
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
    if (!before || before.deletedAt || before.eventType === NOTE_EVENT_TYPE) return { status: 404 as const };
    if (before.testBoxId != null && b.title !== undefined && b.title !== before.name) {
      return { status: 409 as const, error: "A test box's phase is named after the box — rename the test box instead." };
    }

    // Compare in stored-column terms.
    const patch: Record<string, string | string[] | null | undefined> = {};
    if (b.title !== undefined) patch["name"] = b.title;
    if (b.offers !== undefined) patch["offers"] = dedupeOffers(b.offers);
    if (b.customerGroup !== undefined) patch["customerGroup"] = b.customerGroup;
    if (b.color !== undefined) patch["color"] = b.color;
    if (b.notes !== undefined) patch["notes"] = b.notes || null;
    const changes = diffFields(
      { name: before.name, offers: before.offers, customerGroup: before.customerGroup, color: before.color, notes: before.notes },
      patch,
    );
    if (Object.keys(changes).length === 0) return { status: 200 as const, row: before };

    const offers = changes["offers"] ? (patch["offers"] as string[]) : null;
    const [after] = await tx.update(marketingEventsTable).set({
      ...(changes["name"] ? { name: patch["name"] as string } : {}),
      ...(offers ? { offers, offer: offersSummary(offers) } : {}),
      ...(changes["customerGroup"] ? { customerGroup: patch["customerGroup"] as string } : {}),
      ...(changes["color"] ? { color: patch["color"] as string | null } : {}),
      ...(changes["notes"] ? { notes: patch["notes"] as string | null } : {}),
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(marketingEventsTable.id, id)).returning();
    if (offers) await addOffersToLibrary(tx, offers, user);

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

  if (result.status === 404) { res.status(404).json({ error: "Phase not found (it may have been deleted)" }); return; }
  if (result.status === 409) { res.status(409).json({ error: result.error }); return; }
  res.json({ event: phaseJson(result.row) });
});

// ── Move / resize (drag on the calendar, or the dates in the modal) ───────
const DatesBody = z.object({ startDate: IsoDate, endDate: IsoDate })
  .refine(b => b.endDate >= b.startDate, { message: "The end date can't be before the start date" });

router.put("/events/:id/dates", validate(DatesBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof DatesBody>;
  const user = await sessionUser(req);

  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, id)).for("update");
    if (!before || before.deletedAt || before.eventType === NOTE_EVENT_TYPE) return { status: 404 as const };
    if (before.testBoxId != null) {
      // A test box's phase is dragged as a whole: its VIP launch, public
      // launch and every delivery date still OPEN move by the same number of
      // days (closed ones are already committed); the phase follows the box.
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
  if (result.status === 404) { res.status(404).json({ error: "Phase not found (it may have been deleted)" }); return; }
  res.json({ event: phaseJson(result.row) });
});

// ── Delete (soft — the row and its history stay) + undo ─────────────────
router.delete("/events/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, id)).for("update");
    if (!before || before.deletedAt || before.eventType === NOTE_EVENT_TYPE) return 404;
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
  if (result === 404) { res.status(404).json({ error: "Phase not found (it may already have been deleted)" }); return; }
  if (result === 409) { res.status(409).json({ error: "This is a test box's phase — delete or cancel the test box instead." }); return; }
  res.json({ ok: true });
});

router.post("/events/:id/restore", validate(z.object({}).passthrough()), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, id)).for("update");
    if (!before || before.eventType === NOTE_EVENT_TYPE || before.testBoxId != null) return null;
    if (before.deletedAt == null) return before;
    const [after] = await tx.update(marketingEventsTable).set({
      deletedAt: null, deletedById: null, deletedByName: null,
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(marketingEventsTable.id, id)).returning();
    await tx.insert(marketingEventHistoryTable).values({
      eventId: id, userId: user.id, userName: user.name, action: "edited", summary: "put this back (undid the delete)",
    });
    return after;
  });
  if (!row) { res.status(404).json({ error: "Phase not found" }); return; }
  res.json({ event: phaseJson(row) });
});

// ── AI phase suggestions for the gaps ──────────────────────────────────────
const SUGGEST_TOOL: Anthropic.Tool = {
  name: "suggest_events",
  description: "Suggest marketing calendar phases for The Calzone Kitchen.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Catchy phase name" },
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
    const horizonEnd = addDays(today, 56);
    const events = await db.select().from(marketingEventsTable)
      .where(and(livePhase, gte(marketingEventsTable.endDate, today), lte(marketingEventsTable.startDate, horizonEnd)))
      .orderBy(asc(marketingEventsTable.startDate));

    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 1500,
      system: [
        "You plan the marketing calendar for The Calzone Kitchen — a UK artisan business delivering treat-night calzones and mac & cheese nationwide (D2C via Shopify, email via Klaviyo, Meta ads).",
        "Their rule: there is ALWAYS a named offer or phase running. Past examples: a football World Cup box, Black Friday, a summer-holiday free pack offer.",
        "Suggest 3-5 phases covering the UNCOVERED weeks in the next ~8 weeks. UK calendar awareness (bank holidays, back to school, Halloween, Bonfire Night, payday weekends). Phases should feel like TCK: warm, family, treat-night — not corporate.",
        "Dates must be realistic windows (5-14 days each), not overlapping existing phases. Use the suggest_events tool only.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: `Today: ${today}\nExisting phases (do not overlap these):\n${events.map(e => `- ${e.name}: ${e.startDate} → ${e.endDate}${e.offers.length ? ` [offers: ${e.offers.join("; ")}]` : ""}`).join("\n") || "(none)"}`,
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
