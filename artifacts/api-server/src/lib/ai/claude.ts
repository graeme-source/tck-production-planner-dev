import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env["ANTHROPIC_API_KEY"];

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to the api-server .env file.");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function isClaudeConfigured(): boolean {
  return Boolean(apiKey);
}

/**
 * The only place model IDs live. Moved to the Claude 5.5 models on 20 Nov
 * 2026 (Graeme approved): Sonnet and Opus 5.5 reject a forced tool_choice and
 * always think, Haiku 5.5 thinks by default; see claude-calls.ts for the
 * shared rules every call site follows.
 */
export const CLAUDE_MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];
