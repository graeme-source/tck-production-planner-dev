/**
 * Reads an uploaded old contract with Claude (Graeme, 2026-09-25).
 *
 * Same pattern as the ingredient label-photo reader (routes/ingredient-
 * scrape.ts): the shared client and model constants from lib/ai/claude.ts,
 * a tool call so the answer comes back as typed JSON (asked for in the
 * prompt and strict, since Sonnet 5.5 can't be forced to call it), and the pure
 * half (lib/contract-extraction.ts) validating and normalising what comes
 * back. PDFs go in as a document block, photos as an image block.
 *
 * Sonnet rather than the label reader's Haiku: a contract is several pages
 * of dense legal text, a paper copy may be photographed at an angle, and a
 * misread rate of pay is expensive — the read happens once per document and
 * the result is kept on the row.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { aiMaxTokens, callToolInstruction, pickToolUse, strictTool, toolChoiceFor } from "../lib/ai/claude-calls";
import {
  CONTRACT_EXTRACTION_PROMPT, CONTRACT_EXTRACTION_TOOL, normaliseContractExtraction, type ContractExtraction,
} from "../lib/contract-extraction";
import { claudeCanRead } from "../lib/uploaded-contract-access";

export type ReadContractResult =
  | { ok: true; extraction: ContractExtraction; model: string }
  | { ok: false; status: number; error: string };

export async function readContractDocument(file: { mime: string; data: Buffer }, personName: string | null): Promise<ReadContractResult> {
  if (!isClaudeConfigured()) {
    return { ok: false, status: 503, error: "Reading contracts needs the Anthropic API key, which isn't set on this server. Type the details in instead." };
  }
  const readable = claudeCanRead(file.mime, file.data.length);
  if (!readable.ok) return { ok: false, status: 400, error: readable.reason };

  const b64 = file.data.toString("base64");
  const docBlock: Anthropic.ContentBlockParam = file.mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: file.mime as "image/jpeg" | "image/png" | "image/webp", data: b64 } };

  try {
    // Medium effort: a misread rate of pay is expensive (see above).
    const response = await getClaudeClient().messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: aiMaxTokens(1500, "medium"),
      output_config: { effort: "medium" },
      system: callToolInstruction(CONTRACT_EXTRACTION_TOOL.name),
      tool_choice: toolChoiceFor(CLAUDE_MODELS.sonnet, CONTRACT_EXTRACTION_TOOL.name),
      tools: [strictTool(CONTRACT_EXTRACTION_TOOL as unknown as Anthropic.Tool)],
      messages: [{ role: "user", content: [docBlock, { type: "text", text: CONTRACT_EXTRACTION_PROMPT }] }],
    });
    // No call (text reply or refusal) → "type the details in", as before.
    const toolUse = pickToolUse(response, CONTRACT_EXTRACTION_TOOL.name);
    if (!toolUse) throw new Error("Claude did not return the contract fields");
    return { ok: true, extraction: normaliseContractExtraction(toolUse.input, personName), model: CLAUDE_MODELS.sonnet };
  } catch (err) {
    console.error("[contract-reader] extraction failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      status: 502,
      error: "Couldn't read this contract automatically just now — type the details in, or try again in a minute.",
    };
  }
}
