/**
 * Google Ads spend — the founder's side of the script link (Graeme,
 * 2026-10-11). Objective I.
 *
 *   GET    /api/google-ads-link       status: key made?, last received, the script
 *   POST   /api/google-ads-link/key   make a key (replaces any old one) — shown ONCE
 *   DELETE /api/google-ads-link/key   turn the link off (the script gets 401s)
 *
 * Founder only (requireFounder): the key lets a script write spend figures
 * that every ROAS on Numbers divides by. The key is never stored — only
 * its sha256 — so it can't be shown again; making a new one is the way to
 * "see" it. The spend itself arrives at routes/google-ads-ingest.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireFounder } from "../middleware/founder-access";
import { validate } from "../middleware/validate";
import {
  GOOGLE_ADS_SCRIPT, GOOGLE_CHANNEL, MAX_DAYS_PER_POST, SCRIPT_KEY_PLACEHOLDER, SCRIPT_URL_PLACEHOLDER,
  generateIngestKey, googleTimezoneWarning, hashIngestKey, keyHint,
} from "../lib/google-ads-spend";

const router: IRouter = Router();
router.use(requireFounder);

/** The path the script posts to; the page puts its own origin in front. */
export const INGEST_PATH = "/api/ad-spend/google-ads";

type LinkRow = {
  token_hash: string | null; token_hint: string | null; token_created_at: Date | null; token_created_by_name: string | null;
  last_received_at: Date | null; last_day_count: number | null; last_from: string | null; last_to: string | null;
  last_account_id: string | null; last_time_zone: string | null;
};

const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);

async function status() {
  const [link, first] = await Promise.all([
    db.execute<LinkRow>(sql`
      -- TIMESTAMP columns hold UTC (sessions are pinned to UTC). Say so, so
      -- the instant is right whatever timezone the Node process runs in.
      SELECT token_hash, token_hint, (token_created_at AT TIME ZONE 'UTC') AS token_created_at, token_created_by_name,
             (last_received_at AT TIME ZONE 'UTC') AS last_received_at, last_day_count, last_from::text AS last_from, last_to::text AS last_to,
             last_account_id, last_time_zone
        FROM ad_spend_ingest_links WHERE channel = ${GOOGLE_CHANNEL} LIMIT 1
    `),
    db.execute<{ d: string | null; n: string }>(sql`
      SELECT MIN(spend_date)::text AS d, COUNT(*)::text AS n FROM ad_spend_channel_days WHERE channel = ${GOOGLE_CHANNEL}
    `),
  ]);
  const r = link.rows[0];
  return {
    hasKey: !!r?.token_hash,
    keyHint: r?.token_hash ? r.token_hint : null,
    keyCreatedAt: r?.token_hash ? iso(r.token_created_at) : null,
    keyCreatedByName: r?.token_hash ? r.token_created_by_name : null,
    lastReceivedAt: iso(r?.last_received_at ?? null),
    lastDayCount: r?.last_day_count ?? null,
    lastFrom: r?.last_from ?? null,
    lastTo: r?.last_to ?? null,
    lastAccountId: r?.last_account_id ?? null,
    lastTimeZone: r?.last_time_zone ?? null,
    timeZoneWarning: googleTimezoneWarning(r?.last_time_zone),
    firstDate: first.rows[0]?.d ?? null,
    daysStored: Number(first.rows[0]?.n ?? 0),
    ingestPath: INGEST_PATH,
    maxDaysPerSend: MAX_DAYS_PER_POST,
    script: GOOGLE_ADS_SCRIPT,
    placeholders: { url: SCRIPT_URL_PLACEHOLDER, key: SCRIPT_KEY_PLACEHOLDER },
  };
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json(await status());
  } catch (err) {
    console.error("[google-ads-link] status failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Couldn't load the Google Ads link" });
  }
});

/** Nothing to send: the body is checked so nothing unexpected rides along. */
export const MakeKeyBody = z.object({}).strict();

router.post("/key", validate(MakeKeyBody), async (req: Request, res: Response) => {
  try {
    const key = generateIngestKey();
    const me = await db.execute<{ name: string | null }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId!} LIMIT 1`);
    await db.execute(sql`
      INSERT INTO ad_spend_ingest_links (channel, token_hash, token_hint, token_created_at, token_created_by_name, updated_at)
      VALUES (${GOOGLE_CHANNEL}, ${hashIngestKey(key)}, ${keyHint(key)}, NOW(), ${me.rows[0]?.name ?? null}, NOW())
      ON CONFLICT (channel) DO UPDATE SET
        token_hash = EXCLUDED.token_hash, token_hint = EXCLUDED.token_hint,
        token_created_at = NOW(), token_created_by_name = EXCLUDED.token_created_by_name, updated_at = NOW()
    `);
    // The only time the key leaves the server.
    res.json({ key, ...(await status()) });
  } catch (err) {
    console.error("[google-ads-link] make key failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Couldn't make a key — the old one (if any) still works." });
  }
});

router.delete("/key", async (_req: Request, res: Response) => {
  try {
    await db.execute(sql`
      UPDATE ad_spend_ingest_links SET token_hash = NULL, token_hint = NULL, token_created_at = NULL,
             token_created_by_name = NULL, updated_at = NOW()
       WHERE channel = ${GOOGLE_CHANNEL}
    `);
    res.json(await status());
  } catch (err) {
    console.error("[google-ads-link] turn off failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Couldn't turn the link off — the key still works." });
  }
});

export default router;
