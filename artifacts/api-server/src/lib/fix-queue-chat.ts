/**
 * Talk to Claude about a Fix queue card, live (Graeme, 20 Nov 2026). Claude
 * starts from the card's briefing (lib/fix-queue-chat-rules.ts) and can look
 * things up with AI Jane's read-only data tools and the app guide. It never
 * changes anything: an agreed fix goes to the hourly reviewer through the
 * card's existing "Send and fix it this way".
 */
import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { db, andonCommentsTable, andonIssuesTable, issueTriageEventsTable, issueTriageTable, reportChatsTable } from "@workspace/db";
import { getClaudeClient, CLAUDE_MODELS } from "./ai/claude";
import { aiMaxTokens, responseText, toolUses, wasRefused } from "./ai/claude-calls";
import { searchAppGuide } from "./ai/app-guide";
import { JANE_DATA_GUIDE, JANE_DATA_TOOL_NAMES, type JaneAccess } from "./ai/jane-data-access";
import { executeJaneDataTool, janeDataTools } from "./ai/jane-data-tools";
import { londonDateString } from "./london-time";
import { chatBriefing, SUMMARY_REQUEST, trimHistory } from "./fix-queue-chat-rules";

export type ChatTurn = { role: "user" | "assistant"; text: string };

const PROMPT = `You are Claude, helping Graeme (founder of The Calzone Kitchen) work out a report in the Fix queue of the Production Planner app, live, while he's on the page. Today is {{TODAY}} (London).

How to help:
- Find out what actually happened. Look things up with the data tools before answering a question about what the app recorded — times, names, counts. Quote what you found (who, when, how many), briefly.
- Say plainly whether it looks like a bug, a person, or something else, and how sure you are. If the data can't settle it, say what would.
- You can't see the code, the server logs or Planday shift times. When the answer depends on those, say so: the hourly reviewer (Claude Code, which has the code and logs) can check when Graeme sends it the instruction.
- Help him decide the fix: ask the one question that matters if something's unclear (who it applies to, when it shows, can it be dismissed). Never claim you've changed or built anything.
- Plain English, short: the answer first, then the evidence in a sentence or two. Bold only the key fact. No headings.

The card you're talking about:

{{BRIEFING}}

${JANE_DATA_GUIDE}`;

const GUIDE_TOOL: Anthropic.Tool = {
  name: "search_app_guide",
  description: "Search the guide to what the app can do and where (pages, buttons, who can use them).",
  input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};

async function briefingFor(issueId: number): Promise<string | null> {
  const [issue] = await db.select().from(andonIssuesTable).where(eq(andonIssuesTable.id, issueId));
  if (!issue) return null;
  const [triage] = await db.select().from(issueTriageTable).where(eq(issueTriageTable.andonIssueId, issueId));
  const comments = await db.select().from(andonCommentsTable).where(eq(andonCommentsTable.andonId, issueId)).orderBy(asc(andonCommentsTable.createdAt));
  const events = await db.select().from(issueTriageEventsTable).where(eq(issueTriageEventsTable.andonIssueId, issueId)).orderBy(asc(issueTriageEventsTable.createdAt));
  const [jane] = await db.select({ transcript: reportChatsTable.transcript }).from(reportChatsTable).where(eq(reportChatsTable.andonIssueId, issueId));
  return chatBriefing({
    report: { id: issue.id, createdAt: issue.createdAt, reporterName: issue.reportedByName, area: issue.area, station: issue.station, description: issue.description },
    triage: triage ? {
      lane: triage.lane, status: triage.status, verdictSummary: triage.verdictSummary, explanation: triage.explanation,
      proposedFix: triage.proposedFix, objective: triage.objective, blastRadius: triage.blastRadius, confidence: triage.confidence,
      behaviourChange: triage.behaviourChange, questionForGraeme: triage.questionForGraeme, suggestedReply: triage.suggestedReply,
    } : null,
    comments: comments.map(c => ({ author: c.userName, text: c.comment, at: c.createdAt })),
    events: events.map(e => ({ event: e.event, actor: e.actor, note: e.note, at: e.createdAt })),
    janeChat: jane?.transcript ?? null,
  });
}

/** Claude's next answer, or the chat as a fix instruction (summarise). */
export async function fixQueueChat(issueId: number, history: ChatTurn[], access: JaneAccess, summarise: boolean): Promise<{ text: string } | null> {
  const briefing = await briefingFor(issueId);
  if (!briefing) return null;
  const system = PROMPT.replace("{{TODAY}}", londonDateString()).replace("{{BRIEFING}}", briefing);
  const turns = trimHistory(history);
  const messages: Anthropic.MessageParam[] = turns.map(t => ({ role: t.role, content: t.text }));
  if (summarise) messages.push({ role: "user", content: SUMMARY_REQUEST });
  const tools = summarise ? [] : [...janeDataTools(access), GUIDE_TOOL];
  for (let round = 0; round < 10; round++) {
    const response = await getClaudeClient().messages.create({
      // Thinking counts against max_tokens on the 5.5 models: room for it on
      // top of a 4,000-token answer.
      model: CLAUDE_MODELS.opus, max_tokens: aiMaxTokens(4000, "medium"), system,
      output_config: { effort: "medium" },
      ...(tools.length ? { tools, tool_choice: { type: "auto" as const } } : {}),
      messages,
    });
    if (wasRefused(response)) return { text: "I can't help with that one." };
    const uses = toolUses(response);
    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      return { text: responseText(response) || "I couldn't find an answer to that — try asking it another way." };
    }
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      if (JANE_DATA_TOOL_NAMES.has(use.name)) {
        const r = await executeJaneDataTool(use.name, use.input, access);
        results.push({ type: "tool_result", tool_use_id: use.id, content: r.content, is_error: r.isError ? true : undefined });
      } else if (use.name === GUIDE_TOOL.name) {
        const q = String((use.input as { query?: unknown }).query ?? "");
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(searchAppGuide(q)) });
      } else {
        results.push({ type: "tool_result", tool_use_id: use.id, content: `Unknown tool: ${use.name}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "That took too many lookups to answer in one go — try narrowing the question." };
}
