import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  aiMaxTokens, callToolInstruction, MAX_NON_STREAMING_TOKENS, pickToolUse, responseText, STRICT_LIMITS,
  strictTool, strictTools, THINKING_ROOM, toolChoiceFor, toolUses, wasRefused, withToolInstruction,
} from "./claude-calls";

type Content = Anthropic.ContentBlock[];
const msg = (content: unknown[], stop_reason: Anthropic.StopReason | null = "tool_use") =>
  ({ content: content as Content, stop_reason });
const use = (name: string, input: unknown = {}) => ({ type: "tool_use", id: `tu_${name}`, name, input, caller: { type: "direct" } });
const text = (t: string) => ({ type: "text", text: t, citations: null });
const thinking = { type: "thinking", thinking: "", signature: "sig" };

describe("toolChoiceFor (Claude 5.5: forced tool_choice is a 400 on Sonnet and Opus)", () => {
  it("forces the tool on Haiku 5.5, which still accepts it", () => {
    expect(toolChoiceFor("claude-haiku-5-5", "emit")).toEqual({ type: "tool", name: "emit" });
  });
  it("uses auto on Sonnet 5.5 and Opus 5.5", () => {
    expect(toolChoiceFor("claude-sonnet-5-5", "emit")).toEqual({ type: "auto" });
    expect(toolChoiceFor("claude-opus-5-5", "emit")).toEqual({ type: "auto" });
  });
  it("uses auto for a model it doesn't know — never risks the 400", () => {
    expect(toolChoiceFor("claude-something-new", "emit")).toEqual({ type: "auto" });
  });
});

describe("pickToolUse", () => {
  it("finds the named tool call after a thinking block", () => {
    const m = msg([thinking, text("Working on it"), use("other"), use("emit", { a: 1 })]);
    expect(pickToolUse(m, "emit")?.input).toEqual({ a: 1 });
  });
  it("returns null when the model answered in text instead", () => {
    expect(pickToolUse(msg([thinking, text("Here you go")], "end_turn"), "emit")).toBeNull();
  });
  it("returns null when only a different tool was called", () => {
    expect(pickToolUse(msg([use("other")]), "emit")).toBeNull();
  });
  it("returns null on a refusal, even if a partial call came back", () => {
    expect(pickToolUse(msg([use("emit", { a: 1 })], "refusal"), "emit")).toBeNull();
  });
  it("handles an empty response", () => {
    expect(pickToolUse(msg([], "refusal"), "emit")).toBeNull();
    expect(pickToolUse(msg([], "end_turn"), "emit")).toBeNull();
  });
});

describe("toolUses / responseText / wasRefused", () => {
  it("lists every tool call, skipping thinking and text", () => {
    expect(toolUses(msg([thinking, use("a"), text("x"), use("b")])).map(u => u.name)).toEqual(["a", "b"]);
  });
  it("gives no tool calls on a refusal", () => {
    expect(toolUses(msg([use("a")], "refusal"))).toEqual([]);
  });
  it("joins text blocks and ignores thinking", () => {
    expect(responseText(msg([thinking, text("Hello "), text("there")], "end_turn"))).toBe("Hello there");
  });
  it("gives no text on a refusal (partial output is discarded)", () => {
    expect(responseText(msg([text("Half an ans")], "refusal"))).toBe("");
    expect(wasRefused({ stop_reason: "refusal" })).toBe(true);
    expect(wasRefused({ stop_reason: "end_turn" })).toBe(false);
  });
});

describe("aiMaxTokens (thinking counts toward max_tokens)", () => {
  it("adds room to think on top of the answer's allowance", () => {
    expect(aiMaxTokens(400, "low")).toBe(400 + THINKING_ROOM.low);
    expect(aiMaxTokens(900, "medium")).toBe(900 + THINKING_ROOM.medium);
  });
  it("caps non-streaming calls under the SDK's timeout limit", () => {
    expect(aiMaxTokens(14_500, "medium")).toBe(MAX_NON_STREAMING_TOKENS);
  });
  it("doesn't cap a streaming call", () => {
    expect(aiMaxTokens(16_000, "high", { streaming: true })).toBe(16_000 + THINKING_ROOM.high);
  });
  it("always leaves the answer at least its old allowance", () => {
    for (const e of ["low", "medium", "high"] as const) expect(aiMaxTokens(1200, e)).toBeGreaterThan(1200);
  });
});

describe("withToolInstruction", () => {
  it("adds the call-the-tool line after the existing system prompt", () => {
    expect(withToolInstruction("Be brief.", "emit")).toBe(`Be brief.\n\n${callToolInstruction("emit")}`);
  });
  it("is the whole system prompt when there wasn't one", () => {
    expect(withToolInstruction(undefined, "emit")).toBe(callToolInstruction("emit"));
    expect(withToolInstruction("  ", "emit")).toBe(callToolInstruction("emit"));
  });
  it("names the tool", () => {
    expect(callToolInstruction("record_reasons")).toContain("record_reasons");
  });
});

describe("strictTool", () => {
  const tool = (input_schema: Record<string, unknown>): Anthropic.Tool =>
    ({ name: "t", description: "d", input_schema: { type: "object", ...input_schema } as Anthropic.Tool.InputSchema });

  it("turns strict on and closes every object, nested ones included", () => {
    const t = strictTool(tool({
      properties: {
        steps: { type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
      },
      required: ["steps"],
    }));
    expect(t.strict).toBe(true);
    const s = t.input_schema as Record<string, any>;
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.steps.items.additionalProperties).toBe(false);
    expect(s.properties.steps.items.required).toEqual(["text"]);
  });

  it("keeps enums, nullable types and supported formats", () => {
    const s = strictTool(tool({
      properties: {
        nova: { type: ["integer", "null"], enum: [1, 2, 3, 4, null] },
        when: { type: "string", format: "date" },
      },
      required: ["nova", "when"],
    })).input_schema as Record<string, any>;
    expect(s.properties.nova).toEqual({ type: ["integer", "null"], enum: [1, 2, 3, 4, null] });
    expect(s.properties.when.format).toBe("date");
  });

  it("moves unsupported constraints into the description instead of sending them", () => {
    const t = strictTool(tool({
      properties: {
        qty: { type: "number", minimum: 0, description: "How many" },
        tags: { type: "array", items: { type: "string", maxLength: 40 }, minItems: 2, maxItems: 4 },
        code: { type: "string", format: "barcode" },
      },
      required: ["qty", "tags", "code"],
    }));
    expect(t.strict).toBe(true);
    const s = t.input_schema as Record<string, any>;
    expect(s.properties.qty).toEqual({ type: "number", description: "How many {minimum: 0}" });
    expect(s.properties.tags.minItems).toBeUndefined();
    expect(s.properties.tags.maxItems).toBeUndefined();
    expect(s.properties.tags.description).toBe("{maxItems: 4, minItems: 2}");
    expect(s.properties.tags.items).toEqual({ type: "string", description: "{maxLength: 40}" });
    expect(s.properties.code).toEqual({ type: "string", description: "{format: \"barcode\"}" });
  });

  it("keeps minItems 0 and 1, which strict mode supports", () => {
    const s = strictTool(tool({ properties: { a: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["a"] }))
      .input_schema as Record<string, any>;
    expect(s.properties.a.minItems).toBe(1);
  });

  it("renames oneOf to anyOf", () => {
    const s = strictTool(tool({ properties: { v: { oneOf: [{ type: "string" }, { type: "number" }] } }, required: ["v"] }))
      .input_schema as Record<string, any>;
    expect(s.properties.v.anyOf).toHaveLength(2);
    expect(s.properties.v.oneOf).toBeUndefined();
  });

  it("doesn't change the tool it was given", () => {
    const original = tool({ properties: { q: { type: "string", maxLength: 5 } }, required: ["q"] });
    const copy = JSON.parse(JSON.stringify(original));
    strictTool(original);
    expect(original).toEqual(copy);
  });

  it("leaves a free-form map non-strict — closing it would only allow {}", () => {
    const original = tool({ properties: { m: { type: "object", additionalProperties: { type: "number" } } }, required: ["m"] });
    expect(strictTool(original)).toEqual(original);
  });

  it("leaves a $ref schema non-strict", () => {
    const original = tool({ properties: { m: { $ref: "#/$defs/x" } }, required: ["m"] });
    expect(strictTool(original).strict).toBeUndefined();
  });

  it("leaves a tool with too many optional parameters non-strict", () => {
    const props = Object.fromEntries(Array.from({ length: STRICT_LIMITS.optionalParams + 1 }, (_, i) => [`p${i}`, { type: "string" }]));
    expect(strictTool(tool({ properties: props, required: [] })).strict).toBeUndefined();
  });

  it("counts limits across the whole set of tools", () => {
    const half = Math.ceil((STRICT_LIMITS.optionalParams + 1) / 2);
    const props = Object.fromEntries(Array.from({ length: half }, (_, i) => [`p${i}`, { type: "string" }]));
    const set = [tool({ properties: props }), { ...tool({ properties: props }), name: "t2" }];
    expect(strictTools(set).every(t => t.strict === undefined)).toBe(true);
    expect(strictTools([set[0]])[0].strict).toBe(true);
  });

  it("leaves too many union-typed parameters non-strict", () => {
    const props = Object.fromEntries(Array.from({ length: STRICT_LIMITS.unionParams + 1 }, (_, i) => [`p${i}`, { type: ["string", "null"] }]));
    expect(strictTool(tool({ properties: props, required: Object.keys(props) })).strict).toBeUndefined();
  });
});
