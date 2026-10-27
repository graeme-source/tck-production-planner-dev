/**
 * Continuous temperature probes — the receiving side (Graeme, 2026-10-27):
 * "we just register a particular probe to a particular recipe on any given
 * day, and see 'that got down to 8° at this time', and we know what time the
 * meat was cooked."
 *
 * The probes (Inkbird INT-11P-B) are Bluetooth and must be connected and
 * polled, so a small bridge on a factory computer reads them and posts here —
 * the same shape as the print bridge. The daily prep-oven review uses a
 * recipe's probe for its real chill time (lib/meat-daily-review-job.ts).
 *
 *   POST /probe-readings              bridge (PROBE_BRIDGE_TOKEN bearer, no
 *                                     session): a batch of readings. Mounted
 *                                     above the session guard; unset token =
 *                                     closed (503), never open.
 *   GET  /probe-readings/assignments?planId=   which probe is on which recipe
 *   POST /probe-readings/assignments  register a probe to a recipe for a plan
 *   DELETE /probe-readings/assignments/:id
 *                                     (managers; zod on every body)
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import * as z from "zod";
import { db, probeReadingsTable, probeAssignmentsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";

/** The bridge authenticates with a shared token, not a session. Unset = closed. */
function requireProbeBridgeToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.PROBE_BRIDGE_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "PROBE_BRIDGE_TOKEN is not configured on the server" });
    return;
  }
  const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (got !== expected) {
    res.status(401).json({ error: "Bad probe bridge token" });
    return;
  }
  next();
}

const ReadingsBody = z.object({
  readings: z.array(z.object({
    probeId: z.string().trim().min(1).max(64),
    recordedAt: z.string().datetime({ offset: true }),
    tempC: z.number().min(-60).max(300),
  })).min(1).max(2000),
});

/** Bridge-only router, mounted above the session guard. */
export const probeBridgeRouter: IRouter = Router();

probeBridgeRouter.post("/", requireProbeBridgeToken, validate(ReadingsBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof ReadingsBody>;
  const inserted = await db
    .insert(probeReadingsTable)
    .values(b.readings.map(r => ({ probeId: r.probeId, recordedAt: new Date(r.recordedAt), tempC: r.tempC.toFixed(1) })))
    .onConflictDoNothing()
    .returning({ id: probeReadingsTable.id });
  res.status(201).json({ received: b.readings.length, stored: inserted.length });
});

/** Managers: which probe is on which recipe today. */
const router: IRouter = Router();

router.get("/assignments", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const planId = Number(req.query.planId);
  if (!Number.isInteger(planId) || planId <= 0) { res.status(400).json({ error: "planId required" }); return; }
  res.json({ assignments: await db.select().from(probeAssignmentsTable).where(eq(probeAssignmentsTable.planId, planId)) });
});

const AssignBody = z.object({
  probeId: z.string().trim().min(1).max(64),
  planId: z.number().int().positive(),
  recipeId: z.number().int().positive(),
});

router.post("/assignments", requireManagerOrAdmin, validate(AssignBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof AssignBody>;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId!));
  const [row] = await db
    .insert(probeAssignmentsTable)
    .values({ probeId: b.probeId, planId: b.planId, recipeId: b.recipeId, purpose: "chill", assignedByName: u?.name ?? null })
    .onConflictDoUpdate({
      target: [probeAssignmentsTable.probeId, probeAssignmentsTable.planId, probeAssignmentsTable.purpose],
      set: { recipeId: b.recipeId, assignedByName: u?.name ?? null },
    })
    .returning();
  res.status(201).json({ assignment: row });
});

router.delete("/assignments/:id", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Bad id" }); return; }
  await db.delete(probeAssignmentsTable).where(eq(probeAssignmentsTable.id, id));
  res.json({ ok: true });
});

export default router;
