/**
 * AI Jane talks an app report or idea through before it's filed (Graeme,
 * 19 Nov 2026). She asks the few questions Graeme would otherwise have to
 * come back with, then writes a short summary the person checks before it
 * goes. She looks things up and talks; she can't change anything, and
 * nothing is built until Graeme approves it on the Fix queue.
 * Rules and checks: lib/report-chat-rules.ts.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient, CLAUDE_MODELS } from "./ai/claude";
import { aiMaxTokens, strictTools, toolUses } from "./ai/claude-calls";
import { searchAppGuide } from "./ai/app-guide";
import { answersAsBrief, checkedStep, MAX_QUESTIONS, questionsAsked, type ChatKind, type ChatTurn, type JaneStep } from "./report-chat-rules";

const PROMPT = `You are AI Jane, the assistant inside The Calzone Kitchen's Production Planner app. Someone on the team has just written {{WHAT}}. Graeme, the founder, reads every one and decides what gets built. Your job is to ask the few questions Graeme would otherwise have to come back and ask, so the change is built right the first time, while it's fresh in their mind.

Ask ONE short question at a time, with 2 to 4 short answers they can tap. Ask only what matters for THIS report, and only what they haven't already said. The kind of thing Graeme asks:
- Where exactly: which page, station or screen.
- Who it's for: everyone, managers, one station.
- When it shows: every time, once a day, only when something happens.
- Must they do it, or can they swipe it away or skip it?
- For a fault: what they tapped, what they expected to happen, what happened instead, and whether it happens every time.
- What it's for: the problem it solves, if that isn't obvious.

Search the app guide first so your questions use the app's real names for pages and buttons. If what they want already exists, say so in your question ("There's already X on Y. Is it that, or something different?").

Rules:
- At most ${MAX_QUESTIONS} questions in all; fewer is better. If it's already clear, go straight to the summary.
- If they say "not sure" or don't know, don't push: move on.
- Never ask about code, databases or how to build it.
- Never promise it will be built, or when. Never say it's approved.
- Plain, friendly, short. One or two sentences. No markdown.

When you have enough, call brief. The brief is for Graeme: short plain lines, only the ones that apply, in their meaning (don't invent requirements):
What they want: …
Where: …
Who: …
When it shows: …
Must they do it: …
Why: …
Not sure about: …

Every reply is a call to ask or brief.`;

const WHAT: Record<ChatKind, string> = {
  issue: "a report about a problem with the app",
  idea: "an improvement idea that would change the app",
};

const TOOLS: Anthropic.Tool[] = strictTools([
  {
    name: "search_app_guide",
    description: "Search the guide to what the app can already do and where.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "ask",
    description: "Ask them one question.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The question." },
        choices: { type: "array", items: { type: "string" }, description: "2 to 4 short answers they can tap." },
      },
      required: ["message", "choices"],
    },
  },
  {
    name: "brief",
    description: "Finish: the summary for Graeme.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "One sentence to them, e.g. asking them to check it." },
        brief: { type: "string", description: "The summary lines." },
      },
      required: ["brief"],
    },
  },
]);

/**
 * Claude 5.5 can't be forced to call a tool (tool_choice "any" / "tool" is a
 * 400), so the prompt's "Every reply is a call to ask or brief" does that
 * job, and when it's time to finish a system note asks for the brief.
 */
const FINISH_NOTE = "You've asked enough questions. Don't ask another: call brief now with what they've told you.";

/** Their answers as the summary, when Jane can't write one. */
function fallback(history: readonly ChatTurn[]): JaneStep | null {
  const brief = answersAsBrief(history);
  return brief ? { kind: "brief", message: "Here's what you've told me. Change anything that's wrong, then send it.", brief } : null;
}

/** Jane's next question or the summary. null = file it as it is. */
export async function nextStep(kind: ChatKind, history: ChatTurn[], finish: boolean): Promise<JaneStep | null> {
  if (finish) return fallback(history);
  const asked = questionsAsked(history);
  const messages: Anthropic.MessageParam[] = history.map(m => ({ role: m.role, content: m.text }));
  const system = PROMPT.replace("{{WHAT}}", WHAT[kind]);
  let finishNoted = false;
  try {
    for (let turn = 0; turn < 4; turn++) {
      const mustFinish = asked >= MAX_QUESTIONS || turn === 3;
      // Appended once, after the latest user turn, and left in place.
      if (mustFinish && !finishNoted) {
        messages.push({ role: "system", content: FINISH_NOTE });
        finishNoted = true;
      }
      const response = await getClaudeClient().messages.create({
        model: CLAUDE_MODELS.sonnet, max_tokens: aiMaxTokens(900, "medium"), system, tools: TOOLS, messages,
        output_config: { effort: "medium" },
      });
      // A text reply or a refusal gives no calls: the loop ends and their
      // answers are used as the summary, exactly as before.
      const uses = toolUses(response);
      const said = uses.find(u => u.name === "ask" || u.name === "brief");
      if (said) return checkedStep({ name: said.name, input: said.input }, asked) ?? fallback(history);
      const searches = uses.filter(u => u.name === "search_app_guide");
      if (searches.length === 0) break;
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: searches.map(u => ({
          type: "tool_result" as const, tool_use_id: u.id,
          content: JSON.stringify(searchAppGuide(String((u.input as { query?: unknown }).query ?? ""))),
        })),
      });
    }
  } catch (err) {
    console.error("[report-chat] Jane failed, filing with what's been said:", err instanceof Error ? err.message : String(err));
  }
  return fallback(history);
}
