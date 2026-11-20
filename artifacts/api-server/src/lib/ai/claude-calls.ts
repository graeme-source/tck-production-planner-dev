/**
 * Shared rules for calling the Claude 5.5 models (Graeme approved the move
 * from Haiku 4.5 / Sonnet 4.6 / Opus 5 on 20 Nov 2026). Pure helpers, no
 * network, unit-tested in claude-calls.test.ts.
 *
 * What changed with the 5.5 models, and what each helper is for:
 * - Sonnet 5.5 and Opus 5.5 reject a forced tool_choice ({type:"tool"} or
 *   {type:"any"}) with a 400. Haiku 5.5 still accepts it. toolChoiceFor()
 *   forces only where the model allows it, and otherwise asks for the tool
 *   in the prompt (callToolInstruction) under tool_choice "auto".
 * - "auto" doesn't guarantee a call, so strictTools() turns on strict tool
 *   use where the schema allows it (the arguments then always match the
 *   schema), and pickToolUse() finds the call or returns null — every
 *   caller keeps the graceful fallback it already had for "no tool call".
 * - Thinking is always on (Opus/Sonnet) or on by default (Haiku) and counts
 *   toward max_tokens, so aiMaxTokens() adds room for it on top of the
 *   answer's own allowance.
 * - A safety classifier can decline with stop_reason "refusal" (HTTP 200,
 *   empty or partial content). pickToolUse() and wasRefused() treat that as
 *   "no answer", never as a half-finished one.
 */
import type Anthropic from "@anthropic-ai/sdk";

/** How hard the model thinks. Opus 5.5 and Haiku 5.5 default to medium, Sonnet 5.5 to high: always set it. */
export type AiEffort = "low" | "medium" | "high";

/**
 * Extra max_tokens for thinking, on top of what the answer itself needs.
 * At low the model often skips thinking on simple requests; the room is a
 * ceiling, not a cost — unused tokens aren't billed.
 */
export const THINKING_ROOM: Record<AiEffort, number> = { low: 2_000, medium: 6_000, high: 16_000 };

/**
 * The SDK refuses non-streaming requests whose max_tokens could run past
 * its 10-minute timeout (about 21,000 tokens); the skill guidance keeps
 * non-streaming calls at 16,000 or less. Bigger calls stream.
 */
export const MAX_NON_STREAMING_TOKENS = 16_000;

/** max_tokens for a call: the answer's allowance plus room to think, capped for non-streaming calls. */
export function aiMaxTokens(answerTokens: number, effort: AiEffort, opts: { streaming?: boolean } = {}): number {
  const total = answerTokens + THINKING_ROOM[effort];
  return opts.streaming ? total : Math.min(total, MAX_NON_STREAMING_TOKENS);
}

/**
 * Models that still accept a forced tool_choice. Claude Haiku 5.5 does (and
 * skips thinking when forced, so those calls stay as quick as before);
 * Claude Sonnet 5.5 and Claude Opus 5.5 return a 400. Anything not listed
 * is treated as not accepting it, which is always safe.
 */
const ACCEPTS_FORCED_TOOL_CHOICE: ReadonlySet<string> = new Set(["claude-haiku-5-5"]);

/** The tool_choice to send when a call should end in one particular tool. */
export function toolChoiceFor(model: string, toolName: string): Anthropic.ToolChoice {
  return ACCEPTS_FORCED_TOOL_CHOICE.has(model) ? { type: "tool", name: toolName } : { type: "auto" };
}

/** The line that asks for the tool, now that most models can't be forced to call it. */
export function callToolInstruction(toolName: string): string {
  return `Give your answer by calling the ${toolName} tool exactly once. Don't answer in plain text.`;
}

/** A system prompt with the call-the-tool line added at the end. */
export function withToolInstruction(system: string | undefined, toolName: string): string {
  const line = callToolInstruction(toolName);
  return system && system.trim() ? `${system}\n\n${line}` : line;
}

type ResponseLike = { content: readonly Anthropic.ContentBlock[]; stop_reason: Anthropic.StopReason | null };

/** True when a safety classifier declined the request: content is empty or partial and must not be used. */
export function wasRefused(message: Pick<ResponseLike, "stop_reason">): boolean {
  return message.stop_reason === "refusal";
}

/** The call to the named tool, or null — when the model answered in text, called something else, or was declined. */
export function pickToolUse(message: ResponseLike, toolName: string): Anthropic.ToolUseBlock | null {
  if (wasRefused(message)) return null;
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === toolName) return block;
  }
  return null;
}

/** Every tool call in a response (none when declined). */
export function toolUses(message: ResponseLike): Anthropic.ToolUseBlock[] {
  if (wasRefused(message)) return [];
  return message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
}

/** The response's text, joined; "" when declined or when it only called tools. */
export function responseText(message: ResponseLike): string {
  if (wasRefused(message)) return "";
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");
}

// ── Strict tool use ─────────────────────────────────────────────────────────
// The API's published limits for strict schemas (structured outputs docs,
// "Schema complexity limits"), counted across every strict tool in a request.
export const STRICT_LIMITS = { tools: 20, optionalParams: 24, unionParams: 16 } as const;

const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
/** Keywords strict mode rejects; they move into the description so the model still sees them. */
const UNSUPPORTED_KEYWORDS = [
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "maxItems", "uniqueItems", "minProperties", "maxProperties",
] as const;
/** Features strict mode can't express at all: a schema using one stays non-strict. */
const BLOCKING_KEYWORDS = ["not", "$ref", "patternProperties", "if", "then", "else", "dependentSchemas"] as const;

type Schema = Record<string, unknown>;
interface Tally { optional: number; unions: number; blocked: boolean }

function isSchema(v: unknown): v is Schema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strictSchema(schema: Schema, tally: Tally): Schema {
  const out: Schema = { ...schema };
  for (const k of BLOCKING_KEYWORDS) if (k in out) tally.blocked = true;

  if (Array.isArray(out.oneOf)) {
    out.anyOf = out.oneOf;
    delete out.oneOf;
  }
  // anyOf beside type/properties in the same object isn't supported.
  if (Array.isArray(out.anyOf) && ("type" in out || "properties" in out)) tally.blocked = true;
  if (Array.isArray(out.anyOf) || Array.isArray(out.type)) tally.unions++;

  const moved: string[] = [];
  for (const k of UNSUPPORTED_KEYWORDS) {
    if (k in out) {
      moved.push(`${k}: ${JSON.stringify(out[k])}`);
      delete out[k];
    }
  }
  if ("minItems" in out && out.minItems !== 0 && out.minItems !== 1) {
    moved.push(`minItems: ${JSON.stringify(out.minItems)}`);
    delete out.minItems;
  }
  if (typeof out.format === "string" && !SUPPORTED_FORMATS.has(out.format)) {
    moved.push(`format: ${JSON.stringify(out.format)}`);
    delete out.format;
  }
  if (moved.length) {
    const desc = typeof out.description === "string" && out.description ? `${out.description} ` : "";
    out.description = `${desc}{${moved.join(", ")}}`;
  }

  const isObject = out.type === "object" || (Array.isArray(out.type) && out.type.includes("object")) || isSchema(out.properties);
  if (isObject) {
    // A free-form map (additionalProperties true or a schema) can't be strict:
    // forcing it to false would let the model return only {}.
    if (out.additionalProperties !== undefined && out.additionalProperties !== false) tally.blocked = true;
    out.additionalProperties = false;
    const props = isSchema(out.properties) ? out.properties : {};
    const required = new Set(Array.isArray(out.required) ? (out.required as unknown[]).map(String) : []);
    const next: Schema = {};
    for (const [key, value] of Object.entries(props)) {
      if (!required.has(key)) tally.optional++;
      next[key] = isSchema(value) ? strictSchema(value, tally) : value;
    }
    out.properties = next;
  }
  if (isSchema(out.items)) out.items = strictSchema(out.items, tally);
  else if (Array.isArray(out.items)) tally.blocked = true; // tuple form
  for (const k of ["anyOf", "allOf"] as const) {
    if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).map(v => (isSchema(v) ? strictSchema(v, tally) : v));
  }
  return out;
}

/**
 * The tools with strict tool use turned on, when the whole set fits strict
 * mode's limits; otherwise the tools unchanged (non-strict). Unsupported
 * constraints (minimum, maxLength, …) are moved into the description; the
 * callers already check the values they read. A set that can't be strict is
 * sent exactly as before rather than risking a 400.
 */
export function strictTools(tools: readonly Anthropic.Tool[]): Anthropic.Tool[] {
  if (tools.length > STRICT_LIMITS.tools) return [...tools];
  const tally: Tally = { optional: 0, unions: 0, blocked: false };
  const converted = tools.map(tool => ({
    ...tool,
    strict: true,
    input_schema: strictSchema(tool.input_schema as Schema, tally) as Anthropic.Tool.InputSchema,
  }));
  if (tally.blocked || tally.optional > STRICT_LIMITS.optionalParams || tally.unions > STRICT_LIMITS.unionParams) {
    return [...tools];
  }
  return converted;
}

/** One tool, strict when its schema allows it. */
export function strictTool(tool: Anthropic.Tool): Anthropic.Tool {
  return strictTools([tool])[0];
}
