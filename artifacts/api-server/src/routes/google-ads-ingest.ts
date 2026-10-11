/**
 * Google Ads daily spend IN — called by the Google Ads Script, not a person
 * (Graeme, 2026-10-11). Objective I.
 *
 *   POST /api/ad-spend/google-ads
 *     Authorization: Bearer <key made on Numbers → ROAS targets>
 *     { accountId, currency: "GBP", timeZone?, days: [{ date, cost }] }   ≤ 60 days
 *     → { ok, received, inserted, updated, unchanged, keptTyped, from, to, timeZoneWarning }
 *
 * Mounted in routes/index.ts ABOVE the session guard (the script has no
 * cookie), like the issue-pipeline machine API. It is not public: the key
 * check below is its only door. The key is compared against a sha256 hash
 * in ad_spend_ingest_links; with no key made (or turned off) every request
 * is a 401. Its own light rate limit sits on top of the app-wide one.
 *
 * Writes: one row per day into ad_spend_channel_days (channel 'google').
 * Each run re-sends the last week, so a day Google revises is updated. A
 * day someone typed by hand ('manual') is never touched — planMerge decides
 * and the ON CONFLICT ... WHERE enforces it even in a race. Pure logic:
 * lib/google-ads-spend.ts (tested).
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { parseBearer } from "../lib/issue-pipeline-rules";
import { londonDateString } from "../lib/london-time";
import { planMerge, type ExistingSpendRow } from "../lib/meta-ads-sync";
import {
  GOOGLE_CHANNEL, GOOGLE_SCRIPT_SOURCE, GoogleAdsSpendPayload, dayWindowProblem,
  googleTimezoneWarning, payloadDays, verifyIngestKey,
} from "../lib/google-ads-spend";

const router: IRouter = Router();

// The script runs daily (hourly at most); 60 an hour per address is plenty
// and still stops anyone hammering the key check.
router.use(rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `google-ads-ingest:${ipKeyGenerator(req.ip ?? "")}`,
  message: { error: "Too many requests — the Google Ads script only needs to run once a day." },
}));

async function requireIngestKey(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await db.execute<{ token_hash: string | null }>(sql`
      SELECT token_hash FROM ad_spend_ingest_links WHERE channel = ${GOOGLE_CHANNEL} LIMIT 1
    `);
    // Never log or echo the key, presented or stored.
    if (!verifyIngestKey(parseBearer(req.headers.authorization), rows.rows[0]?.token_hash)) {
      res.status(401).json({ error: "Wrong or missing key. Make a new one on the planner's Numbers page (ROAS targets → Google Ads spend) and paste the script again." });
      return;
    }
    next();
  } catch (err) {
    console.error("[google-ads-ingest] key check failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "The planner couldn't check the key just now — the next run will try again." });
  }
}

router.post("/", requireIngestKey, validate(GoogleAdsSpendPayload), async (req: Request, res: Response) => {
  const body = req.body as GoogleAdsSpendPayload;
  const incoming = payloadDays(body);
  const problem = dayWindowProblem(incoming.map(d => d.date), londonDateString());
  if (problem) { res.status(400).json({ error: problem }); return; }

  const from = incoming[0]!.date;
  const to = incoming[incoming.length - 1]!.date;
  try {
    const plan = await db.transaction(async (tx) => {
      const existing = await tx.execute<{ d: string; amount: string; source: string }>(sql`
        SELECT spend_date::text AS d, amount, source FROM ad_spend_channel_days
         WHERE channel = ${GOOGLE_CHANNEL} AND spend_date BETWEEN ${from}::date AND ${to}::date
      `);
      const byDate = new Map<string, ExistingSpendRow>(
        existing.rows.map(r => [r.d, { source: r.source, amount: Number(r.amount) }]),
      );
      const merge = planMerge(incoming, byDate, GOOGLE_SCRIPT_SOURCE);
      for (const row of [...merge.inserts, ...merge.updates]) {
        await tx.execute(sql`
          INSERT INTO ad_spend_channel_days (spend_date, channel, amount, source, account_id, received_at, updated_at)
          VALUES (${row.date}::date, ${GOOGLE_CHANNEL}, ${row.amount}, ${GOOGLE_SCRIPT_SOURCE}, ${body.accountId}, NOW(), NOW())
          ON CONFLICT (spend_date, channel) DO UPDATE
             SET amount = EXCLUDED.amount, account_id = EXCLUDED.account_id,
                 received_at = NOW(), updated_at = NOW()
           WHERE ad_spend_channel_days.source = ${GOOGLE_SCRIPT_SOURCE}
        `);
      }
      // Unchanged days were still re-sent: say so, so "received" is honest.
      if (merge.unchanged.length > 0) {
        await tx.execute(sql`
          UPDATE ad_spend_channel_days SET received_at = NOW()
           WHERE channel = ${GOOGLE_CHANNEL} AND source = ${GOOGLE_SCRIPT_SOURCE}
             AND spend_date = ANY(${`{${merge.unchanged.join(",")}}`}::date[])
        `);
      }
      await tx.execute(sql`
        INSERT INTO ad_spend_ingest_links (channel, last_received_at, last_day_count, last_from, last_to, last_account_id, last_time_zone, updated_at)
        VALUES (${GOOGLE_CHANNEL}, NOW(), ${incoming.length}, ${from}::date, ${to}::date, ${body.accountId}, ${body.timeZone ?? null}, NOW())
        ON CONFLICT (channel) DO UPDATE SET
          last_received_at = NOW(), last_day_count = EXCLUDED.last_day_count,
          last_from = EXCLUDED.last_from, last_to = EXCLUDED.last_to,
          last_account_id = EXCLUDED.last_account_id, last_time_zone = EXCLUDED.last_time_zone,
          updated_at = NOW()
      `);
      return merge;
    });
    const timeZoneWarning = googleTimezoneWarning(body.timeZone);
    console.log(`[google-ads-ingest] ${from}→${to}: ${plan.inserts.length} added, ${plan.updates.length} updated, ${plan.unchanged.length} unchanged, ${plan.skippedManual.length} kept (typed by hand)`);
    res.json({
      ok: true,
      received: incoming.length,
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      unchanged: plan.unchanged.length,
      keptTyped: plan.skippedManual.length,
      from,
      to,
      timeZoneWarning,
    });
  } catch (err) {
    console.error("[google-ads-ingest] save failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "The planner couldn't save the spend — nothing was changed. The next run will send it again." });
  }
});

export default router;
