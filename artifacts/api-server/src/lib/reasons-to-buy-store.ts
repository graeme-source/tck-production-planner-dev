/**
 * Reasons to Buy (Graeme, 18 Nov 2026). The list lives in
 * marketing_reasons_to_buy; every sent Klaviyo email of the last year is
 * read once against it — subject, preview, name and the body's words — by
 * Claude, and the reasons it used are stored. A changed list (any name or
 * description) re-reads everything. The report groups each reason's emails
 * into uses and orders the reasons least recently used first; the rules are
 * pure in @workspace/marketing-calendar (reasons-to-buy.ts). Objective I.
 *
 * READ-ONLY towards Klaviyo and Shopify.
 */
import {
  db, marketingCampaignReasonMatchesTable, marketingCampaignReasonsReadTable, marketingReasonsToBuyTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  addDays, emailText, reasonsSignature, summariseReasons,
  type ReasonDef, type ReasonEmail, type ReasonSummary,
} from "@workspace/marketing-calendar";
import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "./ai/claude";
import { klaviyoCampaignHtml, klaviyoCampaignResults, klaviyoCampaignsForMatching } from "./klaviyo-campaign-calendar";
import type { KlaviyoCalendarEmail } from "./klaviyo-campaign-map";
import { getCachedOrdersLondonDays } from "./orders-cache";
import { newVsReturningTotals } from "./order-revenue";

/** How far back emails are read: Klaviyo's results cover a year. */
const LOOKBACK_DAYS = 365;
/** Emails read per call to Claude. */
const BATCH = 12;
/** The days before a use that its sales are compared with. */
const BEFORE_DAYS = 28;

export async function listReasons(): Promise<ReasonDef[]> {
  const rows = await db.select({
    id: marketingReasonsToBuyTable.id, name: marketingReasonsToBuyTable.name, description: marketingReasonsToBuyTable.description,
  }).from(marketingReasonsToBuyTable)
    .where(isNull(marketingReasonsToBuyTable.deletedAt))
    .orderBy(asc(marketingReasonsToBuyTable.sortOrder), asc(marketingReasonsToBuyTable.id));
  return rows;
}

async function sentCampaigns(today: string): Promise<KlaviyoCalendarEmail[] | null> {
  const all = await klaviyoCampaignsForMatching(addDays(today, -LOOKBACK_DAYS));
  if (!all) return null;
  return all.filter(c => c.status === "Sent" && c.date <= today);
}

// ── Reading emails against the list ───────────────────────────────────────

const READ_TOOL: Anthropic.Tool = {
  name: "record_reasons",
  description: "Record which reasons to buy each email used.",
  input_schema: {
    type: "object",
    properties: {
      emails: {
        type: "array",
        items: {
          type: "object",
          properties: {
            campaignId: { type: "string" },
            reasonIds: { type: "array", items: { type: "integer" }, description: "Ids of the reasons this email clearly uses as a reason to buy. Empty if none." },
            why: { type: "string", description: "A few words: what in the email shows it." },
          },
          required: ["campaignId", "reasonIds"],
        },
      },
    },
    required: ["emails"],
  },
};

let reading: Promise<void> | null = null;
let lastReadError: string | null = null;

/** Read every sent email not yet read against the current list. One run at
 *  a time; safe to call often (returns the run in progress). */
export function kickReasonReader(): Promise<void> {
  reading ??= readPending()
    .then(() => { lastReadError = null; })
    .catch(err => {
      lastReadError = err instanceof Error ? err.message : String(err);
      console.error("[reasons-to-buy] reading emails failed:", lastReadError);
    })
    .finally(() => { reading = null; });
  return reading;
}

async function readPending(): Promise<void> {
  if (!isClaudeConfigured()) throw new Error("AI isn't configured on this server");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  for (let round = 0; round < 100; round++) {
    const reasons = await listReasons();
    if (!reasons.length) return;
    const signature = reasonsSignature(reasons);
    const sent = await sentCampaigns(today);
    if (!sent?.length) return;
    const done = await db.select({ campaignId: marketingCampaignReasonsReadTable.campaignId, signature: marketingCampaignReasonsReadTable.signature, bodyText: marketingCampaignReasonsReadTable.bodyText })
      .from(marketingCampaignReasonsReadTable)
      .where(inArray(marketingCampaignReasonsReadTable.campaignId, sent.map(c => c.id)));
    const doneById = new Map(done.map(d => [d.campaignId, d]));
    // Newest first: what's coming up is planned from recent history.
    const todo = sent.filter(c => doneById.get(c.id)?.signature !== signature)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, BATCH);
    if (!todo.length) return;

    const items: Array<{ c: KlaviyoCalendarEmail; body: string }> = [];
    for (const c of todo) {
      let body = doneById.get(c.id)?.bodyText ?? null;
      if (body == null) {
        try { body = emailText(await klaviyoCampaignHtml(c.id)); } catch { body = ""; }
      }
      items.push({ c, body });
    }

    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 2000,
      system: [
        "You read marketing emails from The Calzone Kitchen, a UK food business, and record which REASONS TO BUY each email uses.",
        "A reason to buy is the hook that gives the customer a reason to order now (an offer, credit, a new product, a deadline…). Only count a reason when the email clearly uses it as a reason to buy — a passing mention in a footer doesn't count. An email may use none, one or several.",
        "Use the record_reasons tool only, with one entry per email given.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: [
          "Reasons to buy:",
          ...reasons.map(r => `- id ${r.id}: ${r.name}${r.description ? ` — ${r.description}` : ""}`),
          "",
          "Emails:",
          ...items.map(({ c, body }) => [
            `### campaignId ${c.id} (sent ${c.date})`,
            `Name: ${c.name}`,
            `Subject: ${c.subject ?? ""}`,
            `Preview: ${c.previewText ?? ""}`,
            `Body: ${body ? body.slice(0, 1800) : "(not available)"}`,
          ].join("\n")),
        ].join("\n"),
      }],
      tools: [READ_TOOL],
      tool_choice: { type: "tool", name: "record_reasons" },
    });
    const tool = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const answers = ((tool?.input ?? {}) as { emails?: Array<{ campaignId?: string; reasonIds?: number[]; why?: string }> }).emails ?? [];
    const valid = new Set(reasons.map(r => r.id));
    const byId = new Map(answers.map(a => [String(a.campaignId), a]));

    await db.transaction(async tx => {
      for (const { c, body } of items) {
        const a = byId.get(c.id);
        // An email Claude skipped is left unread, to try again next round.
        if (!a) continue;
        await tx.delete(marketingCampaignReasonMatchesTable).where(eq(marketingCampaignReasonMatchesTable.campaignId, c.id));
        const ids = [...new Set((a.reasonIds ?? []).filter(id => valid.has(id)))];
        if (ids.length) {
          await tx.insert(marketingCampaignReasonMatchesTable)
            .values(ids.map(reasonId => ({ campaignId: c.id, reasonId, why: a.why?.slice(0, 300) ?? null })));
        }
        await tx.insert(marketingCampaignReasonsReadTable)
          .values({ campaignId: c.id, signature, bodyText: body, readAt: new Date() })
          .onConflictDoUpdate({ target: marketingCampaignReasonsReadTable.campaignId, set: { signature, bodyText: body, readAt: new Date() } });
      }
    });
    if (!byId.size) return; // Claude answered nothing: stop rather than loop.
  }
}

// ── The report ───────────────────────────────────────────────────────────

export interface UseSales {
  /** Shopify sales a day while it ran, and in the 4 weeks before. */
  perDayDuring: number;
  perDayBefore: number;
  /** % change; null when there were no sales before. */
  changePct: number | null;
}

export interface ReasonsReport {
  connected: boolean;
  reasons: Array<ReasonSummary & { lastUseSales: UseSales | null }>;
  /** Sent emails not yet read against the current list. */
  unread: number;
  reading: boolean;
  error: string | null;
}

const londonDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

async function salesAround(from: string, to: string): Promise<UseSales | null> {
  try {
    const beforeFrom = addDays(from, -BEFORE_DAYS);
    const beforeTo = addDays(from, -1);
    const [during, before] = await Promise.all([getCachedOrdersLondonDays(from, to), getCachedOrdersLondonDays(beforeFrom, beforeTo)]);
    const perDayDuring = Math.round((newVsReturningTotals(during).revenue / londonDays(from, to)) * 100) / 100;
    const perDayBefore = Math.round((newVsReturningTotals(before).revenue / BEFORE_DAYS) * 100) / 100;
    return {
      perDayDuring, perDayBefore,
      changePct: perDayBefore > 0 ? Math.round(((perDayDuring - perDayBefore) / perDayBefore) * 1000) / 10 : null,
    };
  } catch {
    return null;
  }
}

export async function reasonsReport(today: string): Promise<ReasonsReport> {
  const reasons = await listReasons();
  const sent = await sentCampaigns(today);
  if (!sent) return { connected: false, reasons: [], unread: 0, reading: false, error: null };
  const signature = reasonsSignature(reasons);
  const ids = sent.map(c => c.id);
  const [matches, read, results] = await Promise.all([
    ids.length && reasons.length
      ? db.select().from(marketingCampaignReasonMatchesTable).where(inArray(marketingCampaignReasonMatchesTable.campaignId, ids))
      : Promise.resolve([] as Array<typeof marketingCampaignReasonMatchesTable.$inferSelect>),
    ids.length
      ? db.select({ campaignId: marketingCampaignReasonsReadTable.campaignId }).from(marketingCampaignReasonsReadTable)
        .where(and(inArray(marketingCampaignReasonsReadTable.campaignId, ids), eq(marketingCampaignReasonsReadTable.signature, signature)))
      : Promise.resolve([]),
    klaviyoCampaignResults(),
  ]);
  const resultById = new Map(results.results.map(r => [r.campaignId, r]));
  const campaignById = new Map(sent.map(c => [c.id, c]));
  const emailsByReason = new Map<number, ReasonEmail[]>();
  for (const m of matches) {
    const c = campaignById.get(m.campaignId);
    if (!c) continue;
    const r = resultById.get(c.id);
    const list = emailsByReason.get(m.reasonId) ?? [];
    list.push({
      campaignId: c.id, date: c.date, subject: c.subject, name: c.name,
      recipients: r?.recipients ?? 0, orders: r?.orders ?? 0, revenue: r?.revenue ?? 0,
    });
    emailsByReason.set(m.reasonId, list);
  }
  const summaries = summariseReasons(reasons, emailsByReason, today);
  const withSales = await Promise.all(summaries.map(async s => ({
    ...s,
    lastUseSales: s.lastUse ? await salesAround(s.lastUse.from, s.lastUse.to) : null,
  })));
  const unread = reasons.length ? Math.max(0, sent.length - read.length) : 0;
  if (unread > 0 && isClaudeConfigured()) void kickReasonReader();
  return { connected: true, reasons: withSales, unread, reading: reading != null, error: lastReadError };
}

// ── Editing the list ──────────────────────────────────────────────────────

export async function addReason(input: { name: string; description: string | null }, userId: number | null): Promise<number> {
  const [last] = await db.select({ sortOrder: marketingReasonsToBuyTable.sortOrder }).from(marketingReasonsToBuyTable)
    .where(isNull(marketingReasonsToBuyTable.deletedAt)).orderBy(desc(marketingReasonsToBuyTable.sortOrder)).limit(1);
  const [row] = await db.insert(marketingReasonsToBuyTable)
    .values({ name: input.name, description: input.description, sortOrder: (last?.sortOrder ?? 0) + 1, createdBy: userId })
    .returning({ id: marketingReasonsToBuyTable.id });
  void kickReasonReader();
  return row.id;
}

export async function updateReason(id: number, input: { name?: string; description?: string | null }): Promise<boolean> {
  const rows = await db.update(marketingReasonsToBuyTable)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(marketingReasonsToBuyTable.id, id), isNull(marketingReasonsToBuyTable.deletedAt)))
    .returning({ id: marketingReasonsToBuyTable.id });
  if (rows.length) void kickReasonReader();
  return rows.length > 0;
}

/** Soft delete: its matches stay but no longer show. */
export async function removeReason(id: number): Promise<boolean> {
  const rows = await db.update(marketingReasonsToBuyTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(marketingReasonsToBuyTable.id, id), isNull(marketingReasonsToBuyTable.deletedAt)))
    .returning({ id: marketingReasonsToBuyTable.id });
  return rows.length > 0;
}
