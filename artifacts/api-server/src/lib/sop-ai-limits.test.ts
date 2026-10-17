import { describe, expect, it } from "vitest";
import { SOP_AI_MAX_TOKENS, SOP_AI_TOKENS_PER_STEP, SOP_MAX_STEPS, aiRanOutOfRoom } from "./sop-ai-limits";

describe("SOP AI limits (Graeme, 2026-10-17: only 10 steps fitted)", () => {
  it("allows up to 30 steps", () => {
    expect(SOP_MAX_STEPS).toBe(30);
  });
  it("gives the AI room for 30 long steps — the old 4,096 allowance ran out around 10", () => {
    expect(SOP_AI_MAX_TOKENS).toBeGreaterThanOrEqual(SOP_MAX_STEPS * SOP_AI_TOKENS_PER_STEP);
    expect(SOP_AI_MAX_TOKENS).toBeGreaterThan(4096 * 3);
  });
  it("spots an answer cut off for length", () => {
    expect(aiRanOutOfRoom("max_tokens")).toBe(true);
    expect(aiRanOutOfRoom("tool_use")).toBe(false);
    expect(aiRanOutOfRoom(null)).toBe(false);
  });
});
