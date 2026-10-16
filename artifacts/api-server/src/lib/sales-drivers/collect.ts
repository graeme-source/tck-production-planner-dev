/**
 * Sales drivers — collectors and the daily jobs that run them. Objective I.
 *
 *   13:00 London  recordDeliveryAvailability — what delivery a customer
 *                 could book right now, from Zapiet's own calendar (an hour
 *                 before the 2pm next-day cutoff). The exact daily record.
 *   06:15 London  runDailyRefresh — yesterday's sessions/conversion from
 *                 Shopify, lead-time estimates from orders for days the 1pm
 *                 check didn't cover, theme changes and Klaviyo sends into
 *                 the changelog. The first run back-fills history.
 *
 * Read-only towards Shopify, Zapiet, GitHub and Klaviyo — nothing here
 * writes anywhere but this app's own tables.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { schedule } from "node-cron";
import { isStaging } from "../app-env";
import { zapietCalendar, getStockGateSettings } from "../stock-gating";
import { getDailyOnlineStoreConversion, getOnlineStoreConversion, type ShopifyOrder } from "../../services/shopify";
import { getCachedOrdersLondonDays } from "../orders-cache";
import { londonDateString, londonMinuteOfDay, addDaysToDateString } from "../london-time";
import { klaviyoEmailsForRange } from "../klaviyo-campaign-calendar";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../ai/claude";
import { earliestFromZapietCalendar, estimateLeadFromOrders, type OrderForLead } from "./analysis";
import { parseCommitMessage, isThemeEditorSave, isMergeCommit, categoriseThemeChange, countsForLeadHistory } from "./changes";

const BACKFILL_DAYS = 180;
const THEME_REPO = process.env["THEME_GITHUB_REPO"] ?? "graeme-source/tck-theme";
const THEME_BRANCH = process.env["THEME_GITHUB_BRANCH"] ?? "main";

const splitTags = (tags: string) => tags.split(",").map(t => t.trim()).filter(Boolean);

// ── Delivery availability ───────────────────────────────────────────────────

export async function recordDeliveryAvailability(
  source: "zapiet_1pm" | "zapiet_check" = "zapiet_1pm",
  now: Date = new Date(),
): Promise<{ recorded: boolean; reason?: string; leadDays?: number | null }> {
  const today = londonDateString(now);
  const { zapietLocationId } = await getStockGateSettings();
  const cal = await zapietCalendar(zapietLocationId, []);
  if (!cal) return { recorded: false, reason: "ZAPIET_API_KEY or SHOPIFY_STORE_DOMAIN not set" };
  const a = earliestFromZapietCalendar(today, cal);
  const note = JSON.stringify({ minDate: cal.minDate ?? null, disabled: cal.disabled ?? [] }).slice(0, 2000);
  // The 1pm check is the record of the day; an ad-hoc check only fills a
  // day that has no 1pm reading and never replaces one.
  await db.execute(sql`
    INSERT INTO delivery_availability_daily (day, checked_at, earliest_date, lead_days, next_day_available, source, note)
    VALUES (${today}, ${now.toISOString()}::timestamptz, ${a.earliestDate}, ${a.leadDays}, ${a.nextDayAvailable}, ${source}, ${note})
    ON CONFLICT (day) DO UPDATE SET
      checked_at = EXCLUDED.checked_at, earliest_date = EXCLUDED.earliest_date, lead_days = EXCLUDED.lead_days,
      next_day_available = EXCLUDED.next_day_available, source = EXCLUDED.source, sample_orders = NULL, note = EXCLUDED.note
    WHERE delivery_availability_daily.source <> 'zapiet_1pm' OR ${source} = 'zapiet_1pm'
  `);
  return { recorded: true, leadDays: a.leadDays };
}

function ordersForLead(orders: ShopifyOrder[]): OrderForLead[] {
  return orders
    .filter(o => countsForLeadHistory(splitTags(o.tags), o.cancelled_at != null))
    .map(o => {
      const at = new Date(o.created_at);
      return { day: londonDateString(at), minuteOfDay: londonMinuteOfDay(at), tags: splitTags(o.tags) };
    });
}

/** Estimated lead time for past days, from the shortest wait booked before
 *  1pm. Never overwrites a real Zapiet reading. */
export async function backfillLeadEstimates(from: string, to: string): Promise<number> {
  const orders = await getCachedOrdersLondonDays(from, to);
  const estimates = estimateLeadFromOrders(ordersForLead(orders)).filter(e => e.day >= from && e.day <= to);
  for (const e of estimates) {
    await db.execute(sql`
      INSERT INTO delivery_availability_daily (day, earliest_date, lead_days, next_day_available, source, sample_orders, note)
      VALUES (${e.day}, ${e.earliestDate}, ${e.leadDays}, ${e.leadDays === 1}, 'orders_estimate', ${e.sampleOrders},
              'Estimated: shortest wait any customer booked before 1pm')
      ON CONFLICT (day) DO UPDATE SET
        earliest_date = EXCLUDED.earliest_date, lead_days = EXCLUDED.lead_days,
        next_day_available = EXCLUDED.next_day_available, sample_orders = EXCLUDED.sample_orders, checked_at = NOW()
      WHERE delivery_availability_daily.source = 'orders_estimate'
    `);
  }
  return estimates.length;
}

// ── Sessions / conversion / orders per day ──────────────────────────────────

export async function refreshDailyMetrics(from: string, to: string): Promise<number> {
  let series = await getDailyOnlineStoreConversion(from, to);
  if (!series) {
    // Grouped query not accepted — one day at a time (slower, same numbers
    // as the Numbers page).
    series = [];
    for (let d = from; d <= to; d = addDaysToDateString(d, 1)) {
      const r = await getOnlineStoreConversion(d, d);
      series.push({ day: d, ...r });
    }
  }
  const orders = await getCachedOrdersLondonDays(from, to);
  const perDay = new Map<string, { orders: number; newCustomers: number; revenue: number }>();
  for (const o of orders) {
    if (o.cancelled_at) continue;
    const tags = splitTags(o.tags).map(t => t.toLowerCase());
    if (tags.includes("subscription recurring order") || tags.includes("wholesale")) continue;
    const day = londonDateString(new Date(o.created_at));
    const cur = perDay.get(day) ?? { orders: 0, newCustomers: 0, revenue: 0 };
    cur.orders += 1;
    if (tags.includes("new-customer")) cur.newCustomers += 1;
    cur.revenue += Number(o.total_price) || 0;
    perDay.set(day, cur);
  }
  for (const s of series) {
    const o = perDay.get(s.day);
    await db.execute(sql`
      INSERT INTO store_daily_metrics (day, sessions, conversion_rate, orders, new_customer_orders, revenue, fetched_at)
      VALUES (${s.day}, ${s.sessions}, ${s.conversionRate}, ${o?.orders ?? 0}, ${o?.newCustomers ?? 0}, ${o?.revenue ?? 0}, NOW())
      ON CONFLICT (day) DO UPDATE SET
        sessions = EXCLUDED.sessions, conversion_rate = EXCLUDED.conversion_rate, orders = EXCLUDED.orders,
        new_customer_orders = EXCLUDED.new_customer_orders, revenue = EXCLUDED.revenue, fetched_at = NOW()
    `);
  }
  return series.length;
}

// ── Changelog imports ───────────────────────────────────────────────────────

type GithubCommit = { sha: string; commit: { message: string; committer: { date: string } } };
type GithubCommitDetail = GithubCommit & { files?: Array<{ filename: string; patch?: string }> };

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "tck-production-planner" };
  const token = process.env["GITHUB_TOKEN"];
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

/** A theme-editor save's commit message is empty of meaning; describe the
 *  diff in one plain line instead (Haiku). Falls back to the file list. */
async function describeEditorSave(detail: GithubCommitDetail): Promise<string> {
  const files = (detail.files ?? []).map(f => f.filename);
  const fallback = `Theme editor save (${files.join(", ") || "no files listed"})`;
  if (!isClaudeConfigured() || !detail.files?.length) return fallback;
  const diff = detail.files.map(f => `### ${f.filename}\n${f.patch ?? "(no patch)"}`).join("\n\n").slice(0, 8000);
  try {
    const resp = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 300,
      tools: [{
        name: "emit_change",
        description: "One plain-English line describing what changed on the website.",
        input_schema: {
          type: "object",
          properties: { title: { type: "string", description: "Under 120 characters, e.g. 'Free pack threshold £39.95 → £34.95; announcement now says ends Friday'." } },
          required: ["title"],
        },
      }],
      tool_choice: { type: "tool", name: "emit_change" },
      messages: [{
        role: "user",
        content: `This is a Shopify theme-editor save on a food delivery website. Describe what a customer would see differently, in one line, naming old → new values where the diff shows them (offer wording, thresholds, prices, sections shown or hidden). Ignore whitespace, reordering and IDs. Never invent anything not in the diff.\n\n${diff}`,
      }],
    });
    const block = resp.content.find(b => b.type === "tool_use");
    const title = block && block.type === "tool_use" ? String((block.input as { title?: string }).title ?? "").trim() : "";
    return title ? `Theme editor: ${title}`.slice(0, 200) : fallback;
  } catch (err) {
    console.warn("[sales-drivers] editor-save summary failed:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

export async function importThemeChanges(): Promise<{ imported: number; error?: string }> {
  const last = await db.execute<{ max: string | null }>(sql`
    SELECT MAX(effective_at)::text AS max FROM site_changes WHERE source = 'theme'
  `);
  const since = last.rows[0]?.max
    ? new Date(Date.parse(last.rows[0].max) - 86_400_000).toISOString()
    : new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString();
  const commits: GithubCommit[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = `https://api.github.com/repos/${THEME_REPO}/commits?sha=${encodeURIComponent(THEME_BRANCH)}&since=${encodeURIComponent(since)}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers: githubHeaders() });
    if (!res.ok) return { imported: 0, error: `GitHub ${res.status} for ${THEME_REPO} (is GITHUB_TOKEN allowed to read it?)` };
    const rows = (await res.json()) as GithubCommit[];
    commits.push(...rows);
    if (rows.length < 100) break;
  }
  const known = await db.execute<{ source_ref: string }>(sql`SELECT source_ref FROM site_changes WHERE source = 'theme' AND source_ref IS NOT NULL`);
  const seen = new Set(known.rows.map(r => r.source_ref));
  let imported = 0;
  for (const c of commits.reverse()) {
    if (seen.has(c.sha)) continue;
    const { title, detail } = parseCommitMessage(c.commit.message);
    if (isMergeCommit(title)) continue;
    let finalTitle = title;
    let files: string[] = [];
    if (isThemeEditorSave(title)) {
      const res = await fetch(`https://api.github.com/repos/${THEME_REPO}/commits/${c.sha}`, { headers: githubHeaders() });
      if (res.ok) {
        const d = (await res.json()) as GithubCommitDetail;
        files = (d.files ?? []).map(f => f.filename);
        finalTitle = await describeEditorSave(d);
      }
    }
    await db.execute(sql`
      INSERT INTO site_changes (effective_at, category, title, detail, source, source_ref, created_by)
      VALUES (${c.commit.committer.date}::timestamptz, ${categoriseThemeChange(finalTitle, files)}, ${finalTitle.slice(0, 300)},
              ${detail}, 'theme', ${c.sha}, 'GitHub theme sync')
      ON CONFLICT DO NOTHING
    `);
    imported++;
  }
  return { imported };
}

export async function importKlaviyoSends(from: string, to: string): Promise<{ imported: number; connected: boolean }> {
  const { connected, emails } = await klaviyoEmailsForRange(from, to);
  let imported = 0;
  for (const e of emails.filter(x => x.status === "Sent")) {
    const r = await db.execute(sql`
      INSERT INTO site_changes (effective_at, category, title, detail, source, source_ref, created_by)
      VALUES (${e.sendAt}::timestamptz, 'email', ${`Email: ${e.name}`.slice(0, 300)},
              ${[e.subject && `Subject: ${e.subject}`, e.audiences.length ? `To: ${e.audiences.join(", ")}` : null].filter(Boolean).join(" · ") || null},
              'klaviyo', ${e.id}, 'Klaviyo')
      ON CONFLICT DO NOTHING
    `);
    imported += r.rowCount ?? 0;
  }
  return { imported, connected };
}

// ── Orchestration ───────────────────────────────────────────────────────────

let running = false;

export type RefreshResult = { ok: boolean; steps: Record<string, string> };

/** Everything except the 1pm check. On an empty history, back-fills
 *  BACKFILL_DAYS; otherwise refreshes the last week (Shopify revises the
 *  most recent days' sessions). */
export async function runDailyRefresh(): Promise<RefreshResult> {
  if (running) return { ok: false, steps: { refresh: "already running" } };
  running = true;
  const steps: Record<string, string> = {};
  const step = async (name: string, fn: () => Promise<string>) => {
    try { steps[name] = await fn(); } catch (err) {
      steps[name] = `failed: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[sales-drivers] ${name} failed:`, err);
    }
  };
  try {
    const today = londonDateString();
    const yesterday = addDaysToDateString(today, -1);
    const have = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM store_daily_metrics`);
    const from = (have.rows[0]?.n ?? 0) === 0 ? addDaysToDateString(today, -BACKFILL_DAYS) : addDaysToDateString(today, -7);
    await step("metrics", async () => `${await refreshDailyMetrics(from, yesterday)} days`);
    await step("leadEstimates", async () => `${await backfillLeadEstimates(from, yesterday)} days`);
    await step("theme", async () => { const r = await importThemeChanges(); return r.error ?? `${r.imported} new`; });
    await step("klaviyo", async () => {
      const r = await importKlaviyoSends(from, today);
      return r.connected ? `${r.imported} new` : "not connected";
    });
    return { ok: Object.values(steps).every(s => !s.startsWith("failed")), steps };
  } finally {
    running = false;
  }
}

export function startSalesDriverJobs(): void {
  if (isStaging()) {
    console.log("[sales-drivers] staging: jobs disabled");
    return;
  }
  schedule("0 13 * * *", () => {
    recordDeliveryAvailability("zapiet_1pm").catch(err => console.warn("[sales-drivers] 1pm check failed:", err));
  }, { timezone: "Europe/London" });
  schedule("15 6 * * *", () => {
    void runDailyRefresh();
  }, { timezone: "Europe/London" });
  // First boot after deploy: fill the history without waiting for 06:15.
  setTimeout(() => { void runDailyRefresh(); }, 2 * 60_000).unref();
  console.log("[sales-drivers] jobs scheduled — delivery check 13:00, refresh 06:15 Europe/London");
}
