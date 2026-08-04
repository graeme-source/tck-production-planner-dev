import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import type Anthropic from "@anthropic-ai/sdk";

// Sales & Marketing assistant (founder-only): revenue pacing against the
// monthly target, email-cadence nudges (via Klaviyo once connected), a
// marketing calendar with a 6-week lookahead, and AI-suggested events to
// fill the gaps. The aim: there is ALWAYS something on, and falling behind
// pace is surfaced the day it happens, not at month end.

const router: IRouter = Router();

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";
async function requireFounder(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const rows = await db.execute<{ email: string }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  if (rows.rows[0]?.email !== FOUNDER_EMAIL) { res.status(403).json({ error: "Founder only" }); return; }
  next();
}
router.use(requireFounder);

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
  const data = await klaviyoFetch<{ data: KlaviyoCampaign[] }>(
    apiKey,
    `/api/campaigns?filter=${encodeURIComponent("equals(messages.channel,'email')")}&sort=-created_at&page[size]=25`,
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

router.post("/klaviyo", async (req: Request, res: Response) => {
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

router.delete("/klaviyo", async (_req: Request, res: Response) => {
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
    WHERE end_date >= ${fromIso} AND start_date <= ${toIso}
    ORDER BY start_date, id
  `);
  return rows.rows.map(r => ({
    id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date,
    offer: r.offer, notes: r.notes, status: r.status, source: r.source,
  }));
}

router.post("/events", async (req: Request, res: Response) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(120),
    startDate: z.string().regex(DATE_RE),
    endDate: z.string().regex(DATE_RE),
    offer: z.string().trim().max(500).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    status: z.enum(["idea", "planned"]).optional(),
    source: z.enum(["manual", "ai"]).optional(),
  }).refine(e => e.endDate >= e.startDate, { message: "endDate before startDate" }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const b = parsed.data;
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO marketing_events (name, start_date, end_date, offer, notes, status, source)
    VALUES (${b.name}, ${b.startDate}, ${b.endDate}, ${b.offer ?? null}, ${b.notes ?? null}, ${b.status ?? "planned"}, ${b.source ?? "manual"})
    RETURNING id
  `);
  res.status(201).json({ id: rows.rows[0].id });
});

router.patch("/events/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    startDate: z.string().regex(DATE_RE).optional(),
    endDate: z.string().regex(DATE_RE).optional(),
    offer: z.string().trim().max(500).nullish(),
    status: z.enum(["idea", "planned"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const b = parsed.data;
  await db.execute(sql`
    UPDATE marketing_events SET
      name = COALESCE(${b.name ?? null}, name),
      start_date = COALESCE(${b.startDate ?? null}::date, start_date),
      end_date = COALESCE(${b.endDate ?? null}::date, end_date),
      offer = CASE WHEN ${b.offer !== undefined} THEN ${b.offer ?? null} ELSE offer END,
      status = COALESCE(${b.status ?? null}, status)
    WHERE id = ${id}
  `);
  res.json({ ok: true });
});

router.delete("/events/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM marketing_events WHERE id = ${id}`);
  res.json({ ok: true });
});

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
    const liveEvents = events.filter(e => e.startDate <= today && e.endDate >= today && e.status === "planned");

    // Gap detection: weeks in the horizon with no planned event coverage.
    const gapWeeks: string[] = [];
    for (let w = 0; w < 6; w++) {
      const wkStart = new Date(new Date(`${today}T00:00:00Z`).getTime() + w * 7 * 86_400_000).toISOString().slice(0, 10);
      const wkEnd = new Date(new Date(`${wkStart}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
      const covered = events.some(e => e.status === "planned" && e.startDate <= wkEnd && e.endDate >= wkStart);
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
    if (liveEvents.length === 0) {
      attention.push({ kind: "calendar", message: "Nothing is live on the marketing calendar right now — there should always be something on." });
    }
    if (gapWeeks.length > 0) {
      attention.push({
        kind: "calendar",
        message: `${gapWeeks.length} of the next 6 weeks have nothing locked in (from w/c ${gapWeeks[0]}). Use Suggest events to fill the gaps.`,
      });
    }

    res.json({ today, pace, email, events, liveEvents, gapWeeks, attention });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── AI event suggestions ───────────────────────────────────────────────────
const SUGGEST_TOOL: Anthropic.Tool = {
  name: "suggest_events",
  description: "Suggest marketing calendar events for The Calzone Kitchen.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Catchy event/offer name" },
            startDate: { type: "string", description: "YYYY-MM-DD" },
            endDate: { type: "string", description: "YYYY-MM-DD" },
            angle: { type: "string", description: "One sentence: the hook and why now" },
            offerIdea: { type: "string", description: "Concrete offer mechanic (e.g. free pack over £X, bundle, limited flavour)" },
          },
          required: ["name", "startDate", "endDate", "angle", "offerIdea"],
        },
      },
    },
    required: ["suggestions"],
  },
};

router.post("/suggest-events", async (_req: Request, res: Response) => {
  if (!isClaudeConfigured()) { res.status(503).json({ error: "AI is not configured on this server." }); return; }
  try {
    const today = londonToday();
    const horizonEnd = new Date(new Date(`${today}T00:00:00Z`).getTime() + 56 * 86_400_000).toISOString().slice(0, 10);
    const events = await listEvents(today, horizonEnd);

    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 1500,
      system: [
        "You plan the marketing calendar for The Calzone Kitchen — a UK artisan business delivering treat-night calzones and mac & cheese nationwide (D2C via Shopify, email via Klaviyo, Meta ads).",
        "Their rule: there is ALWAYS a named offer or event running. Past examples: a football World Cup box, Black Friday, a summer-holiday free pack offer.",
        "Suggest 3-5 events covering the UNCOVERED weeks in the next ~8 weeks. UK calendar awareness (bank holidays, back to school, Halloween, Bonfire Night, payday weekends). Events should feel like TCK: warm, family, treat-night — not corporate.",
        "Dates must be realistic windows (5-14 days each), not overlapping existing planned events. Use the suggest_events tool only.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: `Today: ${today}\nExisting events (do not overlap these):\n${events.map(e => `- ${e.name}: ${e.startDate} → ${e.endDate} [${e.status}]`).join("\n") || "(none)"}`,
      }],
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: "suggest_events" },
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const input = (toolUse?.input ?? { suggestions: [] }) as { suggestions: Array<{ name: string; startDate: string; endDate: string; angle: string; offerIdea: string }> };
    const clean = input.suggestions.filter(s => DATE_RE.test(s.startDate) && DATE_RE.test(s.endDate) && s.endDate >= s.startDate);
    res.json({ suggestions: clean });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
