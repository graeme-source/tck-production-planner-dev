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

export const CLAUDE_MODELS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];
