/**
 * Standing morning-meeting reminders (migration 0250, Graeme 23 Oct 2026).
 * Objective E. Mounted at /api/meeting-reminders, behind the session guard.
 *
 *   GET  /              today's live reminders (anyone signed in)
 *   POST /              add one             (manager/admin)
 *   POST /bulk          add several at once — "Keep every day" on an old
 *                       per-day Reminders note (manager/admin)
 *   POST /:id/remove    soft remove, kept for audit (manager/admin)
 *   POST /:id/restore   undo a remove           (manager/admin)
 *
 * Which reminders show on a day: lib/meeting-reminders.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, gte, isNull, isNotNull, lte, or } from "drizzle-orm";
import { db, meetingRemindersTable, usersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { londonDateString } from "../lib/london-time";
import { cleanReminderText, remindersForDate } from "../lib/meeting-reminders";

const router: IRouter = Router();

async function sessionUser(req: Request): Promise<{ id: number | null; name: string | null }> {
  const id = req.session.userId ?? null;
  if (!id) return { id: null, name: null };
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? null };
}

function toClient(r: typeof meetingRemindersTable.$inferSelect) {
  return {
    id: r.id,
    text: r.text,
    forWhom: r.forWhom,
    startsOn: r.startsOn,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const today = londonDateString();
    // Live ones, plus anything removed in the last couple of days so the
    // "removed today" rule is decided by the shared lib, not re-done in SQL.
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(meetingRemindersTable)
      .where(and(
        lte(meetingRemindersTable.startsOn, today),
        or(isNull(meetingRemindersTable.removedAt), gte(meetingRemindersTable.removedAt, since)),
      ));
    const shown = remindersForDate(
      rows.map(r => ({ ...r, removedOn: r.removedAt ? londonDateString(r.removedAt) : null })),
      today,
    );
    res.json({ today, reminders: shown.map(toClient) });
  } catch (err) {
    console.error("[meeting-reminders] list error:", err);
    res.status(500).json({ error: "Couldn't load reminders" });
  }
});

const reminderInput = z.object({
  text: z.string().max(500),
  forWhom: z.string().max(100).nullable().optional(),
});

async function insertReminders(req: Request, items: Array<z.infer<typeof reminderInput>>) {
  const who = await sessionUser(req);
  const today = londonDateString();
  const values = items
    .map(i => ({ text: cleanReminderText(i.text), forWhom: cleanReminderText(i.forWhom ?? null) }))
    .filter((i): i is { text: string; forWhom: string | null } => i.text != null)
    .map(i => ({
      text: i.text,
      forWhom: i.forWhom,
      startsOn: today,
      createdByUserId: who.id,
      createdByName: who.name,
    }));
  if (values.length === 0) return [];
  return db.insert(meetingRemindersTable).values(values).returning();
}

router.post("/", requireManagerOrAdmin, validate(reminderInput), async (req: Request, res: Response) => {
  try {
    const rows = await insertReminders(req, [req.body as z.infer<typeof reminderInput>]);
    if (rows.length === 0) { res.status(400).json({ error: "Type a reminder first" }); return; }
    res.status(201).json(toClient(rows[0]));
  } catch (err) {
    console.error("[meeting-reminders] add error:", err);
    res.status(500).json({ error: "Couldn't save the reminder" });
  }
});

const bulkInput = z.object({ items: z.array(reminderInput).min(1).max(50) });

router.post("/bulk", requireManagerOrAdmin, validate(bulkInput), async (req: Request, res: Response) => {
  try {
    const { items } = req.body as z.infer<typeof bulkInput>;
    const rows = await insertReminders(req, items);
    if (rows.length === 0) { res.status(400).json({ error: "Nothing to add" }); return; }
    res.status(201).json({ added: rows.map(toClient) });
  } catch (err) {
    console.error("[meeting-reminders] bulk add error:", err);
    res.status(500).json({ error: "Couldn't save the reminders" });
  }
});

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.post("/:id/remove", requireManagerOrAdmin, validate(z.object({})), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid reminder" }); return; }
  try {
    const who = await sessionUser(req);
    const [row] = await db
      .update(meetingRemindersTable)
      .set({ removedAt: new Date(), removedByUserId: who.id, removedByName: who.name })
      .where(and(eq(meetingRemindersTable.id, id), isNull(meetingRemindersTable.removedAt)))
      .returning();
    if (!row) { res.status(404).json({ error: "Reminder not found or already removed" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[meeting-reminders] remove error:", err);
    res.status(500).json({ error: "Couldn't remove the reminder" });
  }
});

router.post("/:id/restore", requireManagerOrAdmin, validate(z.object({})), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid reminder" }); return; }
  try {
    const [row] = await db
      .update(meetingRemindersTable)
      .set({ removedAt: null, removedByUserId: null, removedByName: null })
      .where(and(eq(meetingRemindersTable.id, id), isNotNull(meetingRemindersTable.removedAt)))
      .returning();
    if (!row) { res.status(404).json({ error: "Reminder not found" }); return; }
    res.json(toClient(row));
  } catch (err) {
    console.error("[meeting-reminders] restore error:", err);
    res.status(500).json({ error: "Couldn't put the reminder back" });
  }
});

export default router;
