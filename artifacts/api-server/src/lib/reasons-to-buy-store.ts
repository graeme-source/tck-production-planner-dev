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
  addDays, emailText, evidenceFound, isReady, planningOrder, readyFrom, restState, reasonsSignature, summariseReasons,
  AUDIENCES, type AudienceKey, type ReasonDef, type RestState, type ReasonEmail, type ReasonGuide, type ReasonSummary, type ReasonWithGuide,
} from "@workspace/marketing-calendar";
import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "./ai/claude";
import { klaviyoCampaignHtml, klaviyoCampaignResults, klaviyoCampaignsForMatching } from "./klaviyo-campaign-calendar";
import type { KlaviyoCalendarEmail } from "./klaviyo-campaign-map";
import { getCachedOrdersLondonDays } from "./orders-cache";
import { newVsReturningTotals } from "./order-revenue";

/** How far back emails are read: Klaviyo's results cover a year. */
const LOOKBACK_DAYS = 365;
/** Emails read per call to Claude, and calls made at once. */
const BATCH = 12;
const PARALLEL = 3;
/** How much of each email's body is read: the hook is at the top. */
const BODY_CHARS = 1200;
/** The days before a use that its sales are compared with. */
const BEFORE_DAYS = 28;

const AUDIENCE_KEYS = new Set<string>(AUDIENCES.map(a => a.key));

export async function listReasons(): Promise<ReasonWithGuide[]> {
  const rows = await db.select({
    id: marketingReasonsToBuyTable.id, name: marketingReasonsToBuyTable.name, description: marketingReasonsToBuyTable.description,
    emailsPerUse: marketingReasonsToBuyTable.emailsPerUse, daysPerUse: marketingReasonsToBuyTable.daysPerUse,
    minGapDays: marketingReasonsToBuyTable.minGapDays, audiences: marketingReasonsToBuyTable.audiences,
  }).from(marketingReasonsToBuyTable)
    .where(isNull(marketingReasonsToBuyTable.deletedAt))
    .orderBy(asc(marketingReasonsToBuyTable.sortOrder), asc(marketingReasonsToBuyTable.id));
  return rows.map(r => ({ ...r, audiences: (r.audiences ?? []).filter((a): a is AudienceKey => AUDIENCE_KEYS.has(a)) }));
}

async function sentCampaigns(today: string): Promise<KlaviyoCalendarEmail[] | null> {
  const all = await klaviyoCampaignsForMatching(addDays(today, -LOOKBACK_DAYS));
  if (!all) return null;
  return all.filter(c => c.status === "Sent" && c.date <= today);
}

// ── Reading emails against the list ───────────────────────────────────────

const READ_TOOL: Anthropic.Tool = {
  name: "record_reasons",
  description: "Record which reasons to buy each email used, with the email's own words that show it.",
  input_schema: {
    type: "object",
    properties: {
      emails: {
        type: "array",
        items: {
          type: "object",
          properties: {
            campaignId: { type: "string" },
            matches: {
              type: "array",
              description: "The reasons this email is clearly built around. Empty if none — that is the usual answer when unsure.",
              items: {
                type: "object",
                properties: {
                  reasonId: { type: "integer" },
                  evidence: { type: "string", description: "One phrase of 3–12 words copied EXACTLY, character for character, from the email's subject, preview or body, that shows this reason. Never paraphrase or join phrases." },
                },
                required: ["reasonId", "evidence"],
              },
            },
          },
          required: ["campaignId", "matches"],
        },
      },
    },
    required: ["emails"],
  },
};

const READ_RULES = [
  "You read marketing emails from The Calzone Kitchen, a UK food business, and record which REASONS TO BUY each email uses.",
  "Be strict. A wrong match is far worse than a missed one: the team plans emails from this, and a reason wrongly marked as used recently gets skipped.",
  "- Match a reason only when the email is plainly built around THAT reason as described — its subject, preview or main message says it in so many words.",
  "- Judge each reason on its own. A related or similar hook is NOT the same reason: a free pack offer is not credit; a discount is not free delivery; a last-chance deadline on its own is not any particular offer. Never stretch the closest reason on the list to fit an email.",
  "- If the reason's description says what counts, the email must meet it. If the reason's words (e.g. \"credit\") don't appear in the email, it almost certainly isn't that reason.",
  "- A footer, a side banner or a passing mention doesn't count.",
  "- For every match, copy the email's exact words that show it into evidence. If you can't quote words that clearly show it, don't match.",
  "- When unsure, leave it out. Most emails match none or one reason.",
  "Use the record_reasons tool only, with one entry per email given.",
].join("\n");

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
  for (let round = 0; round < 60; round++) {
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
      .slice(0, BATCH * PARALLEL);
    if (!todo.length) return;
    const batches: KlaviyoCalendarEmail[][] = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    const answered = await Promise.all(batches.map(b => readBatch(b, reasons, signature, doneById)));
    if (!answered.some(Boolean)) return; // Claude answered nothing: stop rather than loop.
  }
}

/** Read one batch and store it. True when Claude answered for any email. */
async function readBatch(
  todo: KlaviyoCalendarEmail[], reasons: ReasonDef[], signature: string,
  doneById: Map<string, { bodyText: string | null }>,
): Promise<boolean> {
  const items: Array<{ c: KlaviyoCalendarEmail; body: string }> = [];
  for (const c of todo) {
    let body = doneById.get(c.id)?.bodyText ?? null;
    if (body == null) {
      try { body = emailText(await klaviyoCampaignHtml(c.id)); } catch { body = ""; }
    }
    items.push({ c, body });
  }
  const shown = (body: string) => body.slice(0, BODY_CHARS);

  const response = await getClaudeClient().messages.create({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 2000,
    system: READ_RULES,
    messages: [{
      role: "user",
      content: [
        "Reasons to buy:",
        ...reasons.map(r => `- id ${r.id}: ${r.name}${r.description ? ` — what counts: ${r.description}` : ""}`),
        "",
        "Emails:",
        ...items.map(({ c, body }) => [
          `### campaignId ${c.id} (sent ${c.date})`,
          `Subject: ${c.subject ?? ""}`,
          `Preview: ${c.previewText ?? ""}`,
          `Body: ${body ? shown(body) : "(not available)"}`,
        ].join("\n")),
      ].join("\n"),
    }],
    tools: [READ_TOOL],
    tool_choice: { type: "tool", name: "record_reasons" },
  });
  const tool = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  type Answer = { campaignId?: string; matches?: Array<{ reasonId?: number; evidence?: string }> };
  const answers = ((tool?.input ?? {}) as { emails?: Answer[] }).emails ?? [];
  const valid = new Set(reasons.map(r => r.id));
  const byId = new Map(answers.map(a => [String(a.campaignId), a]));

  await db.transaction(async tx => {
    for (const { c, body } of items) {
      const a = byId.get(c.id);
      // An email Claude skipped is left unread, to try again next round.
      if (!a) continue;
      // Only matches whose quoted words really are in what Claude was shown.
      const words = [c.subject ?? "", c.previewText ?? "", shown(body)].join("\n");
      const kept = new Map<number, string>();
      for (const m of a.matches ?? []) {
        if (typeof m.reasonId !== "number" || !valid.has(m.reasonId) || kept.has(m.reasonId)) continue;
        if (!evidenceFound(m.evidence, words)) continue;
        kept.set(m.reasonId, (m.evidence ?? "").trim().slice(0, 300));
      }
      await tx.delete(marketingCampaignReasonMatchesTable).where(eq(marketingCampaignReasonMatchesTable.campaignId, c.id));
      if (kept.size) {
        await tx.insert(marketingCampaignReasonMatchesTable)
          .values([...kept].map(([reasonId, why]) => ({ campaignId: c.id, reasonId, why })));
      }
      await tx.insert(marketingCampaignReasonsReadTable)
        .values({ campaignId: c.id, signature, bodyText: body, readAt: new Date() })
        .onConflictDoUpdate({ target: marketingCampaignReasonsReadTable.campaignId, set: { signature, bodyText: body, readAt: new Date() } });
    }
  });
  return byId.size > 0;
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
  /** Ready ones first (least recently used on top), then resting ones. */
  reasons: Array<ReasonSummary & {
    lastUseSales: UseSales | null;
    guide: ReasonGuide;
    /** When its shortest gap has passed; null = no gap set or never used. */
    readyFrom: string | null;
    ready: boolean;
    /** Resting (yellow) / due soon, due today (green) / overdue (dark green). */
    rest: RestState | null;
  }>;
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
      evidence: m.why,
      klaviyoUrl: c.klaviyoUrl,
    });
    emailsByReason.set(m.reasonId, list);
  }
  const summaries = summariseReasons(reasons, emailsByReason, today);
  const guideById = new Map(reasons.map(r => [r.id, r]));
  const withSales = planningOrder(await Promise.all(summaries.map(async s => {
    const g = guideById.get(s.reason.id)!;
    const guide: ReasonGuide = { emailsPerUse: g.emailsPerUse, daysPerUse: g.daysPerUse, minGapDays: g.minGapDays, audiences: g.audiences };
    const lastTo = s.lastUse?.to ?? null;
    return {
      ...s,
      lastUseSales: s.lastUse ? await salesAround(s.lastUse.from, s.lastUse.to) : null,
      guide,
      readyFrom: readyFrom(lastTo, g.minGapDays),
      ready: isReady(lastTo, g.minGapDays, today),
      rest: restState(lastTo, g.minGapDays, today),
    };
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

export async function updateReason(id: number, input: { name?: string; description?: string | null } & Partial<ReasonGuide>): Promise<boolean> {
  const rows = await db.update(marketingReasonsToBuyTable)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(marketingReasonsToBuyTable.id, id), isNull(marketingReasonsToBuyTable.deletedAt)))
    .returning({ id: marketingReasonsToBuyTable.id });
  // Only the name and "what counts" change the matching; guidance doesn't.
  if (rows.length && (input.name !== undefined || input.description !== undefined)) void kickReasonReader();
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
