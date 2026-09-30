import { Router, type IRouter, type Request, type Response } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireFounder } from "../middleware/founder-access";
import { requireFounderArea } from "../middleware/founder-area-access";

// Sales & Marketing assistant (founder + founder.sales grantees): revenue pacing against the
// monthly target, email-cadence nudges (via Klaviyo once connected), a
// marketing calendar with a 6-week lookahead, and AI-suggested events to
// fill the gaps. The aim: there is ALWAYS something on, and falling behind
// pace is surfaced the day it happens, not at month end.

const router: IRouter = Router();

// The founder, or someone he has granted Sales & Marketing to (Graeme,
// 2026-09-29). Admin alone doesn't count. Connecting or disconnecting
// Klaviyo stays the founder's own — see requireFounder on those two routes.
router.use(requireFounderArea("founder.sales"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

async function getFounderSetting(key: string): Promise<string | null> {
  const rows = await db.execute<{ value: string }>(sql`SELECT value FROM founder_settings WHERE key = ${key} LIMIT 1`);
  return rows.rows[0]?.value ?? null;
}

// ── Klaviyo (email cadence) ────────────────────────────────────────────────
// Private API key lives in founder_settings (klaviyo_api_key), pasted by
// Graeme in the app — the connect-card pattern used for Apple Calendar.
const KLAVIYO_KEY = "klaviyo_api_key";
const KLAVIYO_REVISION = "2024-10-15";

async function klaviyoFetch<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`https://a.klaviyo.com${path}`, {
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_REVISION,
      Accept: "application/vnd.api+json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Klaviyo ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface KlaviyoCampaign {
  id: string;
  attributes: { name: string; status: string; send_time: string | null; created_at: string };
}

async function recentSentCampaigns(apiKey: string): Promise<Array<{ name: string; sentAt: string }>> {
  // No page[size] here — the campaigns resource rejects it (400 "'page_size'
  // is not a valid field"); the default page sorted newest-first is plenty
  // for cadence tracking.
  const data = await klaviyoFetch<{ data: KlaviyoCampaign[] }>(
    apiKey,
    `/api/campaigns?filter=${encodeURIComponent("equals(messages.channel,'email')")}&sort=-created_at`,
  );
  return data.data
    .filter(c => c.attributes.send_time && ["Sent", "Complete", "Completed"].includes(c.attributes.status))
    .map(c => ({ name: c.attributes.name, sentAt: c.attributes.send_time! }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .slice(0, 10);
}

router.get("/klaviyo", async (_req: Request, res: Response) => {
  const key = await getFounderSetting(KLAVIYO_KEY);
  if (!key) { res.json({ configured: false }); return; }
  try {
    const campaigns = await recentSentCampaigns(key);
    res.json({ configured: true, recentCampaigns: campaigns });
  } catch (err) {
    res.json({ configured: true, recentCampaigns: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// Saving the Klaviyo key is the founder's alone — a grantee can see the
// cadence, not change which account it reads.
router.post("/klaviyo", requireFounder, async (req: Request, res: Response) => {
  const parsed = z.object({ apiKey: z.string().trim().min(10).max(200) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "apiKey required" }); return; }
  try {
    // Verify before saving — a bad key fails fast with a readable message.
    await klaviyoFetch(parsed.data.apiKey, "/api/accounts");
    await db.execute(sql`
      INSERT INTO founder_settings (key, value, updated_at) VALUES (${KLAVIYO_KEY}, ${parsed.data.apiKey}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${parsed.data.apiKey}, updated_at = NOW()
    `);
    res.json({ configured: true });
  } catch (err) {
    res.status(400).json({ error: `Klaviyo rejected the key: ${err instanceof Error ? err.message : String(err)}` });
  }
});

router.delete("/klaviyo", requireFounder, async (_req: Request, res: Response) => {
  await db.execute(sql`DELETE FROM founder_settings WHERE key = ${KLAVIYO_KEY}`);
  res.json({ configured: false });
});

// ── Marketing calendar ─────────────────────────────────────────────────────
async function listEvents(fromIso: string, toIso: string) {
  const rows = await db.execute<{
    id: number; name: string; start_date: string; end_date: string;
    offer: string | null; notes: string | null; status: string; source: string;
  }>(sql`
    SELECT id, name, start_date::text, end_date::text, offer, notes, status, source
    FROM marketing_events
    WHERE deleted_at IS NULL AND end_date >= ${fromIso} AND start_date <= ${toIso}
    ORDER BY start_date, id
  `);
  return rows.rows.map(r => ({
    id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date,
    offer: r.offer, notes: r.notes, status: r.status, source: r.source,
  }));
}

// ── The pulse: pace + cadence + calendar + attention items ────────────────
router.get("/pulse", async (req: Request, res: Response) => {
  try {
    const today = londonToday();
    const [y, m] = today.split("-").map(Number);
    const monthStart = `${today.slice(0, 7)}-01`;
    const daysInMonth = new Date(y, m, 0).getDate();
    const dayOfMonth = Number(today.slice(8, 10));

    // Month-to-date revenue over loopback from the founder-gated Shopify
    // summary, so this page always agrees with the Founder View numbers.
    const port = process.env["PORT"];
    const cookie = req.headers.cookie ?? "";
    interface SalesSummary { totalRevenue: number; orderCount: number; estimatedMonthlyRevenue: number; averageDailyRevenue: number }
    let sales: SalesSummary | null = null;
    if (port) {
      try {
        const resp = await fetch(
          `http://127.0.0.1:${port}/api/shopify/sales-summary?from=${monthStart}&to=${today}`,
          { headers: { cookie } },
        );
        if (resp.ok) sales = await resp.json() as SalesSummary;
      } catch { /* pace shows unavailable */ }
    }

    const target = Number(await getSetting("monthly_revenue_target")) || 120000;
    const cadenceDays = Number(await getSetting("marketing_email_cadence_days")) || 3;

    const pace = sales ? {
      monthToDate: sales.totalRevenue,
      orderCount: sales.orderCount,
      projected: sales.estimatedMonthlyRevenue,
      target,
      onPace: sales.estimatedMonthlyRevenue >= target,
      // What the remaining days each need to average to still hit target.
      requiredDailyRate: Math.max(0, (target - sales.totalRevenue) / Math.max(1, daysInMonth - dayOfMonth)),
      averageDailyRevenue: sales.averageDailyRevenue,
      daysLeft: daysInMonth - dayOfMonth,
    } : null;

    // Calendar: 6-week lookahead + anything currently running.
    const horizonEnd = new Date(new Date(`${today}T00:00:00Z`).getTime() + 42 * 86_400_000).toISOString().slice(0, 10);
    const events = await listEvents(today, horizonEnd);
    const liveEvents = events.filter(e => e.startDate <= today && e.endDate >= today && e.status !== "idea");

    // Gap detection: weeks in the horizon with no planned event coverage.
    const gapWeeks: string[] = [];
    for (let w = 0; w < 6; w++) {
      const wkStart = new Date(new Date(`${today}T00:00:00Z`).getTime() + w * 7 * 86_400_000).toISOString().slice(0, 10);
      const wkEnd = new Date(new Date(`${wkStart}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
      const covered = events.some(e => e.status !== "idea" && e.startDate <= wkEnd && e.endDate >= wkStart);
      if (!covered) gapWeeks.push(wkStart);
    }

    // Email cadence via Klaviyo, when connected.
    let email: { configured: boolean; lastSentAt: string | null; daysSince: number | null; cadenceDays: number; recent: Array<{ name: string; sentAt: string }>; error?: string } =
      { configured: false, lastSentAt: null, daysSince: null, cadenceDays, recent: [] };
    const klaviyoKey = await getFounderSetting(KLAVIYO_KEY);
    if (klaviyoKey) {
      try {
        const recent = await recentSentCampaigns(klaviyoKey);
        const last = recent[0]?.sentAt ?? null;
        const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000) : null;
        email = { configured: true, lastSentAt: last, daysSince, cadenceDays, recent: recent.slice(0, 5) };
      } catch (err) {
        email = { configured: true, lastSentAt: null, daysSince: null, cadenceDays, recent: [], error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Attention items — the "personal assistant" voice, computed not vibed.
    const attention: Array<{ kind: string; message: string }> = [];
    if (pace && !pace.onPace) {
      attention.push({
        kind: "pace",
        message: `Behind pace: projecting £${Math.round(pace.projected).toLocaleString()} against the £${target.toLocaleString()} target. The remaining ${pace.daysLeft} days need to average £${Math.round(pace.requiredDailyRate).toLocaleString()}/day (current average £${Math.round(pace.averageDailyRevenue).toLocaleString()}).`,
      });
    }
    if (email.configured && !email.error && (email.daysSince == null || email.daysSince >= cadenceDays)) {
      attention.push({
        kind: "email",
        message: email.daysSince == null
          ? "No sent campaigns found — send one today?"
          : `No email in ${email.daysSince} days (cadence target: every ${cadenceDays}). Why not send one today? Different segments can be mailed more often than the full list.`,
      });
    }
    // Calendar-coverage warnings ("nothing is live", "N of 6 weeks empty") are
    // switched off while the team is building the calendar up (Graeme,
    // 2026-09-30). gapWeeks/liveEvents are still returned for later use.
    res.json({ today, pace, email, events, liveEvents, gapWeeks, attention });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
