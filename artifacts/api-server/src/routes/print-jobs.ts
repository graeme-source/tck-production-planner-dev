/**
 * Prep-room label printing — the queue between the iPads and the TSC DA210.
 *
 * The app is cloud-hosted and the printer is USB-only on a factory PC, so
 * nothing here talks to hardware: an operator's tap creates a job (rendered
 * to TSPL server-side), and the print-bridge agent on the factory PC
 * long-polls /pending and fires the TSPL at the printer. Jobs are never
 * deleted — the table doubles as the HACCP label audit trail (who printed
 * what, with which dates, when).
 *
 * Two auth worlds, deliberately separate:
 *  - Operators (session auth) create jobs and read status.
 *  - The bridge (PRINT_BRIDGE_TOKEN bearer) reads pending jobs and acks
 *    them. No token configured = bridge endpoints refuse, loudly.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import {
  renderIngredientLabel,
  renderTinLabel,
  renderTestLabel,
} from "../lib/label-tspl";
import {
  resolveOpenedLife,
  parseCategoryDefaults,
  addDaysIso,
  LABEL_RULE_SETTINGS_KEY,
} from "../lib/label-rules";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

/** The bridge authenticates with a shared token, not a session — it's a
 *  headless script on a factory PC. Unset token = closed, not open. */
function requireBridgeToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.PRINT_BRIDGE_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "PRINT_BRIDGE_TOKEN is not configured on the server" });
    return;
  }
  const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (got !== expected) {
    res.status(401).json({ error: "Bad bridge token" });
    return;
  }
  next();
}

/** "Graeme Carter" → "GC". The pen-label convention, kept. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0]!.toUpperCase())
    .slice(0, 3)
    .join("") || "?";
}

async function userInitials(userId: number): Promise<string> {
  const rows = await db.execute<{ name: string | null }>(sql`
    SELECT name FROM app_users WHERE id = ${userId}
  `);
  return initialsOf(rows.rows[0]?.name ?? "");
}

// When the bridge last asked for work — the UI's "printer connected" light.
// In-memory is fine: a restarted server shows offline for one poll cycle.
let lastBridgePollAt: number | null = null;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "yyyy-mm-dd expected");

// Two ways to describe an ingredient label: the one-tap path sends just an
// ingredientId and the server resolves everything from the label rules; the
// explicit path (options sheet, ad-hoc) sends the fields it wants. Explicit
// fields always win over resolved ones.
const ingredientFieldsSchema = z.object({
  ingredientId: z.number().int().positive().optional(),
  itemName: z.string().min(1).max(80).optional(),
  useBy: isoDate.optional(),
  openedOn: isoDate.optional(),
  storageNote: z.string().max(30).nullable().optional(),
  rawMarker: z.boolean().optional(),
}).refine(
  d => d.ingredientId != null || (d.itemName != null && d.useBy != null),
  "Send ingredientId, or itemName + useBy",
);

/** Resolve the one-tap fields from the ingredient's label rules. */
async function resolveIngredientFields(f: z.infer<typeof ingredientFieldsSchema>, today: string): Promise<
  | { ok: true; itemName: string; useBy: string; rawMarker: boolean; ruleDays: number; ruleSource: string }
  | { ok: false; error: string }
> {
  const rows = await db.execute<{ name: string; category: string | null; opened_life_days: number | null }>(sql`
    SELECT name, category, opened_life_days FROM ingredients WHERE id = ${f.ingredientId}
  `);
  const ing = rows.rows[0];
  if (!ing) return { ok: false, error: "Ingredient not found" };
  const settingRows = await db.execute<{ value: string }>(sql`
    SELECT value FROM app_settings WHERE key = ${LABEL_RULE_SETTINGS_KEY}
  `);
  const rule = resolveOpenedLife(
    { openedLifeDays: ing.opened_life_days, category: ing.category },
    parseCategoryDefaults(settingRows.rows[0]?.value),
  );
  return {
    ok: true,
    itemName: f.itemName ?? ing.name,
    useBy: f.useBy ?? addDaysIso(today, rule.days),
    rawMarker: f.rawMarker ?? ing.category === "raw_meat",
    ruleDays: rule.days,
    ruleSource: rule.source,
  };
}

const tinFieldsSchema = z.object({
  recipeName: z.string().min(1).max(80),
  intendedUse: isoDate,
  useBy: isoDate,
  contents: z.string().max(60).nullable().optional(),
});

const createJobSchema = z.object({
  kind: z.enum(["test", "ingredient", "tin"]),
  copies: z.number().int().min(1).max(20).optional(),
  fields: z.unknown().optional(),
});

// ── POST / — create a job (operator) ────────────────────────────────────────
router.post("/", requireAuth, validate(createJobSchema), async (req, res) => {
  const { kind, copies = 1 } = req.body as z.infer<typeof createJobSchema>;
  const initials = await userInitials(req.session.userId!);
  const today = londonDateString();

  let tspl: string;
  let payload: Record<string, unknown>;

  if (kind === "test") {
    tspl = renderTestLabel(initials, today, copies);
    payload = { initials, date: today };
  } else if (kind === "ingredient") {
    const parsed = ingredientFieldsSchema.safeParse(req.body.fields);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    let f: Parameters<typeof renderIngredientLabel>[0] & Record<string, unknown>;
    if (parsed.data.ingredientId != null) {
      const resolved = await resolveIngredientFields(parsed.data, today);
      if (!resolved.ok) { res.status(404).json({ error: resolved.error }); return; }
      f = {
        itemName: resolved.itemName,
        useBy: resolved.useBy,
        openedOn: parsed.data.openedOn ?? today,
        storageNote: parsed.data.storageNote ?? null,
        rawMarker: resolved.rawMarker,
        initials,
        ingredientId: parsed.data.ingredientId,
        // Ride the resolution into the audit trail: WHERE the date came
        // from (own rule / category default / global fallback) matters when
        // a printed use-by is ever questioned.
        ruleDays: resolved.ruleDays,
        ruleSource: resolved.ruleSource,
      };
    } else {
      f = {
        itemName: parsed.data.itemName!,
        useBy: parsed.data.useBy!,
        openedOn: parsed.data.openedOn ?? today,
        storageNote: parsed.data.storageNote ?? null,
        rawMarker: parsed.data.rawMarker ?? false,
        initials,
      };
    }
    tspl = renderIngredientLabel(f, copies);
    payload = f;
  } else {
    const parsed = tinFieldsSchema.safeParse(req.body.fields);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    const f = { ...parsed.data, initials };
    tspl = renderTinLabel(f, copies);
    payload = f;
  }

  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO print_jobs (kind, payload, tspl, copies, created_by)
    VALUES (${kind}, ${JSON.stringify(payload)}::jsonb, ${tspl}, ${copies}, ${req.session.userId})
    RETURNING id
  `);
  // The payload goes back so the one-tap button can toast the computed
  // use-by, and bridgeOnline so a tap while the printer PC is down warns
  // instead of pretending.
  const bridgeOnline = lastBridgePollAt != null && Date.now() - lastBridgePollAt < 60_000;
  res.status(201).json({ id: inserted.rows[0]?.id ?? null, payload, bridgeOnline });
});

// ── GET /pending — bridge long-poll ─────────────────────────────────────────
// Holds the request up to ?wait seconds (max 25 — under every proxy timeout)
// checking for queued work each second, so a label prints within ~1s of the
// tap without the bridge hammering the API.
router.get("/pending", requireBridgeToken, async (req, res) => {
  const station = String(req.query.station ?? "prep");
  const waitS = Math.min(25, Math.max(0, Number(req.query.wait ?? 0) || 0));
  const deadline = Date.now() + waitS * 1000;

  for (;;) {
    lastBridgePollAt = Date.now();
    const rows = await db.execute<{ id: number; tspl: string }>(sql`
      SELECT id, tspl FROM print_jobs
      WHERE station = ${station} AND status = 'queued'
      ORDER BY id
      LIMIT 5
    `);
    if (rows.rows.length > 0 || Date.now() >= deadline) {
      res.json({ jobs: rows.rows });
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
});

// ── POST /:id/complete — bridge ack ─────────────────────────────────────────
const completeSchema = z.object({ ok: z.boolean(), error: z.string().max(500).optional() });
router.post("/:id/complete", requireBridgeToken, validate(completeSchema), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { ok, error } = req.body as z.infer<typeof completeSchema>;
  await db.execute(sql`
    UPDATE print_jobs
    SET status = ${ok ? "printed" : "failed"},
        error = ${error ?? null},
        printed_at = ${ok ? sql`NOW()` : sql`NULL`}
    WHERE id = ${id} AND status = 'queued'
  `);
  res.json({ ok: true });
});

// ── GET /status — operator view: is the printer path alive? ─────────────────
router.get("/status", requireAuth, async (_req, res) => {
  const counts = await db.execute<{ status: string; n: number }>(sql`
    SELECT status, COUNT(*)::int AS n FROM print_jobs
    WHERE created_at > NOW() - INTERVAL '1 day'
    GROUP BY status
  `);
  const recent = await db.execute<{
    id: number; kind: string; status: string; error: string | null;
    payload: Record<string, unknown>; created_at: string; printed_at: string | null; user_name: string | null;
  }>(sql`
    SELECT j.id, j.kind, j.status, j.error, j.payload, j.created_at, j.printed_at, u.name AS user_name
    FROM print_jobs j LEFT JOIN app_users u ON u.id = j.created_by
    ORDER BY j.id DESC
    LIMIT 20
  `);
  const byStatus: Record<string, number> = {};
  for (const r of counts.rows) byStatus[r.status] = r.n;
  // The bridge polls at least every ~26s; 60s of silence means it's gone.
  const bridgeOnline = lastBridgePollAt != null && Date.now() - lastBridgePollAt < 60_000;
  res.json({
    bridgeOnline,
    lastBridgeSeenAt: lastBridgePollAt ? new Date(lastBridgePollAt).toISOString() : null,
    queued: byStatus["queued"] ?? 0,
    printedToday: byStatus["printed"] ?? 0,
    failedToday: byStatus["failed"] ?? 0,
    recent: recent.rows,
  });
});

export default router;
