/**
 * Current rate of pay and the last pay rise (Graeme, 26 Nov 2026) — the
 * card on a person's record and on their performance review page. Mounted
 * INSIDE routes/people-reviews.ts, after its access check, so it's already
 * behind the private People PIN and the founder / People-access rule; and
 * per person, the same rule as the rest of the record — never your own
 * unless you're Graeme. Every read is audited. Pay is never put in the
 * performance report itself, so it can't reach a copy shared with them.
 *
 *   GET  /api/people-reviews/person/:userId/pay           what's saved
 *   POST /api/people-reviews/person/:userId/pay/refresh   read Planday now
 *
 * The figures come from Planday (services/pay-rate-sync.ts), daily.
 * Objective H.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, peoplePayRatesTable, peopleRecordAuditTable } from "@workspace/db";
import { canWriteEmploymentRecord, type RecordActor } from "../lib/people-write-access";
import { loadRecordSubject } from "../middleware/employment-record-write";
import { syncPayRates } from "../services/pay-rate-sync";

const router: IRouter = Router();

interface Viewer { actor: RecordActor; name: string; role: string; isFounder: boolean }
const viewerOf = (res: Response) => res.locals["recordViewer"] as Viewer;

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function allowed(req: Request, res: Response): Promise<number | null> {
  const viewer = viewerOf(res);
  const userId = parseId(req.params["userId"]);
  const subject = userId == null ? null : await loadRecordSubject(userId);
  if (userId == null || !subject || !canWriteEmploymentRecord(viewer.actor, subject)) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return userId;
}

async function load(userId: number) {
  const [row] = await db.select().from(peoplePayRatesTable).where(eq(peoplePayRatesTable.userId, userId));
  if (!row) return { userId, known: false as const };
  return {
    userId,
    known: true as const,
    currentRate: row.currentRate != null ? Number(row.currentRate) : null,
    wageType: row.wageType,
    rates: row.rates ?? [],
    lastChangeOn: row.lastChangeOn,
    previousRate: row.previousRate != null ? Number(row.previousRate) : null,
    changes: row.changes ?? [],
    historyFrom: row.historyFrom,
    syncedAt: row.syncedAt.toISOString(),
  };
}

async function audit(res: Response, userId: number, action: string, detail: string) {
  const viewer = viewerOf(res);
  await db.insert(peopleRecordAuditTable).values({
    viewerId: viewer.actor.id, viewerName: viewer.name, subjectUserId: userId, entryId: null, action, detail,
  });
}

router.get("/person/:userId/pay", async (req: Request, res: Response) => {
  try {
    const userId = await allowed(req, res);
    if (userId == null) return;
    await audit(res, userId, "view_pay", "Rate of pay");
    res.json(await load(userId));
  } catch (err) {
    console.error("[people-pay] read failed:", err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(500).json({ error: "Couldn't load their rate of pay" });
  }
});

router.post("/person/:userId/pay/refresh", async (req: Request, res: Response) => {
  try {
    const userId = await allowed(req, res);
    if (userId == null) return;
    await syncPayRates();
    await audit(res, userId, "view_pay", "Rate of pay, refreshed from Planday");
    res.json(await load(userId));
  } catch (err) {
    console.error("[people-pay] refresh failed:", err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(500).json({ error: "Couldn't read Planday just now" });
  }
});

export default router;
