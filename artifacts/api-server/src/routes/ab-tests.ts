/**
 * /api/ab-tests — the Business → Website A/B tests tab (Graeme, 2026-10-24).
 * Same access as Sales & Marketing (founder, or a founder.sales grant).
 *
 *   GET   /             every test, newest first; first syncs Shopify Rollouts
 *                       (needs the read_rollouts scope — without it the tab
 *                       says so and hand-added tests still work)
 *   GET   /themes       themes the website snippet has reported, for set-up
 *   POST  /             add a test by hand (name, start, themes)
 *   PATCH /:id          rename / end / change the themes of a test
 *   GET   /:id/results  sessions, add-to-cart, orders, revenue, revenue per
 *                       session, new subscriptions per theme (lib/ab-results)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";
import { requireFounderArea } from "../middleware/founder-area-access";
import { validate } from "../middleware/validate";
import { shopifyGraphQL } from "../services/shopify";
import { getCachedOrders } from "../lib/orders-cache";
import { computeAbResults, type AbOrder, type AbVariant, type VariantHits } from "../lib/ab-results";
import { ROLLOUTS_QUERY, testFromRollout, type RolloutNode } from "../lib/ab-rollouts";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

interface TestRow {
  [k: string]: unknown;
  id: number; rollout_id: string | null; name: string; status: string;
  started_at: string; ends_at: string | null; concluded_at: string | null;
  variants: AbVariant[]; updated_at: string;
}

function serialise(t: TestRow) {
  return {
    id: t.id, rolloutId: t.rollout_id, name: t.name, status: t.status, source: t.rollout_id ? "rollouts" : "manual",
    startedAt: t.started_at, endsAt: t.ends_at, concludedAt: t.concluded_at, variants: t.variants ?? [],
  };
}

async function themesSeen(from: Date, to: Date) {
  const rows = await db.execute<{ theme_id: string; theme_name: string | null; sessions: number }>(sql`
    SELECT theme_id::text, MAX(theme_name) AS theme_name, COUNT(*)::int AS sessions
    FROM ab_hits WHERE kind = 'visit' AND at >= ${from} AND at <= ${to}
    GROUP BY theme_id ORDER BY sessions DESC
  `);
  return rows.rows.map(r => ({ themeId: Number(r.theme_id), themeName: r.theme_name, sessions: r.sessions }));
}

// Rollouts sync, at most once a minute — the tab polls.
let lastSync: { at: number; status: RolloutsStatus } | null = null;
type RolloutsStatus = { connected: boolean; message: string | null };

async function syncRollouts(): Promise<RolloutsStatus> {
  if (lastSync && Date.now() - lastSync.at < 60_000) return lastSync.status;
  let status: RolloutsStatus;
  try {
    const data = await shopifyGraphQL<{ rollouts: { nodes: RolloutNode[] } }>(ROLLOUTS_QUERY, undefined, "2026-10");
    for (const r of data.rollouts.nodes) {
      const start = new Date(r.startedAt ?? r.schedule?.activateAt ?? r.createdAt);
      const end = r.concludedAt ? new Date(r.concludedAt) : new Date();
      const t = testFromRollout(r, await themesSeen(start, end));
      if (!t) continue;
      await db.execute(sql`
        INSERT INTO ab_tests (rollout_id, name, status, started_at, ends_at, concluded_at, variants)
        VALUES (${t.rolloutId}, ${t.name}, ${t.status}, ${t.startedAt}, ${t.endsAt}, ${t.concludedAt}, ${JSON.stringify(t.variants)}::jsonb)
        ON CONFLICT (rollout_id) DO UPDATE SET
          name = EXCLUDED.name, status = EXCLUDED.status, started_at = EXCLUDED.started_at,
          ends_at = EXCLUDED.ends_at, concluded_at = EXCLUDED.concluded_at,
          -- keep the control we found earlier if this pass couldn't see one
          variants = CASE WHEN jsonb_array_length(EXCLUDED.variants) >= jsonb_array_length(ab_tests.variants) THEN EXCLUDED.variants ELSE ab_tests.variants END,
          updated_at = NOW()
      `);
    }
    status = { connected: true, message: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    status = /access denied/i.test(msg)
      ? { connected: false, message: "Shopify hasn't given the planner permission to read Rollouts yet (read_rollouts)." }
      : { connected: false, message: `Couldn't read Rollouts from Shopify: ${msg.slice(0, 200)}` };
    if (!/access denied/i.test(msg)) console.warn("[ab-tests] rollouts sync failed:", msg);
  }
  lastSync = { at: Date.now(), status };
  return status;
}

router.get("/", async (_req: Request, res: Response) => {
  const rollouts = await syncRollouts();
  const rows = await db.execute<TestRow>(sql`SELECT * FROM ab_tests ORDER BY started_at DESC`);
  res.json({ tests: rows.rows.map(serialise), rollouts });
});

router.get("/themes", async (_req: Request, res: Response) => {
  res.json(await themesSeen(new Date(Date.now() - 90 * 86_400_000), new Date()));
});

const variantSchema = z.object({
  label: z.string().trim().min(1).max(60),
  themeId: z.number().int().positive(),
  themeName: z.string().max(200).nullish(),
  split: z.number().int().min(0).max(100).nullish(),
});
const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  startedAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullish(),
  variants: z.array(variantSchema).min(2).max(4),
});
const patchBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "CONCLUDED"]).optional(),
  concludedAt: z.string().datetime({ offset: true }).nullish(),
  variants: z.array(variantSchema).min(2).max(4).optional(),
});

const norm = (vs: z.infer<typeof variantSchema>[]): AbVariant[] =>
  vs.map(v => ({ label: v.label, themeId: v.themeId, themeName: v.themeName ?? null, split: v.split ?? null }));

router.post("/", validate(createBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof createBody>;
  const rows = await db.execute<TestRow>(sql`
    INSERT INTO ab_tests (name, status, started_at, ends_at, variants)
    VALUES (${b.name}, 'ACTIVE', ${b.startedAt}, ${b.endsAt ?? null}, ${JSON.stringify(norm(b.variants))}::jsonb)
    RETURNING *
  `);
  res.status(201).json(serialise(rows.rows[0]));
});

router.patch("/:id", validate(patchBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(404).json({ error: "Test not found" }); return; }
  const b = req.body as z.infer<typeof patchBody>;
  const concludedAt = b.status === "CONCLUDED" ? (b.concludedAt ?? new Date().toISOString()) : b.concludedAt;
  const rows = await db.execute<TestRow>(sql`
    UPDATE ab_tests SET
      name = COALESCE(${b.name ?? null}, name),
      status = COALESCE(${b.status ?? null}, status),
      concluded_at = ${concludedAt === undefined ? sql`concluded_at` : concludedAt},
      variants = COALESCE(${b.variants ? JSON.stringify(norm(b.variants)) : null}::jsonb, variants),
      updated_at = NOW()
    WHERE id = ${id} RETURNING *
  `);
  if (!rows.rows[0]) { res.status(404).json({ error: "Test not found" }); return; }
  res.json(serialise(rows.rows[0]));
});

router.get("/:id/results", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(404).json({ error: "Test not found" }); return; }
  const rows = await db.execute<TestRow>(sql`SELECT * FROM ab_tests WHERE id = ${id}`);
  const test = rows.rows[0];
  if (!test) { res.status(404).json({ error: "Test not found" }); return; }
  try {
    const from = new Date(test.started_at);
    const to = test.concluded_at ? new Date(test.concluded_at) : new Date();
    const ids = (test.variants ?? []).map(v => v.themeId);
    const hitRows = ids.length ? (await db.execute<{ theme_id: string; kind: string; n: number }>(sql`
      SELECT theme_id::text, kind, COUNT(*)::int AS n FROM ab_hits
      WHERE at >= ${from} AND at <= ${to} AND theme_id = ANY(${`{${ids.join(",")}}`}::bigint[])
      GROUP BY theme_id, kind
    `)).rows : [];
    const hits = new Map<number, VariantHits>();
    for (const r of hitRows) {
      const h = hits.get(Number(r.theme_id)) ?? { visits: 0, addToCart: 0 };
      if (r.kind === "visit") h.visits = r.n; else h.addToCart = r.n;
      hits.set(Number(r.theme_id), h);
    }
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const orders = (await getCachedOrders(day(from), day(to))) as unknown as AbOrder[];
    const results = computeAbResults({ variants: test.variants ?? [], hits, orders, from, to });
    // When the first hit arrived — before that the snippet wasn't on the site.
    const first = await db.execute<{ first: string | null }>(sql`SELECT MIN(at) AS first FROM ab_hits WHERE at >= ${from}`);
    res.json({ test: serialise(test), from, to, trackingSince: first.rows[0]?.first ?? null, ...results });
  } catch (err) {
    console.error("[ab-tests] results error:", err);
    res.status(500).json({ error: "Couldn't load the results — try again" });
  }
});

export default router;
