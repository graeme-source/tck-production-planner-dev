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
import { aiMaxTokens, pickToolUse, strictTool, toolChoiceFor, withToolInstruction } from "./ai/claude-calls";
import { klaviyoCampaignHtml, klaviyoCampaignResults } from "./klaviyo-campaign-calendar";
import { savedSentCampaigns, type SentCampaign } from "./klaviyo-sent-mirror";
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

/** Sent emails of the last year, from our saved copy (topped up from
 *  Klaviyo in the background) — not a year's fetch from Klaviyo each time. */
function sentCampaigns(today: string): Promise<SentCampaign[] | null> {
  return savedSentCampaigns(today, LOOKBACK_DAYS);
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

// The second look (Graeme, 18 Nov 2026: "you've got credit" picked up a
// free-pack email on a re-read). Every match the first pass proposes is
// checked again on its own, against the reason's own description, and only
// kept on a clear yes.
const CHECK_TOOL: Anthropic.Tool = {
  name: "check_matches",
  description: "Give a verdict on each proposed match.",
  input_schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            campaignId: { type: "string" },
            reasonId: { type: "integer" },
            yes: { type: "boolean", description: "True only if the email is clearly built around exactly this reason." },
            why: { type: "string", description: "A few words." },
          },
          required: ["campaignId", "reasonId", "yes"],
        },
      },
    },
    required: ["verdicts"],
  },
};

const CHECK_RULES = [
  "You check proposed matches between marketing emails from The Calzone Kitchen and their REASONS TO BUY. Someone else proposed each match; your job is to catch the wrong ones.",
  "A wrong match is far worse than a missed one. Say yes ONLY when the email's main hook is exactly this reason, as its description defines it.",
  "- Say no when the email's hook is a different thing that merely resembles the reason, even if the same words like \"expiring\", \"unclaimed\", \"last chance\" or \"free\" appear. Examples: a free pack (something added to an order) is not credit (money on the customer's account); a recipe leaving the menu is not a clearance sale; a deadline alone is not any particular reason.",
  "- Say no unless the email's own words name the reason's specific thing.",
  "- When in doubt, say no.",
  "Use the check_matches tool only, with one verdict per proposed match.",
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
    const batches: SentCampaign[][] = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    const answered = await Promise.all(batches.map(b => readBatch(b, reasons, signature, doneById)));
    if (!answered.some(Boolean)) return; // Claude answered nothing: stop rather than loop.
  }
}

export interface BatchItem { c: SentCampaign; body: string }

/** What an email is shown as: subject, preview and the top of its body. */
function emailForAi(c: SentCampaign, body: string): string[] {
  return [
    `### campaignId ${c.id} (sent ${c.date})`,
    `Subject: ${c.subject ?? ""}`,
    `Preview: ${c.previewText ?? ""}`,
    `Body: ${body ? body.slice(0, BODY_CHARS) : "(not available)"}`,
  ];
}

const reasonLine = (r: ReasonDef) => `- id ${r.id}: ${r.name}${r.description ? ` — what counts: ${r.description}` : ""}`;

/**
 * Judge a batch of emails against the reasons — no saving. First pass:
 * which reasons each email uses, quoting its own words (a quote that isn't
 * really in the email is dropped). Second pass: each proposed match is
 * checked again on its own and kept only on a clear yes. (Both ran at
 * temperature 0 until 20 Nov 2026; Claude Sonnet 5.5 rejects any non-default
 * temperature, so consistency now rests on the strict rules, the quote check
 * and the second pass, at medium effort.) Returns a map for every email
 * Claude answered (an empty map = no reasons); emails missing from it
 * weren't answered — or Claude declined — and stay unread.
 */
export async function judgeBatch(items: BatchItem[], reasons: ReasonDef[]): Promise<Map<string, Map<number, string>>> {
  const client = getClaudeClient();
  const response = await client.messages.create({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: aiMaxTokens(2000, "medium"),
    output_config: { effort: "medium" },
    system: withToolInstruction(READ_RULES, READ_TOOL.name),
    messages: [{
      role: "user",
      content: [
        "Reasons to buy:", ...reasons.map(reasonLine), "",
        "Emails:", ...items.map(({ c, body }) => emailForAi(c, body).join("\n")),
      ].join("\n"),
    }],
    tools: [strictTool(READ_TOOL)],
    tool_choice: toolChoiceFor(CLAUDE_MODELS.sonnet, READ_TOOL.name),
  });
  const tool = pickToolUse(response, READ_TOOL.name);
  type Answer = { campaignId?: string; matches?: Array<{ reasonId?: number; evidence?: string }> };
  const answers = ((tool?.input ?? {}) as { emails?: Answer[] }).emails ?? [];
  const reasonById = new Map(reasons.map(r => [r.id, r]));
  const byId = new Map(answers.map(a => [String(a.campaignId), a]));

  const out = new Map<string, Map<number, string>>();
  const proposed: Array<{ item: BatchItem; reasonId: number; evidence: string }> = [];
  for (const item of items) {
    const a = byId.get(item.c.id);
    if (!a) continue;
    out.set(item.c.id, new Map());
    // Only matches whose quoted words really are in what Claude was shown.
    const words = [item.c.subject ?? "", item.c.previewText ?? "", item.body.slice(0, BODY_CHARS)].join("\n");
    const seen = new Set<number>();
    for (const m of a.matches ?? []) {
      if (typeof m.reasonId !== "number" || !reasonById.has(m.reasonId) || seen.has(m.reasonId)) continue;
      if (!evidenceFound(m.evidence, words)) continue;
      seen.add(m.reasonId);
      proposed.push({ item, reasonId: m.reasonId, evidence: (m.evidence ?? "").trim().slice(0, 300) });
    }
  }
  if (!proposed.length) return out;

  const check = await client.messages.create({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: aiMaxTokens(1500, "medium"),
    output_config: { effort: "medium" },
    system: withToolInstruction(CHECK_RULES, CHECK_TOOL.name),
    messages: [{
      role: "user",
      content: proposed.map((p, i) => {
        const r = reasonById.get(p.reasonId)!;
        return [
          `## Proposed match ${i + 1}: campaignId ${p.item.c.id} → reasonId ${r.id}`,
          `Reason: ${r.name}${r.description ? ` — what counts: ${r.description}` : ""}`,
          `Words quoted as showing it: "${p.evidence}"`,
          ...emailForAi(p.item.c, p.item.body),
        ].join("\n");
      }).join("\n\n"),
    }],
    tools: [strictTool(CHECK_TOOL)],
    tool_choice: toolChoiceFor(CLAUDE_MODELS.sonnet, CHECK_TOOL.name),
  });
  const checkTool = pickToolUse(check, CHECK_TOOL.name);
  // The check can no longer be forced: if it gave no verdicts at all (a text
  // reply or a refusal), count the whole batch as unanswered so it's read
  // again later, rather than saving these emails as using no reasons.
  if (!checkTool) return new Map();
  const verdicts = ((checkTool?.input ?? {}) as { verdicts?: Array<{ campaignId?: string; reasonId?: number; yes?: boolean }> }).verdicts ?? [];
  const yes = new Set(verdicts.filter(v => v.yes === true).map(v => `${v.campaignId}|${v.reasonId}`));
  // No verdict = not confirmed = not kept.
  for (const p of proposed) {
    if (yes.has(`${p.item.c.id}|${p.reasonId}`)) out.get(p.item.c.id)!.set(p.reasonId, p.evidence);
  }
  return out;
}

/** Read one batch and store it. True when Claude answered for any email. */
async function readBatch(
  todo: SentCampaign[], reasons: ReasonDef[], signature: string,
  doneById: Map<string, { bodyText: string | null }>,
): Promise<boolean> {
  const items: BatchItem[] = [];
  for (const c of todo) {
    let body = doneById.get(c.id)?.bodyText ?? null;
    if (body == null) {
      try { body = emailText(await klaviyoCampaignHtml(c.id)); } catch { body = ""; }
    }
    items.push({ c, body });
  }
  const judged = await judgeBatch(items, reasons);

  await db.transaction(async tx => {
    for (const { c, body } of items) {
      const kept = judged.get(c.id);
      // An email Claude skipped is left unread, to try again next round.
      if (!kept) continue;
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
  return judged.size > 0;
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

export async function addReason(input: { name: string; description: string | null } & ReasonGuide, userId: number | null): Promise<number> {
  const [last] = await db.select({ sortOrder: marketingReasonsToBuyTable.sortOrder }).from(marketingReasonsToBuyTable)
    .where(isNull(marketingReasonsToBuyTable.deletedAt)).orderBy(desc(marketingReasonsToBuyTable.sortOrder)).limit(1);
  const [row] = await db.insert(marketingReasonsToBuyTable)
    .values({
      name: input.name, description: input.description,
      emailsPerUse: input.emailsPerUse, daysPerUse: input.daysPerUse, minGapDays: input.minGapDays, audiences: input.audiences,
      sortOrder: (last?.sortOrder ?? 0) + 1, createdBy: userId,
    })
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
