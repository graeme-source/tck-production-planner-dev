/**
 * AI Jane talks a problem through BEFORE it becomes a report (Graeme, 20 Nov
 * 2026: "force people to have the conversation with AI Jane first, to see if
 * she can fix it without it coming to my desk … then build an issue report
 * based on the findings"). She looks things up — reports already in, the app
 * guide, SOPs, the app's own data — and helps them sort it. She can't change
 * anything. When it can't be sorted here, buildReport() turns the chat into
 * the report. Rules: lib/report-live-chat-rules.ts.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db, andonIssuesTable, issueFixNoticesTable, issueTriageTable } from "@workspace/db";
import { getClaudeClient, CLAUDE_MODELS } from "./ai/claude";
import { aiMaxTokens, responseText, strictTools, toolUses, wasRefused } from "./ai/claude-calls";
import { searchAppGuide } from "./ai/app-guide";
import { JANE_DATA_GUIDE, JANE_DATA_TOOL_NAMES, type JaneAccess } from "./ai/jane-data-access";
import { executeJaneDataTool, janeDataTools } from "./ai/jane-data-tools";
import { matchesAreaFilter, type TriageStatus } from "./issue-pipeline-rules";
import { isStillOpen, plainReportStatus, rankBySharedWords } from "./issue-report-check-rules";
import { londonDateString } from "./london-time";
import { draftFromTheirWords, keepKnownPath, keepKnownSops, trimLiveHistory, type LiveTurn, type ReportArea } from "./report-live-chat-rules";

export interface LiveReply {
  message: string;
  /** SOPs worth opening, from her searches only. */
  sops: Array<{ id: number; title: string }>;
  /** An app page worth opening, from the app guide or a report only. */
  path: string | null;
  /** The same problem, already reported and still open. */
  issueId: number | null;
}

const PROMPT = `You are AI Jane, the helpful assistant inside The Calzone Kitchen's Production Planner app. Someone on the team has a problem {{AREA}}. Before anything is reported, your job is to help them sort it out themselves if it can be, so it never needs to reach Graeme (the founder). Today is {{TODAY}} (London).

How to help:
- First understand it. If it isn't clear, ask ONE short question at a time.
- Look things up before you answer: search_reports (has it been reported already, and what was the answer?), search_sops (is there a standard way to do this or fix this?), search_app_guide (can the app already do it, and where?), and the data tools when the answer is in the app's records (what was planned, ticked, made, delivered).
- Then give them something to try: the real steps, the SOP to follow, the button or page to use. Name things exactly as the results do. Never invent features, buttons, pages or SOPs.
- If it's already reported and still open, say so and where it's up to — they don't need to report it again.
- When you've given a fix, ask whether it sorted it.
- If it needs a person to fix it (something broken, a bug in the app, a supplier, a decision only a manager or Graeme can make), say so plainly and tell them to tap "Write my report" — you'll write it up from this chat.
- SAFETY FIRST: if anyone could get hurt or food could be unsafe, tell them to stop, make it safe, tell a manager now, and tap "Write my report" straight away. Don't troubleshoot a safety problem.
- You can't change anything in the app, move stock, or contact anyone. Never claim you have.
- Call an SOP by its title, never its number (the number means nothing on the floor); the app shows it as a button they can open.
- Plain, warm, short: two or three sentences, like a helpful colleague on the floor. No headings, no lists of more than three steps, no mention of tools or searching.

Finish every turn by calling the reply tool.

${JANE_DATA_GUIDE}`;

const BASE_TOOLS: Anthropic.Tool[] = [
  { name: "search_reports", description: "Search reports from the last 90 days in this area: where each is up to and any answer already given.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "search_sops", description: "Search the factory's Standards & SOPs by title and step text. Returns SOP ids and titles.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "search_app_guide", description: "Search the guide to what the app can do and where (pages, buttons).", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
];
const REPLY_TOOL: Anthropic.Tool = {
  name: "reply",
  description: "What you say to them now.",
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string" },
      sopIds: { type: "array", items: { type: "number" }, description: "SOPs from search_sops worth opening (at most 3)." },
      path: { type: "string", description: "An app path from search_app_guide or a report worth opening." },
      issueId: { type: "number", description: "A report from search_reports that is the same problem and still open." },
    },
    required: ["message"],
  },
};
const LAST_TURN_NOTE = "This is your last turn: don't look anything else up. Call the reply tool now with what you have.";

async function searchReports(area: ReportArea, query: string) {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await db.select({
    id: andonIssuesTable.id, description: andonIssuesTable.description, area: andonIssuesTable.area, station: andonIssuesTable.station,
    resolvedAt: andonIssuesTable.resolvedAt,
  }).from(andonIssuesTable)
    .where(and(or(gte(andonIssuesTable.createdAt, since), isNull(andonIssuesTable.resolvedAt)), sql`${andonIssuesTable.description} IS NOT NULL`))
    .orderBy(desc(andonIssuesTable.createdAt)).limit(1500);
  const inArea = rows.filter(r => matchesAreaFilter(area === "system" ? "app" : "factory", r.area, r.station));
  const best = rankBySharedWords(query, inArea, r => r.description ?? "");
  if (best.length === 0) return [];
  const ids = best.map(r => r.id);
  const triage = await db.select().from(issueTriageTable).where(inArray(issueTriageTable.andonIssueId, ids));
  const notices = await db.select({ andonIssueId: issueFixNoticesTable.andonIssueId, whatChanged: issueFixNoticesTable.whatChanged, testPath: issueFixNoticesTable.testPath })
    .from(issueFixNoticesTable).where(inArray(issueFixNoticesTable.andonIssueId, ids));
  return best.map(r => {
    const t = triage.find(x => x.andonIssueId === r.id) ?? null;
    const shaped = t ? { status: t.status as TriageStatus, issueResolvedAt: t.issueResolvedAt } : null;
    const notice = notices.find(n => n.andonIssueId === r.id);
    return {
      report: r.id, words: r.description,
      whereItsUpTo: plainReportStatus(shaped, !!r.resolvedAt),
      stillOpen: isStillOpen(shaped, !!r.resolvedAt),
      answerGiven: notice?.whatChanged ?? t?.suggestedReply ?? null,
      path: notice?.testPath ?? null,
    };
  });
}

async function searchSops(query: string) {
  const rows = await db.execute<{ id: number; title: string; steps: string | null }>(sql`
    SELECT s.id, s.title, string_agg(st.description, ' ' ORDER BY st.position) AS steps
    FROM standards_sops s LEFT JOIN sop_steps st ON st.sop_id = s.id
    GROUP BY s.id, s.title
  `);
  return rankBySharedWords(query, rows.rows, r => `${r.title} ${r.title} ${r.steps ?? ""}`, 6)
    .map(r => ({ sopId: r.id, title: r.title, firstSteps: (r.steps ?? "").slice(0, 300) }));
}

/** Jane's next turn in the chat. */
export async function liveTurn(area: ReportArea, history: LiveTurn[], access: JaneAccess): Promise<LiveReply> {
  const system = PROMPT
    .replace("{{AREA}}", area === "system" ? "with the Production Planner app or an iPad" : "in the factory")
    .replace("{{TODAY}}", londonDateString());
  // Strict only for this chat's own tools: the data tools' filter values are
  // deliberately open-typed, which strict mode rejects.
  const tools = [...strictTools([...BASE_TOOLS, REPLY_TOOL]), ...janeDataTools(access)];
  const messages: Anthropic.MessageParam[] = trimLiveHistory(history).map(t => ({ role: t.role, content: t.text }));
  const seenSops = new Map<number, string>();
  const seenPaths = new Set<string>();
  const openIssues = new Set<number>();
  for (let round = 0; round < 6; round++) {
    if (round === 5) messages.push({ role: "system", content: LAST_TURN_NOTE } as unknown as Anthropic.MessageParam);
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.sonnet, max_tokens: aiMaxTokens(1200, "medium"), system, tools, messages,
      output_config: { effort: "medium" },
    });
    if (wasRefused(response)) return { message: "I can't help with that one — tap \"Write my report\" and it'll go to the team.", sops: [], path: null, issueId: null };
    const uses = toolUses(response);
    const reply = uses.find(u => u.name === "reply");
    if (reply) {
      const r = reply.input as { message?: unknown; sopIds?: unknown; path?: unknown; issueId?: unknown };
      const issueId = Number(r.issueId);
      return {
        message: String(r.message ?? "").trim() || "Tell me a bit more about what's happening?",
        sops: keepKnownSops(r.sopIds, seenSops),
        path: keepKnownPath(r.path, seenPaths),
        issueId: Number.isInteger(issueId) && openIssues.has(issueId) ? issueId : null,
      };
    }
    if (uses.length === 0) {
      const text = responseText(response).trim();
      return { message: text || "Tell me a bit more about what's happening?", sops: [], path: null, issueId: null };
    }
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const query = String((use.input as { query?: unknown }).query ?? "");
      if (use.name === "search_reports") {
        const found = await searchReports(area, query);
        for (const f of found) { if (f.stillOpen) openIssues.add(f.report); if (f.path) seenPaths.add(f.path); }
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(found) });
      } else if (use.name === "search_sops") {
        const found = await searchSops(query);
        for (const f of found) seenSops.set(f.sopId, f.title);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(found) });
      } else if (use.name === "search_app_guide") {
        const found = searchAppGuide(query);
        for (const f of found) seenPaths.add(f.path);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(found) });
      } else if (JANE_DATA_TOOL_NAMES.has(use.name)) {
        const r = await executeJaneDataTool(use.name, use.input, access);
        results.push({ type: "tool_result", tool_use_id: use.id, content: r.content, is_error: r.isError ? true : undefined });
      } else {
        results.push({ type: "tool_result", tool_use_id: use.id, content: `Unknown tool: ${use.name}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { message: "I couldn't get to the bottom of that — tap \"Write my report\" and I'll write it up for the team.", sops: [], path: null, issueId: null };
}

const REPORT_PROMPT = `Write the problem report from this chat between a team member and AI Jane at The Calzone Kitchen. It goes to the person who'll fix it, so make it complete and plain:
- First line: the problem in one sentence.
- Then short lines: where it happened (station, screen, machine), what they saw, what they already tried (including anything Jane suggested and whether it worked), and anything Jane found (an SOP, an earlier report, figures from the app).
- Their words, not Jane's opinions. Name SOPs by title, not number. No headings, no markdown, no greeting. Under 120 words.`;

/** The report, written from the chat; their own words if that fails. */
export async function buildReport(area: ReportArea, history: LiveTurn[]): Promise<string> {
  const transcript = trimLiveHistory(history).map(t => `${t.role === "user" ? "Team member" : "Jane"}: ${t.text}`).join("\n");
  try {
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.sonnet, max_tokens: aiMaxTokens(600, "low"), system: REPORT_PROMPT,
      messages: [{ role: "user", content: `Area: ${area === "system" ? "the app / iPad" : "the factory"}\n\n${transcript}` }],
      output_config: { effort: "low" },
    });
    const text = wasRefused(response) ? "" : responseText(response).trim();
    return text || draftFromTheirWords(history);
  } catch (err) {
    console.warn("[report-live-chat] report draft failed, using their words:", err instanceof Error ? err.message : String(err));
    return draftFromTheirWords(history);
  }
}
