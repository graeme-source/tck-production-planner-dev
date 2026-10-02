/**
 * Recording what APC customer service said about a postcode restriction
 * (Graeme, 2026-10-02). Objective D.
 *
 * A booking failure where APC refused a service their own table lists
 * prompts the packer to ring APC and tap "Temporary restriction" or
 * "Permanent — no Saturday service". That answer is stored here and then
 * applied on top of the table everywhere the postcode check is shown
 * (services/apc-postcode-overrides.ts).
 *
 * Anyone signed in may RECORD — the packer is the one on the phone — and
 * who recorded it is kept. Clearing is for managers/admins, or the person
 * who recorded it (to undo a mis-tap). Nothing is ever hard-deleted.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import {
  activeOverrides, overrideExpiresAt, shortLondonDate, restrictionsFor, TEMPORARY_RESTRICTION_DAYS,
} from "../services/apc-postcode-overrides";
import { loadPostcodeOverrides, overrideFromRow } from "../lib/apc-postcode-context";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
}
router.use(requireAuth);

async function me(req: Request): Promise<{ id: number; name: string | null; role: string | null }> {
  const r = await db.execute<{ name: string; role: string }>(sql`SELECT name, role FROM app_users WHERE id = ${req.session.userId}`);
  return { id: Number(req.session.userId), name: r.rows[0]?.name ?? null, role: r.rows[0]?.role ?? null };
}

// GET / — the live overrides, newest first, for the list under the APC
// contact. Each carries its card line and, for temporary ones, when it lapses.
router.get("/", async (req: Request, res: Response) => {
  const now = new Date();
  const live = activeOverrides(await loadPostcodeOverrides(), now);
  const user = await me(req);
  const isManager = user.role === "admin" || user.role === "manager";
  res.json({
    temporaryDays: TEMPORARY_RESTRICTION_DAYS,
    overrides: live.map(o => {
      const expires = overrideExpiresAt(o);
      const line = restrictionsFor(o.outward, [o], now)[o.service];
      return {
        id: o.id, outward: o.outward, service: o.service, kind: o.kind, depot: o.depot, note: o.note,
        recordedByName: o.recordedByName,
        recordedAt: new Date(o.recordedAt).toISOString(),
        recordedOn: shortLondonDate(o.recordedAt),
        expiresOn: expires ? shortLondonDate(expires) : null,
        label: line?.label ?? "",
        canClear: isManager || o.recordedById === user.id,
      };
    }),
  });
});

const recordSchema = z.object({
  outward: z.string().trim().toUpperCase().regex(/^[A-Z]{1,2}\d[A-Z\d]?$/, "Not an outward code"),
  service: z.enum(["saturday", "weekday"]),
  kind: z.enum(["temporary", "permanent"]),
  depot: z.string().trim().max(20).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

// POST / — record APC's answer. A newer answer for the same outward code and
// service supersedes (clears) any live older one, so there is one truth.
router.post("/", validate(recordSchema), async (req: Request, res: Response) => {
  const body = recordSchema.parse(req.body);
  const user = await me(req);
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE apc_postcode_overrides
      SET cleared_at = NOW(), cleared_by_id = ${user.id}, cleared_by_name = ${user.name}
      WHERE outward = ${body.outward} AND service = ${body.service} AND cleared_at IS NULL
    `);
    return tx.execute<{ id: number; outward: string; service: string; kind: string; note: string | null; depot: string | null; recorded_by_name: string | null; recorded_at: string; cleared_at: string | null }>(sql`
      INSERT INTO apc_postcode_overrides (outward, service, kind, note, depot, recorded_by_id, recorded_by_name)
      VALUES (${body.outward}, ${body.service}, ${body.kind}, ${body.note || null}, ${body.depot || null}, ${user.id}, ${user.name})
      RETURNING id, outward, service, kind, note, depot, recorded_by_name,
                to_char(recorded_at, 'YYYY-MM-DD HH24:MI:SS') AS recorded_at, cleared_at
    `);
  });
  const o = overrideFromRow(inserted.rows[0]);
  const line = restrictionsFor(o.outward, [o], new Date())[o.service];
  res.json({ ok: true, id: o.id, label: line?.label ?? "" });
});

// POST /:id/clear — undo / lift a restriction. Managers and admins, or the
// person who recorded it.
router.post("/:id/clear", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid override" }); return; }
  const user = await me(req);
  const row = await db.execute<{ recorded_by_id: number | null; cleared_at: string | null }>(sql`
    SELECT recorded_by_id, cleared_at FROM apc_postcode_overrides WHERE id = ${id}
  `);
  const found = row.rows[0];
  if (!found) { res.status(404).json({ error: "Not found" }); return; }
  const isManager = user.role === "admin" || user.role === "manager";
  if (!isManager && Number(found.recorded_by_id) !== user.id) {
    res.status(403).json({ error: "Only a manager, or whoever recorded it, can clear this." });
    return;
  }
  await db.execute(sql`
    UPDATE apc_postcode_overrides
    SET cleared_at = NOW(), cleared_by_id = ${user.id}, cleared_by_name = ${user.name}
    WHERE id = ${id} AND cleared_at IS NULL
  `);
  res.json({ ok: true });
});

export default router;
