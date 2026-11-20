/**
 * Drafts a meeting's record from its notes with Claude (Graeme, 2026-10-12).
 *
 * Same pattern as the contract reader: the shared client and model constants
 * (lib/ai/claude.ts), a tool call (asked for in the prompt) so the answer
 * comes back as typed JSON, and the pure half (lib/meeting-notes-ai.ts) checking and repairing
 * it. Sonnet, because an employment record is worth reading carefully and
 * it runs once per meeting. Nothing is saved here — the draft goes back to
 * the screen for Graeme to check.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { MeetingNotesDraft } from "@workspace/people-reviews";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { aiMaxTokens, pickToolUse, strictTool, toolChoiceFor, withToolInstruction } from "../lib/ai/claude-calls";
import {
  MEETING_NOTES_TOOL, meetingNotesSystemPrompt, meetingNotesUserMessage, parseMeetingDraft, type PromptContext,
} from "../lib/meeting-notes-ai";

export type DraftResult =
  | { ok: true; draft: MeetingNotesDraft; repaired: string[]; model: string }
  | { ok: false; status: number; error: string };

export async function draftMeetingNotes(
  notes: string,
  ctx: PromptContext,
  classifications: ReadonlyArray<{ id: number; label: string; active: boolean }>,
): Promise<DraftResult> {
  if (!isClaudeConfigured()) {
    return { ok: false, status: 503, error: "Reading meeting notes needs the Anthropic API key, which isn't set on this server. Type the notes in instead." };
  }
  try {
    // Medium effort: an employment record is worth reading carefully.
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: aiMaxTokens(3000, "medium"),
      output_config: { effort: "medium" },
      system: withToolInstruction(meetingNotesSystemPrompt(ctx), MEETING_NOTES_TOOL.name),
      tool_choice: toolChoiceFor(CLAUDE_MODELS.sonnet, MEETING_NOTES_TOOL.name),
      tools: [strictTool(MEETING_NOTES_TOOL as unknown as Anthropic.Tool)],
      messages: [{ role: "user", content: meetingNotesUserMessage(notes) }],
    });
    // No call (text reply or refusal) → "try again", nothing saved, as before.
    const toolUse = pickToolUse(response, MEETING_NOTES_TOOL.name);
    if (!toolUse) throw new Error("no tool answer");
    const parsed = parseMeetingDraft(toolUse.input, classifications);
    if (!parsed.ok) return { ok: false, status: 422, error: `${parsed.error} Try again, or type the notes in yourself.` };
    return { ok: true, draft: parsed.draft, repaired: parsed.repaired, model: CLAUDE_MODELS.sonnet };
  } catch (err) {
    console.error("[meeting-notes-reader] draft failed:", err instanceof Error ? err.message : err);
    return { ok: false, status: 502, error: "Couldn't read the notes with AI just now — try again in a minute. Nothing was saved." };
  }
}
