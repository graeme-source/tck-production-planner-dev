import { describe, it, expect } from "vitest";
import { parseKanbanQr } from "./kanban-qr";

describe("parseKanbanQr", () => {
  // The format printed on every card currently in the building. If this
  // ever stops working, the physical cards stop working.
  it("reads the JSON payload on today's cards", () => {
    expect(parseKanbanQr('{"type":"ingredient","id":12}')).toEqual({ type: "ingredient", id: 12 });
  });

  it("tolerates whitespace around the payload", () => {
    expect(parseKanbanQr('  {"type":"ingredient","id":12}  ')).toEqual({ type: "ingredient", id: 12 });
  });

  it("reads a string id in the JSON payload", () => {
    expect(parseKanbanQr('{"type":"ingredient","id":"12"}')).toEqual({ type: "ingredient", id: 12 });
  });

  // The deep-link form: what a phone's own camera app can turn into a
  // tappable link.
  it("reads the deep-link URL form", () => {
    expect(parseKanbanQr("https://planner.example.co.uk/scan?type=ingredient&id=12"))
      .toEqual({ type: "ingredient", id: 12 });
  });

  it("reads a deep link on any host, including a dev machine", () => {
    expect(parseKanbanQr("http://localhost:5273/scan?type=ingredient&id=7"))
      .toEqual({ type: "ingredient", id: 7 });
  });

  it("normalises a hyphenated type from a URL", () => {
    expect(parseKanbanQr("https://x/scan?type=sub-recipe&id=3"))
      .toEqual({ type: "sub_recipe", id: 3 });
  });

  it("reads a path-style deep link", () => {
    expect(parseKanbanQr("https://planner.example.co.uk/scan/ingredient/44"))
      .toEqual({ type: "ingredient", id: 44 });
  });

  it("reads a bare id from the oldest cards as an ingredient", () => {
    expect(parseKanbanQr("12")).toEqual({ type: "ingredient", id: 12 });
  });

  it("rejects anything that isn't a kanban code", () => {
    expect(parseKanbanQr("")).toBeNull();
    expect(parseKanbanQr("   ")).toBeNull();
    expect(parseKanbanQr("hello")).toBeNull();
    expect(parseKanbanQr("https://example.com/nothing-useful")).toBeNull();
  });

  it("rejects a zero or negative id rather than hitting the API with it", () => {
    expect(parseKanbanQr('{"type":"ingredient","id":0}')).toBeNull();
    expect(parseKanbanQr("0")).toBeNull();
    expect(parseKanbanQr("https://x/scan?type=ingredient&id=0")).toBeNull();
  });

  it("rejects JSON that isn't a QR target", () => {
    expect(parseKanbanQr('{"foo":"bar"}')).toBeNull();
    expect(parseKanbanQr("[1,2,3]")).toBeNull();
  });
});
