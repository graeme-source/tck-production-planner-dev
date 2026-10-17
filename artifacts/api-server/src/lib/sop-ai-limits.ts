/**
 * How long an SOP the AI helpers can handle (Graeme, 17 Oct 2026: "we can
 * only put 10 steps in an SOP — increase this to up to 30").
 *
 * Nothing capped steps by count: the AI that drafts steps from a video and
 * the one that polishes them had a 4,096-token answer allowance. A drafted
 * step (2–4 sentences + safety note + timestamps) costs ~200–350 tokens, so
 * the answer ran out at roughly 10–15 steps and the rest never came back.
 * The allowance now fits SOP_MAX_STEPS long steps, and running out is
 * reported plainly instead of looking like a short SOP.
 */
export const SOP_MAX_STEPS = 30;
/** Generous per-step cost for the drafting tool's JSON (the largest of the two). */
export const SOP_AI_TOKENS_PER_STEP = 450;
export const SOP_AI_MAX_TOKENS = SOP_MAX_STEPS * SOP_AI_TOKENS_PER_STEP + 1000;

/** True when the AI stopped because it ran out of room, not because it finished. */
export function aiRanOutOfRoom(stopReason: string | null | undefined): boolean {
  return stopReason === "max_tokens";
}

export const SOP_TOO_LONG_MESSAGE =
  `This process came out longer than ${SOP_MAX_STEPS} steps — split it into two SOPs (or two videos) and try again.`;
