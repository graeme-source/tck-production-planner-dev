import { describe, it, expect } from "vitest";
import { answersAsBrief, checkedStep, describeWithBrief, MAX_QUESTIONS, questionsAsked, talkThroughOn } from "./report-chat-rules";

describe("talkThroughOn", () => {
  it("is on until it's switched off", () => {
    expect(talkThroughOn(null)).toBe(true);
    expect(talkThroughOn("on")).toBe(true);
    expect(talkThroughOn("off")).toBe(false);
  });
});

describe("checkedStep", () => {
  it("keeps a question with tidy, de-duplicated tap answers", () => {
    const s = checkedStep({ name: "ask", input: { message: " Must they do it? ", choices: ["Yes, every time", "yes, every time", "Not sure", "Can swipe it away", "", 7] } }, 0);
    expect(s).toEqual({ kind: "question", message: "Must they do it?", choices: ["Yes, every time", "Can swipe it away"] });
  });

  it("refuses a fifth question, so the chat always ends", () => {
    expect(checkedStep({ name: "ask", input: { message: "One more?", choices: [] } }, MAX_QUESTIONS)).toBeNull();
  });

  it("needs a summary to finish", () => {
    expect(checkedStep({ name: "brief", input: { message: "Here it is", brief: "  " } }, 2)).toBeNull();
    expect(checkedStep({ name: "brief", input: { brief: "What they want: a reminder" } }, 2)).toMatchObject({ kind: "brief", brief: "What they want: a reminder" });
  });

  it("ignores anything else", () => {
    expect(checkedStep({ name: "search_app_guide", input: { query: "x" } }, 0)).toBeNull();
    expect(checkedStep(null, 0)).toBeNull();
  });
});

describe("answersAsBrief and questionsAsked", () => {
  const chat = [
    { role: "user" as const, text: "Remind us to label the trays" },
    { role: "assistant" as const, text: "Should it pop up every time?" },
    { role: "user" as const, text: "Once a day" },
    { role: "assistant" as const, text: "Can they swipe it away?" },
  ];
  it("counts Jane's questions", () => expect(questionsAsked(chat)).toBe(2));
  it("keeps only answered questions, in order", () => {
    expect(answersAsBrief(chat)).toBe("Should it pop up every time? — Once a day");
    expect(answersAsBrief(chat.slice(0, 1))).toBeNull();
  });
});

describe("describeWithBrief", () => {
  it("puts their words first and the summary under a heading", () => {
    expect(describeWithBrief(" Fix it ", "What they want: X")).toBe("Fix it\n\nTalked through with AI Jane:\nWhat they want: X");
    expect(describeWithBrief("Fix it", "")).toBe("Fix it");
  });
});
