import { describe, it, expect } from "vitest";
import { asTalkingPoints, splitTopic, tickProgress } from "./talking-points";

const NOTE = [
  "Start with",
  "- Quality and thoroughness: a plus",
  "- Improvements: a real plus",
  "",
  "To work on",
  "Speed and output:",
  "- Mix and prep speed: little or no change since agreed (17 Sep)",
  "- Target: Dave's standard",
  "- Lack of urgency at times",
  "",
  "Finish with",
  "- Very likeable within the team, really helpful",
].join("\n");

describe("asTalkingPoints", () => {
  it("reads headings, sub-headings and bold topics", () => {
    expect(asTalkingPoints(NOTE)).toEqual([
      { kind: "heading", text: "Start with" },
      { kind: "point", key: "Quality and thoroughness: a plus", topic: "Quality and thoroughness", detail: "a plus" },
      { kind: "point", key: "Improvements: a real plus", topic: "Improvements", detail: "a real plus" },
      { kind: "heading", text: "To work on" },
      { kind: "subheading", text: "Speed and output" },
      { kind: "point", key: "Mix and prep speed: little or no change since agreed (17 Sep)", topic: "Mix and prep speed", detail: "little or no change since agreed (17 Sep)" },
      { kind: "point", key: "Target: Dave's standard", topic: "Target", detail: "Dave's standard" },
      { kind: "point", key: "Lack of urgency at times", topic: null, detail: "Lack of urgency at times" },
      { kind: "heading", text: "Finish with" },
      { kind: "point", key: "Very likeable within the team, really helpful", topic: null, detail: "Very likeable within the team, really helpful" },
    ]);
  });

  it("leaves an ordinary note alone", () => {
    expect(asTalkingPoints("Spoke about his hours. He's happy with them.")).toBeNull();
    expect(asTalkingPoints("- one\n- two")).toBeNull();
  });

  it("keeps a sentence as a paragraph, and repeats as separate ticks", () => {
    const b = asTalkingPoints("This is a longer sentence that explains something in full.\n- a\n- a\n- b")!;
    expect(b[0]).toEqual({ kind: "text", text: "This is a longer sentence that explains something in full." });
    expect(b.filter(x => x.kind === "point").map(x => (x as { key: string }).key)).toEqual(["a", "a#2", "b"]);
  });
});

describe("splitTopic", () => {
  it("only splits on a short topic", () => {
    expect(splitTopic("Packing area: general efficiency")).toEqual({ topic: "Packing area", detail: "general efficiency" });
    expect(splitTopic("Arrived at 7:05 twice")).toEqual({ topic: null, detail: "Arrived at 7:05 twice" });
    expect(splitTopic("He said this was not really what he meant at all: fine")).toEqual({ topic: null, detail: "He said this was not really what he meant at all: fine" });
    expect(splitTopic("Note:")).toEqual({ topic: null, detail: "Note:" });
  });
});

describe("tickProgress", () => {
  it("counts ticked points", () => {
    const b = asTalkingPoints(NOTE)!;
    expect(tickProgress(b, new Set(["Target: Dave's standard", "gone"]))).toEqual({ done: 1, total: 6 });
  });
});
