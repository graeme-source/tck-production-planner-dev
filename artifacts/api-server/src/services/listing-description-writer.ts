/**
 * Drafts a recipe's Shopify listing description with Claude (Graeme, 30 Oct
 * 2026). Same pattern as the meeting-notes reader: the shared client and
 * model constants (lib/ai/claude.ts), a tool call (asked for in the prompt)
 * so the answer is one typed text field, and the pure half (lib/listing-description-ai.ts)
 * checking it. Opus, because it's customer-facing writing and runs once per
 * recipe. Nothing is saved here — the draft goes back to the screen, where
 * Graeme reads and edits it (the box then autosaves it).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { aiMaxTokens, pickToolUse, strictTool, toolChoiceFor, withToolInstruction } from "../lib/ai/claude-calls";
import {
  LISTING_TOOL, listingSystemPrompt, listingUserMessage, parseListingDraft, unsupportedClaims, type ListingRecipeData,
} from "../lib/listing-description-ai";

export type ListingDraftResult =
  | { ok: true; text: string; cautions: string[]; model: string }
  | { ok: false; status: number; error: string };

export async function draftListingDescription(recipe: ListingRecipeData): Promise<ListingDraftResult> {
  if (!isClaudeConfigured()) {
    return { ok: false, status: 503, error: "Drafting with AI needs the Anthropic API key, which isn't set on this server. Type the description in instead." };
  }
  try {
    // Opus 5.5 can't be forced to call the tool: the prompt asks and the tool
    // is strict. Effort set explicitly to medium (Opus 5.5's own default; in
    // Anthropic's testing it beats Opus 5 at high on writing like this), with
    // room for thinking on top of the 1,200 the description had.
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.opus,
      max_tokens: aiMaxTokens(1200, "medium"),
      output_config: { effort: "medium" },
      system: withToolInstruction(listingSystemPrompt(), LISTING_TOOL.name),
      tool_choice: toolChoiceFor(CLAUDE_MODELS.opus, LISTING_TOOL.name),
      tools: [strictTool(LISTING_TOOL as unknown as Anthropic.Tool)],
      messages: [{ role: "user", content: listingUserMessage(recipe) }],
    });
    // No call (text reply or refusal) → "try again", nothing changed, as before.
    const toolUse = pickToolUse(response, LISTING_TOOL.name);
    if (!toolUse) throw new Error("no tool answer");
    const parsed = parseListingDraft(toolUse.input);
    if (!parsed.ok) return { ok: false, status: 422, error: `${parsed.error} Try again, or write it yourself.` };
    return { ok: true, text: parsed.text, cautions: unsupportedClaims(parsed.text, recipe), model: CLAUDE_MODELS.opus };
  } catch (err) {
    console.error("[listing-description-writer] draft failed:", err instanceof Error ? err.message : err);
    return { ok: false, status: 502, error: "Couldn't draft it with AI just now — try again in a minute. Nothing was changed." };
  }
}
