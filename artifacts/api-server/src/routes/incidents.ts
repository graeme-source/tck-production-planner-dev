// Accident & incident diary — HACCP due diligence (Graeme, 2026-09-11).
//
// A report is created empty and auto-dated the moment the manager taps
// "New report", then filled in field by field (the diary UI autosaves on
// blur). The standard containment steps are explicit booleans so the diary
// shows due diligence at a glance, and a signature records who stands
// behind the report. Mounted behind the admin-or-manager guard in
// routes/index.ts — this is a manager's tool.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, incidentReportsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

async function sessionUser(req: Request): Promise<{ id: number; name: string } | null> {
  const id = req.session.userId ?? null;
  if (!id) return null;
  const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return u ?? null;
}

// GET / — the diary, newest first.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(incidentReportsTable).orderBy(desc(incidentReportsTable.occurredAt), desc(incidentReportsTable.id));
    res.json(rows);
  } catch (err) {
    console.error("[incidents] list failed:", err);
    res.status(500).json({ error: "Failed to load the incident diary" });
  }
});

// POST / — start a report. Auto-dated, reporter recorded; everything else
// is filled in afterwards via PATCH autosaves.
router.post("/", validate(z.object({ kind: z.enum(["accident", "incident", "near_miss"]).optional() })), async (req: Request, res: Response) => {
  try {
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const [row] = await db
      .insert(incidentReportsTable)
      .values({
        kind: (req.body as { kind?: string }).kind ?? "incident",
        reportedByUserId: user.id,
        reportedByName: user.name,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[incidents] create failed:", err);
    res.status(500).json({ error: "Failed to create the report" });
  }
});

const PatchBody = z.object({
  kind: z.enum(["accident", "incident", "near_miss"]).optional(),
  occurredAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)).optional(),
  title: z.string().max(300).optional(),
  location: z.string().max(300).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  peopleInvolved: z.string().max(2000).nullable().optional(),
  injuries: z.string().max(5000).nullable().optional(),
  foodSafetyImpact: z.string().max(5000).nullable().optional(),
  immediateActions: z.string().max(5000).nullable().optional(),
  correctiveActions: z.string().max(5000).nullable().optional(),
  productionStopped: z.boolean().optional(),
  foodDiscarded: z.boolean().optional(),
  riskAssessmentDone: z.boolean().optional(),
  areaCleaned: z.boolean().optional(),
});

// PATCH /:id — field-level autosave from the diary form.
router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const body = req.body as z.infer<typeof PatchBody>;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      set[k] = k === "occurredAt" ? new Date(v as string) : v;
    }
    const [row] = await db.update(incidentReportsTable).set(set).where(eq(incidentReportsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[incidents] patch failed:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

// POST /:id/sign — the signed-in manager puts their name to the report.
router.post("/:id/sign", validate(z.object({})), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const [row] = await db
      .update(incidentReportsTable)
      .set({ signedByUserId: user.id, signedByName: user.name, signedAt: new Date(), updatedAt: new Date() })
      .where(eq(incidentReportsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[incidents] sign failed:", err);
    res.status(500).json({ error: "Failed to sign" });
  }
});

// POST /:id/close — mark resolved (and reopen with { reopen: true }).
router.post("/:id/close", validate(z.object({ reopen: z.boolean().optional() })), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const reopen = Boolean((req.body as { reopen?: boolean }).reopen);
    const [row] = await db
      .update(incidentReportsTable)
      .set(reopen ? { status: "open", closedAt: null, updatedAt: new Date() } : { status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(eq(incidentReportsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[incidents] close failed:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// DELETE /:id — admins only would be nicer, but a manager deleting an
// empty accidental draft is the real use; deleting a signed report is
// blocked so the diary stays honest.
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [existing] = await db.select({ signedAt: incidentReportsTable.signedAt }).from(incidentReportsTable).where(eq(incidentReportsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Report not found" }); return; }
    if (existing.signedAt) { res.status(409).json({ error: "Signed reports can't be deleted — the diary is the record." }); return; }
    await db.delete(incidentReportsTable).where(eq(incidentReportsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[incidents] delete failed:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

export default router;
