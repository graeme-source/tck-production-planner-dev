/**
 * Read a food pack label's batch / lot code and use-by from a photo (Haiku,
 * one forced tool call). Shared by traceability (a pack opened in prep) and
 * the accident & incident diary (a label photo on a supplier complaint —
 * Graeme, 27 Nov 2026). Rules and parsing: lib/traceability.ts. Returns null
 * when the AI isn't set up, the image type can't be read, or the call fails —
 * callers then leave the fields for a person to type.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { aiMaxTokens, callToolInstruction, pickToolUse, strictTool, toolChoiceFor } from "../lib/ai/claude-calls";
import { londonDateString } from "../lib/london-time";
import { LOT_LABEL_TOOL, lotLabelPrompt, parseLotLabel } from "../lib/traceability";

export const LABEL_READ_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function readPackLabel(photo: Buffer, mime: string, logTag = "label-read"): Promise<{ batchCode: string | null; useBy: string | null } | null> {
  if (!isClaudeConfigured() || !LABEL_READ_MIMES.has(mime)) return null;
  try {
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: aiMaxTokens(300, "low"),
      output_config: { effort: "low" },
      system: callToolInstruction(LOT_LABEL_TOOL.name),
      tool_choice: toolChoiceFor(CLAUDE_MODELS.haiku, LOT_LABEL_TOOL.name),
      tools: [strictTool(LOT_LABEL_TOOL as unknown as Anthropic.Tool)],
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp", data: photo.toString("base64") } },
          { type: "text", text: lotLabelPrompt(londonDateString()) },
        ],
      }],
    }, { timeout: 30_000 });
    const tool = pickToolUse(response, LOT_LABEL_TOOL.name);
    return tool ? parseLotLabel(tool.input) : null;
  } catch (err) {
    console.error(`[${logTag}] label read failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
