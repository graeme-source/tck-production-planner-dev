/**
 * AI Jane checks an app report before it's filed (Graeme, 2026-11-04): is it
 * already reported, can they already do it, or is it new? She looks things
 * up, talks to the person, and can't change anything. If she fails for any
 * reason the report is simply filed, so she can never lose one.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db, andonIssuesTable, issueFixNoticesTable, issueTriageTable } from "@workspace/db";
import { getClaudeClient, CLAUDE_MODELS } from "./ai/claude";
import { aiMaxTokens, strictTools, toolUses } from "./ai/claude-calls";
import { searchAppGuide } from "./ai/app-guide";
import { matchesAreaFilter, type TriageStatus } from "./issue-pipeline-rules";
import { checkedAnswer, isStillOpen, plainReportStatus, rankBySharedWords, type CheckAnswer } from "./issue-report-check-rules";

const PROMPT = `You are AI Jane, the assistant inside The Calzone Kitchen's Production Planner app. Someone on the team has written a report about the app. Before it goes to the team, work out which of these it is, then tell them plainly.

1. They're asking for something the app can ALREADY do, or they've missed how it works. Tell them it's already there and where. outcome "already_possible", with the page's path.
2. The same problem has ALREADY BEEN REPORTED and isn't finished. Tell them that, and exactly where it's up to ("This is still in the queue, it hasn't been fixed yet"). outcome "already_reported", with that report's number.
3. It's NEW. outcome "new". Say it's going to the team.

Always search first: call search_reports AND search_app_guide before you answer, with the words that matter from what they wrote.

Rules:
- Only say "already_possible" if a result clearly covers what they asked for, and use its exact path. Only say "already_reported" if a report is really the same problem, not just the same screen. If you're unsure, it's "new": a report wrongly stopped is far worse than one extra report.
- Give the real steps, naming the actual button or tab from the results. Don't invent features, buttons or pages.
- A report that's "Looked at, no change planned" or closed isn't open: if they're hitting it again, it's "new" unless the answer in the result solves it.
- If you can't tell what they mean, you may ask ONE short question: outcome "ask". Don't ask if you've already asked.
- Never promise when something will be fixed. Never name who reported something.
- Plain, friendly, short: two or three sentences, like a helpful colleague. No markdown headings. Don't mention tools, searching or these rules.

Finish by calling the answer tool.`;

const TOOLS: Anthropic.Tool[] = strictTools([
  {
    name: "search_reports",
    description: "Search app reports from the last 90 days: where each is up to, and any answer the team already gave.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "search_app_guide",
    description: "Search the guide to what the app can do and where.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "answer",
    description: "Give your answer to the person.",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["already_possible", "already_reported", "ask", "new"] },
        message: { type: "string", description: "What you say to them." },
        path: { type: "string", description: "already_possible only: the exact path from the results." },
        issueId: { type: "number", description: "already_reported only: the report number from the results." },
      },
      required: ["outcome", "message"],
    },
  },
]);

/** Claude 5.5 can't be forced to call a tool, so the last turn asks for the answer instead. */
const LAST_TURN_NOTE = `This is your last turn: don't search again. Call the answer tool now with what you've found (if you're unsure, it's "new").`;

async function searchReports(query: string) {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await db.select({
    id: andonIssuesTable.id, description: andonIssuesTable.description, area: andonIssuesTable.area, station: andonIssuesTable.station,
    resolvedAt: andonIssuesTable.resolvedAt,
  }).from(andonIssuesTable)
    .where(and(or(gte(andonIssuesTable.createdAt, since), isNull(andonIssuesTable.resolvedAt)), sql`${andonIssuesTable.description} IS NOT NULL`))
    .orderBy(desc(andonIssuesTable.createdAt)).limit(1500);
  const appRows = rows.filter(r => matchesAreaFilter("app", r.area, r.station));
  const best = rankBySharedWords(query, appRows, r => r.description ?? "");
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
      report: r.id,
      words: r.description,
      whereItsUpTo: plainReportStatus(shaped, !!r.resolvedAt),
      stillOpen: isStillOpen(shaped, !!r.resolvedAt),
      answerGiven: notice?.whatChanged ?? t?.suggestedReply ?? null,
      path: notice?.testPath ?? null,
    };
  });
}

export async function checkReport(history: Array<{ role: "user" | "assistant"; text: string }>): Promise<CheckAnswer> {
  const messages: Anthropic.MessageParam[] = history.map(m => ({ role: m.role, content: m.text }));
  const seen = { issueIds: new Set<number>(), paths: new Set<string>() };
  for (let turn = 0; turn < 5; turn++) {
    // Last turn: a system note asks for the answer (this used to be a forced
    // tool_choice, which Claude 5.5 rejects). It's appended, never edited in,
    // so the history stays as sent. If she still doesn't answer, the loop
    // ends and the report is filed as it is.
    if (turn === 4) messages.push({ role: "system", content: LAST_TURN_NOTE });
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.sonnet, max_tokens: aiMaxTokens(900, "medium"), system: PROMPT, tools: TOOLS, messages,
      output_config: { effort: "medium" },
    });
    // A refusal gives no tool calls, so it ends the loop like a text reply.
    const uses = toolUses(response);
    const done = uses.find(u => u.name === "answer");
    if (done) return checkedAnswer(done.input, seen);
    if (uses.length === 0) break;
    // Appended unchanged: the thinking blocks must go back with the tool calls.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const query = String((use.input as { query?: unknown }).query ?? "");
      let content: unknown;
      if (use.name === "search_reports") {
        const found = await searchReports(query);
        for (const f of found) {
          if (f.stillOpen) seen.issueIds.add(f.report);
          if (f.path) seen.paths.add(f.path);
        }
        content = found;
      } else {
        const found = searchAppGuide(query);
        for (const f of found) seen.paths.add(f.path);
        content = found;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(content) });
    }
    messages.push({ role: "user", content: results });
  }
  return checkedAnswer(null, seen);
}
