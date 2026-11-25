import { describe, expect, it } from "vitest";
import { EMPTY_TODO_FORM } from "./todo-edit";
import {
  applyEditDraft, createDraftStarted, EMPTY_CREATE_DRAFT, parseCreateDraft, parseEditDraft, parseTextDraft, startCreateDraft, todoDraftKey, type TodoCreateDraft,
} from "./todo-drafts";

describe("todoDraftKey", () => {
  it("is per person and per thing being typed", () => {
    const keys = [
      todoDraftKey(1, { kind: "comment", taskId: 5 }), todoDraftKey(2, { kind: "comment", taskId: 5 }),
      todoDraftKey(1, { kind: "comment", taskId: 6 }), todoDraftKey(1, { kind: "add", listUserId: 5 }),
      todoDraftKey(1, { kind: "add", listUserId: 6 }), todoDraftKey(1, { kind: "create" }),
      todoDraftKey(1, { kind: "edit", taskId: 5 }), todoDraftKey(1, { kind: "subtask", taskId: 5 }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("reading drafts back", () => {
  it("text round-trips; junk is empty", () => {
    expect(parseTextDraft(JSON.stringify("ring the butcher"))).toBe("ring the butcher");
    expect(parseTextDraft(null)).toBe("");
    expect(parseTextDraft("{nope")).toBe("");
    expect(parseTextDraft("42")).toBe("");
  });
  it("a new to-do round-trips; junk is empty", () => {
    const d: TodoCreateDraft = { form: { ...EMPTY_TODO_FORM, title: "Order film", priority: "high", dueDate: "2026-11-27" }, assigneeId: 9 };
    expect(parseCreateDraft(JSON.stringify(d))).toEqual(d);
    expect(parseCreateDraft(null)).toEqual(EMPTY_CREATE_DRAFT);
    expect(parseCreateDraft("null")).toEqual(EMPTY_CREATE_DRAFT);
    expect(parseCreateDraft("{nope")).toEqual(EMPTY_CREATE_DRAFT);
    expect(parseCreateDraft(JSON.stringify({ form: { title: 7, priority: "whenever" }, assigneeId: "x" }))).toEqual(EMPTY_CREATE_DRAFT);
  });
});

describe("createDraftStarted", () => {
  it("is something typed or picked, not just who it's for", () => {
    expect(createDraftStarted(EMPTY_CREATE_DRAFT)).toBe(false);
    expect(createDraftStarted({ ...EMPTY_CREATE_DRAFT, assigneeId: 9 })).toBe(false);
    expect(createDraftStarted({ ...EMPTY_CREATE_DRAFT, form: { ...EMPTY_TODO_FORM, title: "  " } })).toBe(false);
    expect(createDraftStarted({ ...EMPTY_CREATE_DRAFT, form: { ...EMPTY_TODO_FORM, notes: "x" } })).toBe(true);
    expect(createDraftStarted({ ...EMPTY_CREATE_DRAFT, form: { ...EMPTY_TODO_FORM, priority: "urgent" } })).toBe(true);
  });
});

describe("startCreateDraft", () => {
  it("starts from what's in the add box, for the list it's on", () => {
    expect(startCreateDraft(EMPTY_CREATE_DRAFT, " Ring the butcher ", 4)).toEqual({ form: { ...EMPTY_TODO_FORM, title: "Ring the butcher" }, assigneeId: 4 });
    expect(startCreateDraft({ ...EMPTY_CREATE_DRAFT, assigneeId: 9 }, "  ", 4)).toEqual({ form: EMPTY_TODO_FORM, assigneeId: 4 });
  });
  it("carries on with one already started — never replaces its title", () => {
    const started: TodoCreateDraft = { form: { ...EMPTY_TODO_FORM, title: "Order film", notes: "Two rolls" }, assigneeId: 9 };
    expect(startCreateDraft(started, "Ring the butcher", 4)).toBe(started);
  });
  it("keeps the rest when only the title is missing", () => {
    const notesOnly: TodoCreateDraft = { form: { ...EMPTY_TODO_FORM, notes: "Two rolls" }, assigneeId: 9 };
    expect(startCreateDraft(notesOnly, "Order film", 4)).toEqual({ form: { ...EMPTY_TODO_FORM, title: "Order film", notes: "Two rolls" }, assigneeId: 9 });
  });
});

describe("an edit that didn't reach the server", () => {
  const base = { ...EMPTY_TODO_FORM, title: "Order film", notes: "Two rolls" };
  it("round-trips; junk is none", () => {
    const d = { base, form: { ...base, notes: "Three rolls" } };
    expect(parseEditDraft(JSON.stringify(d))).toEqual(d);
    expect(parseEditDraft(null)).toBeNull();
    expect(parseEditDraft("{nope")).toBeNull();
    expect(parseEditDraft(JSON.stringify({ form: base }))).toBeNull();
  });
  it("goes back on the to-do as it is now, without undoing anyone else's change", () => {
    const now = { ...base, title: "Order stretch film", priority: "high" as const };
    expect(applyEditDraft(now, { base, form: { ...base, notes: "Three rolls" } })).toEqual({ ...now, notes: "Three rolls" });
  });
  it("a field the person changed wins", () => {
    expect(applyEditDraft({ ...base, notes: "Four" }, { base, form: { ...base, notes: "Three" } }).notes).toBe("Three");
    expect(applyEditDraft(base, { base, form: { ...base, title: "X", url: "/a", priority: "low", scheduledFor: "2026-11-26", dueDate: "2026-11-27" } }))
      .toEqual({ ...base, title: "X", url: "/a", priority: "low", scheduledFor: "2026-11-26", dueDate: "2026-11-27" });
  });
});
