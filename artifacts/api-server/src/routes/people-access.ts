/**
 * People section access — the per-person switch in Settings → Team & Access
 * (Graeme, 2026-09-25).
 *
 *   GET /api/people-access/users          admins: everyone's state
 *   PUT /api/people-access/users/:userId  FOUNDER ONLY: { enabled }
 *
 * Only the founder account may grant or revoke (an admin is not the
 * founder), and the founder can't revoke their own access. Every change is
 * written to people_access_audit. Rules + tests: lib/people-access-rules.ts.
 * Deliberately NOT part of the generic feature-grants registry, which any
 * admin can hand out.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import {
  canGrantPeopleAccess, checkPeopleAccessChange, peopleAccessState,
} from "../lib/people-access-rules";
import { FOUNDER_EMAIL } from "../lib/founder-email";

const router: IRouter = Router();

async function actor(req: Request): Promise<{ id: number; email: string | null; role: string } | null> {
  const id = req.session.userId;
  if (!id) return null;
  const rows = await db.execute<{ email: string | null; role: string; is_active: boolean }>(
    sql`SELECT email, role, is_active FROM app_users WHERE id = ${id} LIMIT 1`,
  );
  const r = rows.rows[0];
  if (!r || !r.is_active) return null;
  return { id, email: r.email, role: r.role };
}

interface StateRow extends Record<string, unknown> {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  has_private_pin: boolean;
  granted: boolean;
  granted_at: string | null;
  granted_by_name: string | null;
}

const stateSelect = sql`
  SELECT u.id, u.name, u.email, u.role, u.is_active,
         (u.private_pin_hash IS NOT NULL) AS has_private_pin,
         (g.user_id IS NOT NULL) AS granted,
         -- Date only, as text: an unambiguous YYYY-MM-DD every browser parses.
         g.granted_at::date::text AS granted_at, gb.name AS granted_by_name
    FROM app_users u
    LEFT JOIN people_access_grants g ON g.user_id = u.id
    LEFT JOIN app_users gb ON gb.id = g.granted_by_user_id
`;

function shape(r: StateRow, founderId: number | null) {
  const hasAccess = r.granted === true && r.is_active === true;
  return {
    id: Number(r.id),
    name: r.name,
    email: r.email,
    role: r.role,
    isActive: r.is_active === true,
    isFounder: founderId != null && Number(r.id) === founderId,
    state: peopleAccessState({ hasAccess, hasPrivatePin: r.has_private_pin === true }),
    grantedAt: r.granted_at,
    grantedByName: r.granted_by_name,
  };
}

async function founderUserId(): Promise<number | null> {
  // The founder is whoever holds the founder email — looked up, not assumed.
  const rows = await db.execute<{ id: number }>(
    sql`SELECT id FROM app_users WHERE email = ${FOUNDER_EMAIL} LIMIT 1`,
  );
  return rows.rows[0] ? Number(rows.rows[0].id) : null;
}

router.get("/users", async (req: Request, res: Response) => {
  try {
    const me = await actor(req);
    if (!me) { res.status(401).json({ error: "Not authenticated" }); return; }
    if (me.role !== "admin") { res.status(403).json({ error: "Admin access required" }); return; }
    const founderId = await founderUserId();
    // Active people, plus anyone inactive who still holds a grant (so a
    // leftover grant is never invisible).
    const rows = await db.execute<StateRow>(sql`${stateSelect}
      WHERE u.is_active = TRUE OR g.user_id IS NOT NULL
      ORDER BY u.name`);
    const canGrant = canGrantPeopleAccess(me);
    res.json({
      canGrant,
      reason: canGrant ? null : "Only Graeme (the founder account) can turn People access on or off.",
      users: rows.rows.map(r => shape(r, founderId)),
    });
  } catch (err) {
    console.error("[people-access] list failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Couldn't load People access" });
  }
});

const ChangeBody = z.object({ enabled: z.boolean() });

router.put("/users/:userId", validate(ChangeBody), async (req: Request, res: Response) => {
  const targetUserId = Number(req.params.userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) { res.status(400).json({ error: "Invalid user" }); return; }
  const { enabled } = req.body as z.infer<typeof ChangeBody>;
  try {
    const me = await actor(req);
    if (!me) { res.status(401).json({ error: "Not authenticated" }); return; }
    const check = checkPeopleAccessChange({ actor: me, targetUserId, enable: enabled });
    if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }

    const target = await db.execute<{ id: number; email: string }>(
      sql`SELECT id, email FROM app_users WHERE id = ${targetUserId} LIMIT 1`,
    );
    if (!target.rows[0]) { res.status(404).json({ error: "User not found" }); return; }
    const targetEmail = target.rows[0].email;

    await db.transaction(async (tx) => {
      if (enabled) {
        const ins = await tx.execute(sql`
          INSERT INTO people_access_grants (user_id, granted_by_user_id)
          VALUES (${targetUserId}, ${me.id})
          ON CONFLICT (user_id) DO NOTHING
          RETURNING user_id
        `);
        if (ins.rows.length > 0) {
          await tx.execute(sql`
            INSERT INTO people_access_audit (user_id, user_email, action, by_user_id)
            VALUES (${targetUserId}, ${targetEmail}, 'grant', ${me.id})
          `);
        }
      } else {
        const del = await tx.execute(sql`
          DELETE FROM people_access_grants WHERE user_id = ${targetUserId} RETURNING user_id
        `);
        if (del.rows.length > 0) {
          await tx.execute(sql`
            INSERT INTO people_access_audit (user_id, user_email, action, by_user_id)
            VALUES (${targetUserId}, ${targetEmail}, 'revoke', ${me.id})
          `);
        }
      }
    });

    const founderId = await founderUserId();
    const rows = await db.execute<StateRow>(sql`${stateSelect} WHERE u.id = ${targetUserId}`);
    res.json(shape(rows.rows[0], founderId));
  } catch (err) {
    console.error("[people-access] change failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Couldn't save People access" });
  }
});

export default router;
