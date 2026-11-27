import { describe, expect, it } from "vitest";
import {
  JANE_FORM_LABEL, addedLine, dayWord, draftHeading, draftRows, readDraftEvent, readFormEvent, todoBodyFor, wishBodyFor,
  type JaneDraft,
} from "./jane-add";

describe("readFormEvent", () => {
  it("reads a form request", () => {
    expect(readFormEvent({ id: "t1", request: { kind: "incident", text: " Bone in the duck " } }))
      .toEqual({ kind: "incident", text: "Bone in the duck" });
    expect(readFormEvent({ request: { kind: "issue", area: "factory", safety: true, text: "Wet floor" } }))
      .toEqual({ kind: "issue", area: "factory", safety: true, text: "Wet floor" });
  });
  it("ignores anything it doesn't know", () => {
    expect(readFormEvent({ request: { kind: "payroll" } })).toBeNull();
    expect(readFormEvent(null)).toBeNull();
    expect(readFormEvent({ request: { kind: "issue", area: "moon", safety: "yes" } })).toEqual({ kind: "issue" });
  });
  it("keeps only a web link", () => {
    expect(readFormEvent({ request: { kind: "wish_list", link: "javascript:alert(1)" } })).toEqual({ kind: "wish_list" });
    expect(readFormEvent({ request: { kind: "wish_list", link: "https://shop.example/x" } }))
      .toEqual({ kind: "wish_list", link: "https://shop.example/x" });
  });
  it("names every form as its Quick actions button", () => {
    expect(JANE_FORM_LABEL.incident).toBe("Report accident / incident / foreign object");
    expect(JANE_FORM_LABEL.receipt).toBe("Add receipt or invoice");
    expect(JANE_FORM_LABEL.kanban).toBe("Pull kanban");
    expect(readFormEvent({ request: { kind: "kanban", text: "mozzarella" } })).toEqual({ kind: "kanban", text: "mozzarella" });
    expect(JANE_FORM_LABEL.wish_list).toBe("Add to Wish List");
  });
});

describe("readDraftEvent", () => {
  it("reads a to-do draft", () => {
    expect(readDraftEvent({ id: "t1", draft: { kind: "todo", title: "Ring the butcher", priority: "high", dueDate: "2026-11-28" } }))
      .toEqual({ id: "t1", draft: { kind: "todo", title: "Ring the butcher", notes: null, priority: "high", dueDate: "2026-11-28" } });
  });
  it("falls back to safe values", () => {
    expect(readDraftEvent({ id: "t1", draft: { kind: "todo", title: "A", priority: "asap", dueDate: "Friday" } }))
      .toEqual({ id: "t1", draft: { kind: "todo", title: "A", notes: null, priority: "normal", dueDate: null } });
    expect(readDraftEvent({ id: "t2", draft: { kind: "wish_list", title: "Mops", quantity: 0 } }))
      .toEqual({ id: "t2", draft: { kind: "wish_list", title: "Mops", notes: null, quantity: 1 } });
  });
  it("refuses a draft with no title, no id or another kind", () => {
    expect(readDraftEvent({ id: "t1", draft: { kind: "todo", title: " " } })).toBeNull();
    expect(readDraftEvent({ draft: { kind: "todo", title: "A" } })).toBeNull();
    expect(readDraftEvent({ id: "t1", draft: { kind: "incident", title: "A" } })).toBeNull();
  });
});

const todo: JaneDraft = { kind: "todo", title: "Ring the butcher", notes: "about Friday's lamb", priority: "high", dueDate: "2026-11-28" };
const wish: JaneDraft = { kind: "wish_list", title: "Label printer", notes: null, quantity: 2 };

describe("the confirm card", () => {
  it("shows exactly what will be created", () => {
    expect(draftHeading(todo)).toBe("Add to your to-do list?");
    expect(draftRows(todo)).toEqual([
      { label: "To-do", value: "Ring the butcher" },
      { label: "Notes", value: "about Friday's lamb" },
      { label: "Priority", value: "High" },
      { label: "Due", value: "Sat 28 Nov" },
    ]);
    expect(draftHeading(wish)).toBe("Add to the Wish List?");
    expect(draftRows(wish)).toEqual([
      { label: "What's needed", value: "Label printer" },
      { label: "How many", value: "2" },
    ]);
  });
  it("never moves the due day", () => {
    expect(dayWord("2026-03-29")).toBe("Sun 29 Mar");
  });
});

describe("request bodies", () => {
  it("sends the to-do form's own body, on their own list", () => {
    expect(todoBodyFor(todo as Extract<JaneDraft, { kind: "todo" }>, 7)).toEqual({
      assigneeId: 7, title: "Ring the butcher", notes: "about Friday's lamb", url: null, priority: "high", scheduledFor: null, dueDate: "2026-11-28",
    });
    expect(todoBodyFor({ kind: "todo", title: "A", notes: null, priority: "normal", dueDate: null }, 7)).toEqual({
      assigneeId: 7, title: "A", notes: null, url: null, priority: "normal", scheduledFor: null, dueDate: null,
    });
  });
  it("sends a typed Wish List item with no link", () => {
    expect(wishBodyFor(wish as Extract<JaneDraft, { kind: "wish_list" }>)).toEqual({ url: null, title: "Label printer", notes: null, quantity: 2 });
  });
  it("says what happened, including a vote on a duplicate", () => {
    expect(addedLine(todo)).toBe('Added "Ring the butcher" to your to-do list.');
    expect(addedLine(wish, { duplicate: false })).toBe('Added "Label printer" to the Wish List, with your vote.');
    expect(addedLine(wish, { duplicate: true, message: "Already on the list — added your vote instead" }))
      .toBe('Already on the list — added your vote instead: "Label printer".');
  });
});
