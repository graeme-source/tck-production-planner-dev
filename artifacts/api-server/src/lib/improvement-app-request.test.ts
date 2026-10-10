import { describe, it, expect } from "vitest";
import { ideaWantsScan, issueTextFromIdea, looksLikeAppRequest, suggestionMove } from "./improvement-app-request";

describe("looksLikeAppRequest", () => {
  it("flags an idea that asks for an app change", () => {
    const v = looksLikeAppRequest({ title: "Could we have a button on the building screen to edit numbers?", station: "Building" });
    expect(v.flagged).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/button/);
    expect(v.reasons.join(" ")).toMatch(/could we/);
  });

  it("flags anything logged against the app itself", () => {
    expect(looksLikeAppRequest({ title: "Bigger writing", station: "App / iPad" }).flagged).toBe(true);
  });

  it("flags two parts of the app even without a question", () => {
    expect(looksLikeAppRequest({ title: "Pack report should be on the dashboard", station: "Packing" }).flagged).toBe(true);
  });

  it("flags one part of the app plus an ask", () => {
    expect(looksLikeAppRequest({ title: "It would be good if the iPad beeped", description: "", station: "Ovens" }).flagged).toBe(true);
  });

  it("leaves physical, factory-floor ideas alone", () => {
    expect(looksLikeAppRequest({ title: "Move the bin closer to the oven", station: "Ovens" }).flagged).toBe(false);
    expect(looksLikeAppRequest({ title: "Could we get a second mixing bowl?", station: "Mixing" }).flagged).toBe(false);
    expect(looksLikeAppRequest({ title: "Shadow board for the knives", description: "Saves looking for them", station: "Prep" }).flagged).toBe(false);
  });

  it("matches whole words, not parts of words", () => {
    // "tabletop" is not "tablet"; "happy" is not "app"; "spinach" is not "pin".
    expect(looksLikeAppRequest({ title: "Clear the tabletop, happy team, spinach out", station: "Prep" }).flagged).toBe(false);
  });

  it("gives no reasons when not flagged", () => {
    expect(looksLikeAppRequest({ title: "Tidy shelf", station: "Prep" }).reasons).toEqual([]);
  });
});

describe("ideaWantsScan", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("checks recent open ideas only", () => {
    expect(ideaWantsScan({ progressStatus: "submitted_for_review", createdAt: "2026-10-01T00:00:00Z", linkedToIssue: false }, now)).toBe(true);
    expect(ideaWantsScan({ progressStatus: "complete", createdAt: "2026-10-01T00:00:00Z", linkedToIssue: false }, now)).toBe(false);
    expect(ideaWantsScan({ progressStatus: "rejected", createdAt: "2026-10-01T00:00:00Z", linkedToIssue: false }, now)).toBe(false);
    expect(ideaWantsScan({ progressStatus: "submitted_for_review", createdAt: "2026-08-01T00:00:00Z", linkedToIssue: false }, now)).toBe(false);
    expect(ideaWantsScan({ progressStatus: "submitted_for_review", createdAt: "2026-10-01T00:00:00Z", linkedToIssue: true }, now)).toBe(false);
  });
});

describe("suggestionMove — nothing goes in without Graeme's click", () => {
  it("add or dismiss a suggestion; restore a dismissed one", () => {
    expect(suggestionMove("suggested", "add")).toBe("added");
    expect(suggestionMove("suggested", "dismiss")).toBe("dismissed");
    expect(suggestionMove("dismissed", "restore")).toBe("suggested");
  });
  it("refuses anything else", () => {
    expect(suggestionMove("added", "dismiss")).toBeNull();
    expect(suggestionMove("added", "add")).toBeNull();
    expect(suggestionMove("dismissed", "add")).toBeNull();
    expect(suggestionMove("suggested", "restore")).toBeNull();
  });
});

describe("issueTextFromIdea", () => {
  it("keeps the idea's own words", () => {
    expect(issueTextFromIdea({ id: 3, title: "Bigger writing", description: "On the oven screen" })).toBe("Bigger writing\n\nOn the oven screen");
    expect(issueTextFromIdea({ id: 3, title: "Bigger writing", description: "Bigger writing" })).toBe("Bigger writing");
  });
});
