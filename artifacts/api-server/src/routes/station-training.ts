/**
 * Station SOP training (Graeme, 2026-09-24) — mounted at /api/station-training.
 *
 * The SOPs attached to the front of a station ARE that station's training
 * matrix. Nothing is copied: columns come straight from sop_links (station
 * links), cells from sop_reviews, so attaching or detaching an SOP changes
 * the matrix the moment it happens. The rules live in
 * lib/station-sop-training.ts (pure, tested); this file gathers the facts.
 *
 * Open to every signed-in colleague — people train themselves from the
 * matrix — and everything that writes is scoped to the session user, so
 * nobody can tick anyone else's cell. The kill switch is admin-only.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireAdmin } from "../middleware/roles";
import { londonDateString } from "../lib/london-time";
import {
  gateDecision,
  deadlineFor,
  endOfLondonDay,
  reviewStatus,
  rosteredStations,
  type GatePass,
  type RotaMapping,
} from "../lib/station-sop-training";

const router: IRouter = Router();

const ENFORCE_KEY = "feature_station_sop_gate";
const STATION_RE = /^[a-z0-9_]{1,64}$/;

// ── Facts ──────────────────────────────────────────────────────────────────

interface StationSop {
  sopId: number;
  title: string;
  stepCount: number;
  currentVersion: number;
  changedAt: string;
}

/** The SOPs on the front of a station that have something to review. An
 *  SOP created but never written (no steps) isn't training yet. */
async function stationSops(station: string): Promise<StationSop[]> {
  const r = await db.execute<{ sop_id: number; title: string; step_count: number; content_version: number; changed_at: string }>(sql`
    SELECT s.id AS sop_id, s.title, s.content_version,
           to_char(s.content_changed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS changed_at,
           (SELECT COUNT(*)::int FROM sop_steps st WHERE st.sop_id = s.id) AS step_count
    FROM sop_links l JOIN standards_sops s ON s.id = l.sop_id
    WHERE l.target_type = 'station' AND l.target_text = ${station}
    ORDER BY s.title
  `);
  return (r.rows ?? [])
    .filter(x => Number(x.step_count) > 0)
    .map(x => ({
      sopId: x.sop_id,
      title: x.title,
      stepCount: Number(x.step_count),
      currentVersion: Number(x.content_version),
      changedAt: x.changed_at,
    }));
}

interface LatestReview { version: number; reviewedAt: string; source: string }

/** Each user's newest review of each SOP: userId → sopId → review. */
async function latestReviews(sopIds: number[], userId?: number): Promise<Map<number, Map<number, LatestReview>>> {
  const out = new Map<number, Map<number, LatestReview>>();
  if (sopIds.length === 0) return out;
  const r = await db.execute<{ user_id: number; sop_id: number; content_version: number; reviewed_at: string; source: string }>(sql`
    SELECT DISTINCT ON (user_id, sop_id) user_id, sop_id, content_version, reviewed_at::text AS reviewed_at, source
    FROM sop_reviews
    WHERE sop_id = ANY(${`{${sopIds.join(",")}}`}::int[])
      ${userId ? sql`AND user_id = ${userId}` : sql``}
    ORDER BY user_id, sop_id, content_version DESC, reviewed_at DESC
  `);
  for (const row of r.rows ?? []) {
    let m = out.get(row.user_id);
    if (!m) out.set(row.user_id, (m = new Map()));
    m.set(row.sop_id, { version: Number(row.content_version), reviewedAt: row.reviewed_at, source: row.source });
  }
  return out;
}

async function enforceOn(): Promise<boolean> {
  const r = await db.execute<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = ${ENFORCE_KEY}`);
  // On unless an admin has switched it off — a kill switch, not an opt-in.
  return (r.rows ?? [])[0]?.value !== "false";
}

// Today's rota changes rarely and Planday costs round trips, so keep it a
// few minutes. Keyed by London date so it can never serve yesterday's rota.
let rotaCache: { date: string; at: number; byEmployee: Map<number, string[]> } | null = null;
const ROTA_TTL_MS = 5 * 60 * 1000;

async function todaysPositionsByEmployee(): Promise<Map<number, string[]>> {
  const today = londonDateString();
  if (rotaCache && rotaCache.date === today && Date.now() - rotaCache.at < ROTA_TTL_MS) return rotaCache.byEmployee;
  const { isPlandayConfigured, getPlandayShifts, getPlandayPositions } = await import("../services/planday");
  const byEmployee = new Map<number, string[]>();
  if (isPlandayConfigured()) {
    const [shifts, positions] = await Promise.all([getPlandayShifts(today, today), getPlandayPositions()]);
    const posName = new Map(positions.map(p => [p.id, p.name]));
    for (const s of shifts) {
      if (s.employeeId == null || s.positionId == null) continue;
      const name = posName.get(s.positionId);
      if (!name) continue;
      const list = byEmployee.get(s.employeeId) ?? [];
      list.push(name);
      byEmployee.set(s.employeeId, list);
    }
  }
  rotaCache = { date: today, at: Date.now(), byEmployee };
  return byEmployee;
}

async function rotaMapping(): Promise<RotaMapping> {
  const r = await db.execute<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = 'station_assignments_mapping'`);
  try { return JSON.parse((r.rows ?? [])[0]?.value ?? "") as RotaMapping; } catch { return { stations: [] }; }
}

/** Does today's Planday rota put this person on this station? Fails OPEN
 *  (false → "just checking" stays available): a Planday outage must never
 *  lock anyone out of a station. */
async function isRostered(userId: number, station: string): Promise<boolean> {
  try {
    const u = await db.execute<{ planday_employee_id: number | null }>(sql`SELECT planday_employee_id FROM app_users WHERE id = ${userId}`);
    const empId = (u.rows ?? [])[0]?.planday_employee_id;
    if (empId == null) return false;
    const [positions, mapping] = await Promise.all([todaysPositionsByEmployee(), rotaMapping()]);
    return rosteredStations(positions.get(Number(empId)) ?? [], mapping).has(station);
  } catch (err) {
    console.error("[station-training] rota lookup failed:", err);
    return false;
  }
}

async function activePass(userId: number, station: string): Promise<GatePass | null> {
  const r = await db.execute<{ kind: "skipped" | "just_looking"; valid_until: string; sop_ids: number[] }>(sql`
    SELECT kind, valid_until::text AS valid_until, sop_ids FROM station_gate_events
    WHERE user_id = ${userId} AND station = ${station} AND valid_until > NOW()
    ORDER BY created_at DESC LIMIT 1
  `);
  const row = (r.rows ?? [])[0];
  return row ? { kind: row.kind, validUntil: new Date(row.valid_until), sopIds: row.sop_ids ?? [] } : null;
}

/** Everything the gate needs for one person at one station. Opens their
 *  24-hour windows for anything they're newly behind on — but only while
 *  enforcement is on, so switching it on later doesn't find everyone's
 *  windows already expired. */
async function evaluate(userId: number, station: string, { openWindows }: { openWindows: boolean }) {
  const sops = await stationSops(station);
  const mine = (await latestReviews(sops.map(s => s.sopId), userId)).get(userId) ?? new Map<number, LatestReview>();
  const enforce = await enforceOn();

  const rows = sops.map(s => {
    const review = mine.get(s.sopId);
    return { ...s, status: reviewStatus(review?.version, s.currentVersion), reviewedAt: review?.reviewedAt ?? null };
  });
  const behind = rows.filter(r => r.status !== "trained").map(r => r.sopId);

  if (openWindows && enforce && behind.length > 0) {
    await db.execute(sql`
      INSERT INTO sop_review_windows (sop_id, user_id)
      SELECT unnest(${`{${behind.join(",")}}`}::int[]), ${userId}
      ON CONFLICT DO NOTHING
    `);
  }
  const windows = new Map<number, Date>();
  if (behind.length > 0) {
    const w = await db.execute<{ sop_id: number; first_prompted_at: string }>(sql`
      SELECT sop_id, first_prompted_at::text AS first_prompted_at FROM sop_review_windows
      WHERE user_id = ${userId} AND sop_id = ANY(${`{${behind.join(",")}}`}::int[])
    `);
    for (const x of w.rows ?? []) windows.set(x.sop_id, new Date(x.first_prompted_at));
  }

  const now = new Date();
  const [rostered, pass] = await Promise.all([isRostered(userId, station), activePass(userId, station)]);
  const decision = gateDecision({
    // No window yet (enforcement off) → treat as asked just now: never
    // "already overdue" on something nobody has been asked to do.
    outstanding: behind.map(sopId => ({ sopId, firstPromptedAt: windows.get(sopId) ?? now })),
    now,
    enforce,
    rostered,
    pass,
  });

  return {
    station,
    enforce,
    rostered,
    pass: pass ? { kind: pass.kind, validUntil: pass.validUntil.toISOString() } : null,
    sops: rows.map(r => {
      const first = windows.get(r.sopId);
      return {
        sopId: r.sopId,
        title: r.title,
        stepCount: r.stepCount,
        currentVersion: r.currentVersion,
        changedAt: r.changedAt,
        status: r.status,
        reviewedAt: r.reviewedAt,
        deadline: r.status !== "trained" && first ? deadlineFor(first).toISOString() : null,
        required: decision.required.includes(r.sopId),
      };
    }),
    decision: {
      show: decision.show,
      canSkip: decision.canSkip,
      skipUntil: decision.skipUntil?.toISOString() ?? null,
      canJustLook: decision.canJustLook,
      outstanding: behind.length,
    },
  };
}

// ── Gate ───────────────────────────────────────────────────────────────────

const stationBody = z.object({ station: z.string().regex(STATION_RE) });

// POST /gate/check {station} — called when a station opens on its LIVE plan
// (the browser decides that: history and future plans are never gated).
router.post("/gate/check", validate(stationBody), async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  res.json(await evaluate(userId, req.body.station, { openWindows: true }));
});

// POST /gate/skip {station} — "Skip for now". Re-checked here, not trusted
// from the browser: allowed only while every outstanding SOP is inside its
// 24 hours, and it lasts until the earliest of those deadlines.
router.post("/gate/skip", validate(stationBody), async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const state = await evaluate(userId, req.body.station, { openWindows: true });
  if (!state.decision.canSkip || !state.decision.skipUntil) {
    res.status(409).json({ error: "These SOPs can't be put off any longer — review them to open the station." });
    return;
  }
  const behind = state.sops.filter(s => s.status !== "trained").map(s => s.sopId);
  await db.execute(sql`
    INSERT INTO station_gate_events (user_id, station, kind, sop_ids, valid_until)
    VALUES (${userId}, ${req.body.station}, 'skipped', ${`{${behind.join(",")}}`}::int[], ${state.decision.skipUntil}::timestamptz)
  `);
  res.json(await evaluate(userId, req.body.station, { openWindows: false }));
});

// POST /gate/just-looking {station} — "Just checking, I'm not working
// here". Refused to anyone the rota puts on this station today. Lasts until
// the end of the London day, and every one is logged.
router.post("/gate/just-looking", validate(stationBody), async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const state = await evaluate(userId, req.body.station, { openWindows: true });
  if (!state.decision.canJustLook) {
    res.status(409).json({ error: "You're on the rota for this station today, so its SOPs come first." });
    return;
  }
  const behind = state.sops.filter(s => s.status !== "trained").map(s => s.sopId);
  await db.execute(sql`
    INSERT INTO station_gate_events (user_id, station, kind, sop_ids, valid_until)
    VALUES (${userId}, ${req.body.station}, 'just_looking', ${`{${behind.join(",")}}`}::int[], ${endOfLondonDay(new Date()).toISOString()}::timestamptz)
  `);
  res.json(await evaluate(userId, req.body.station, { openWindows: false }));
});

// ── Reviews ────────────────────────────────────────────────────────────────

const reviewBody = z.object({
  sopId: z.number().int().positive(),
  /** The version they actually read — sent back from what they were shown,
   *  so an edit landing mid-read doesn't count as reviewed. */
  version: z.number().int().positive(),
  source: z.enum(["station_gate", "matrix"]),
  station: z.string().regex(STATION_RE).optional(),
});

// POST /reviews — "I've read and understood", for the session user only.
router.post("/reviews", validate(reviewBody), async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { sopId, version, source, station } = req.body as z.infer<typeof reviewBody>;
  const cur = await db.execute<{ content_version: number }>(sql`SELECT content_version FROM standards_sops WHERE id = ${sopId}`);
  const currentVersion = (cur.rows ?? [])[0]?.content_version;
  if (currentVersion == null) { res.status(404).json({ error: "SOP not found" }); return; }
  const reviewed = Math.min(version, Number(currentVersion));
  await db.execute(sql`
    INSERT INTO sop_reviews (sop_id, user_id, content_version, source, station)
    VALUES (${sopId}, ${userId}, ${reviewed}, ${source}, ${station ?? null})
  `);
  const upToDate = reviewed >= Number(currentVersion);
  if (upToDate) await db.execute(sql`DELETE FROM sop_review_windows WHERE sop_id = ${sopId} AND user_id = ${userId}`);
  res.status(201).json({ status: upToDate ? "trained" : "refresher" });
});

// ── Matrices ───────────────────────────────────────────────────────────────

// GET /stations — every station that has SOPs, with the session user's own
// progress and the team's. Stations with no SOPs aren't listed (the page
// shows them from its own station list as "no SOPs yet").
router.get("/stations", async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const r = await db.execute<{ station: string; sop_id: number; content_version: number }>(sql`
    SELECT l.target_text AS station, s.id AS sop_id, s.content_version
    FROM sop_links l JOIN standards_sops s ON s.id = l.sop_id
    WHERE l.target_type = 'station'
      AND EXISTS (SELECT 1 FROM sop_steps st WHERE st.sop_id = s.id)
  `);
  const rows = r.rows ?? [];
  const reviews = await latestReviews([...new Set(rows.map(x => x.sop_id))]);
  const mine = reviews.get(userId) ?? new Map();
  const byStation = new Map<string, { sopCount: number; trained: number; refresher: number; untrained: number }>();
  for (const x of rows) {
    const s = byStation.get(x.station) ?? { sopCount: 0, trained: 0, refresher: 0, untrained: 0 };
    s.sopCount++;
    s[reviewStatus(mine.get(x.sop_id)?.version, Number(x.content_version))]++;
    byStation.set(x.station, s);
  }
  res.json({
    enforce: await enforceOn(),
    stations: [...byStation.entries()].map(([station, s]) => ({ station, ...s })),
  });
});

// GET /stations/:station/matrix — the grid: SOPs across, people down.
//
// People = active colleagues linked to Planday (real staff, not system
// accounts), plus anyone who has reviewed one of these SOPs. Those the rota
// has put on this station in the last 60 days are flagged "works here" and
// listed first — that's who the matrix is really about.
router.get("/stations/:station/matrix", async (req: Request, res: Response) => {
  const station = String(req.params.station);
  if (!STATION_RE.test(station)) { res.status(400).json({ error: "Invalid station" }); return; }
  const sops = await stationSops(station);
  const reviews = await latestReviews(sops.map(s => s.sopId));

  const people = await db.execute<{ id: number; name: string; planday_employee_id: number | null }>(sql`
    SELECT id, name, planday_employee_id FROM app_users
    WHERE is_active AND (planday_employee_id IS NOT NULL OR id = ANY(${`{${[...reviews.keys()].join(",")}}`}::int[]))
    ORDER BY name
  `);

  // Who has worked here lately, from the Planday shift mirror.
  const worksHere = new Set<number>();
  try {
    const mapping = await rotaMapping();
    const positionTitles = new Set(
      (mapping.stations ?? [])
        .filter(e => rosteredStations(e.positions ?? [], { stations: [e] }).has(station))
        .flatMap(e => e.positions ?? [])
        .map(p => p.trim().toLowerCase()),
    );
    if (positionTitles.size > 0) {
      const { getPlandayPositions, isPlandayConfigured } = await import("../services/planday");
      if (isPlandayConfigured()) {
        const ids = (await getPlandayPositions())
          .filter(p => positionTitles.has(p.name.trim().toLowerCase()))
          .map(p => p.id);
        if (ids.length > 0) {
          const recent = await db.execute<{ employee_id: string }>(sql`
            SELECT DISTINCT employee_id::text FROM planday_shifts_cache
            WHERE position_id = ANY(${`{${ids.join(",")}}`}::bigint[]) AND date >= CURRENT_DATE - 60
          `);
          for (const x of recent.rows ?? []) worksHere.add(Number(x.employee_id));
        }
      }
    }
  } catch (err) {
    console.error("[station-training] works-here lookup failed:", err);
  }

  const rows = (people.rows ?? []).map(p => {
    const mine = reviews.get(p.id) ?? new Map<number, LatestReview>();
    return {
      userId: p.id,
      name: p.name.trim(),
      worksHere: p.planday_employee_id != null && worksHere.has(Number(p.planday_employee_id)),
      cells: Object.fromEntries(sops.map(s => {
        const rv = mine.get(s.sopId);
        return [s.sopId, { status: reviewStatus(rv?.version, s.currentVersion), reviewedAt: rv?.reviewedAt ?? null, source: rv?.source ?? null }];
      })),
    };
  }).sort((a, b) => Number(b.worksHere) - Number(a.worksHere) || a.name.localeCompare(b.name));

  res.json({ station, sops, people: rows });
});

// PUT /enforce {on} — the kill switch. Admin only.
router.put("/enforce", requireAdmin, validate(z.object({ on: z.boolean() })), async (req: Request, res: Response) => {
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES (${ENFORCE_KEY}, ${req.body.on ? "true" : "false"})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  res.json({ enforce: req.body.on });
});

export default router;
