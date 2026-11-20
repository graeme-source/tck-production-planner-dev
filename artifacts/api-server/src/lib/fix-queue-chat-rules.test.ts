import { describe, it, expect } from "vitest";
import { chatBriefing, MAX_CHAT_TURNS, trimHistory } from "./fix-queue-chat-rules";

const report = { id: 406, createdAt: "2026-11-20T07:00:00Z", reporterName: "Dave Bewsey", area: "system", station: "App / iPad", description: "Prep checklist completed before I've looked at it" };

describe("chatBriefing", () => {
  it("starts from the report and the reviewer's recommendation", () => {
    const text = chatBriefing({
      report,
      triage: { lane: "understanding", status: "proposed", verdictSummary: "Not an app fault", explanation: null, proposedFix: null, objective: null, blastRadius: null, confidence: null, behaviourChange: true, questionForGraeme: "Block early ticks?", suggestedReply: null },
      comments: [], events: [], janeChat: null,
    });
    expect(text).toContain("## The report (#406)");
    expect(text).toContain("By: Dave Bewsey");
    expect(text).toContain("Prep checklist completed before I've looked at it");
    expect(text).toContain("Summary: Not an app fault");
    expect(text).toContain("Changes agreed behaviour: yes");
    expect(text).toContain("Question for Graeme: Block early ticks?");
    expect(text).not.toContain("Explanation:");
  });

  it("includes the reporter's chat with Jane, comments and history when there are any", () => {
    const text = chatBriefing({
      report, triage: null,
      comments: [{ author: "Graeme", text: "Looks odd", at: "2026-11-20T08:00:00Z" }],
      events: [{ event: "proposed", actor: "reviewer", note: null, at: "2026-11-20T07:30:00Z" }],
      janeChat: [{ role: "user", text: "It's ticked" }, { role: "assistant", text: "Which list?" }, { role: "user", text: "Opening" }],
    });
    expect(text).toContain("Reporter: It's ticked");
    expect(text).toContain("Jane: Which list?");
    expect(text).toContain("Graeme: Looks odd");
    expect(text).toContain("proposed (reviewer)");
    expect(text).not.toContain("hourly reviewer's recommendation");
  });
});

describe("trimHistory", () => {
  it("keeps the latest turns only", () => {
    const h = Array.from({ length: MAX_CHAT_TURNS + 5 }, (_, i) => i);
    expect(trimHistory(h)).toHaveLength(MAX_CHAT_TURNS);
    expect(trimHistory(h)[0]).toBe(5);
    expect(trimHistory([1, 2])).toEqual([1, 2]);
  });
});
