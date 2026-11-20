/**
 * Claude calls for incident reports (Graeme, 2026-11-19): write the report
 * up from dictation, and draft the email to the supplier. Same pattern as
 * the meeting-notes reader — shared client, one tool call, the pure half
 * (lib/incident-dictation.ts) checks the answer. Both fall back to a plain
 * version without AI, so reporting never depends on the API being up.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { aiMaxTokens, pickToolUse, strictTool, toolChoiceFor, withToolInstruction } from "../lib/ai/claude-calls";
import {
  INCIDENT_DRAFT_TOOL, incidentDraftSystemPrompt, incidentDraftUserMessage, parseIncidentDraft, fallbackIncidentDraft,
  SUPPLIER_EMAIL_TOOL, supplierEmailSystemPrompt, supplierEmailUserMessage, parseSupplierEmail, fallbackSupplierEmail,
  type IncidentDraft, type PickOption, type IngredientOption, type SupplierEmailFacts,
} from "../lib/incident-dictation";

const TIMEOUT_MS = 45_000;

function nowLondon(): string {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * One call that should end in `tool`. Sonnet 5.5 can't be forced to call a
 * tool, so the prompt asks for it and the tool is strict; low effort keeps
 * it inside the timeout. No call (text reply or refusal) throws, and the
 * callers fall back to the plain version, as before.
 */
async function toolAnswer(tool: { name: string }, system: string, user: string, maxTokens: number): Promise<unknown> {
  const response = await getClaudeClient().messages.create({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: aiMaxTokens(maxTokens, "low"),
    output_config: { effort: "low" },
    system: withToolInstruction(system, tool.name),
    tool_choice: toolChoiceFor(CLAUDE_MODELS.sonnet, tool.name),
    tools: [strictTool(tool as unknown as Anthropic.Tool)],
    messages: [{ role: "user", content: user }],
  }, { timeout: TIMEOUT_MS });
  const toolUse = pickToolUse(response, tool.name);
  if (!toolUse) throw new Error("no tool answer");
  return toolUse.input;
}

export async function draftIncidentFromDictation(
  dictation: string,
  suppliers: PickOption[],
  ingredients: IngredientOption[],
): Promise<{ draft: IncidentDraft; usedAi: boolean }> {
  if (!isClaudeConfigured()) return { draft: fallbackIncidentDraft(dictation), usedAi: false };
  try {
    const input = await toolAnswer(
      INCIDENT_DRAFT_TOOL,
      incidentDraftSystemPrompt(nowLondon()),
      incidentDraftUserMessage(dictation, suppliers, ingredients),
      2500,
    );
    return { draft: parseIncidentDraft(input, dictation, suppliers, ingredients), usedAi: true };
  } catch (err) {
    console.error("[incident-ai] draft failed:", err instanceof Error ? err.message : err);
    return { draft: fallbackIncidentDraft(dictation), usedAi: false };
  }
}

export async function draftSupplierEmail(facts: SupplierEmailFacts): Promise<{ subject: string; body: string; usedAi: boolean }> {
  if (isClaudeConfigured()) {
    try {
      const input = await toolAnswer(SUPPLIER_EMAIL_TOOL, supplierEmailSystemPrompt(), supplierEmailUserMessage(facts), 1500);
      const parsed = parseSupplierEmail(input);
      if (parsed) return { ...parsed, usedAi: true };
    } catch (err) {
      console.error("[incident-ai] email draft failed:", err instanceof Error ? err.message : err);
    }
  }
  return { ...fallbackSupplierEmail(facts), usedAi: false };
}
