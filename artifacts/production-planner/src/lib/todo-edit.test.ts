import { describe, expect, it } from "vitest";
import { EMPTY_TODO_FORM, todoCreateBody, todoEditPatch, todoFormFrom, todoFormValid, type TodoEditable } from "./todo-edit";

const task = (over: Partial<TodoEditable> = {}): TodoEditable => ({
  title: "Deep-clean the pass fridge",
  notes: null,
  url: null,
  priority: "normal",
  scheduled_for: null,
  due_date: "2026-10-15",
  ...over,
});

describe("todoEditPatch", () => {
  it("is null when nothing changed (grey save button, no close question)", () => {
    const t = task({ notes: "Use the blue spray" });
    expect(todoEditPatch(t, todoFormFrom(t))).toBeNull();
  });

  it("ignores whitespace-only differences and blank-vs-null", () => {
    const t = task({ notes: "Use the blue spray" });
    const f = { ...todoFormFrom(t), title: "  Deep-clean the pass fridge ", notes: "Use the blue spray  ", url: "   " };
    expect(todoEditPatch(t, f)).toBeNull();
  });

  it("sends only the fields that changed", () => {
    const t = task();
    const f = { ...todoFormFrom(t), priority: "urgent" as const, notes: "Before 10am" };
    expect(todoEditPatch(t, f)).toEqual({ priority: "urgent", notes: "Before 10am" });
  });

  it("clearing a date or a note sends null (the server clears it)", () => {
    const t = task({ notes: "old", scheduled_for: "2026-10-14" });
    const f = { ...todoFormFrom(t), notes: "", scheduledFor: "", dueDate: "" };
    expect(todoEditPatch(t, f)).toEqual({ notes: null, scheduledFor: null, dueDate: null });
  });

  it("trims a changed title", () => {
    expect(todoEditPatch(task(), { ...todoFormFrom(task()), title: "  Order gloves " })).toEqual({ title: "Order gloves" });
  });
});

describe("todoFormValid / todoCreateBody", () => {
  it("needs a title", () => {
    expect(todoFormValid(EMPTY_TODO_FORM)).toBe(false);
    expect(todoFormValid({ ...EMPTY_TODO_FORM, title: "   " })).toBe(false);
    expect(todoFormValid({ ...EMPTY_TODO_FORM, title: "Order gloves" })).toBe(true);
  });

  it("builds the create body with blanks as null", () => {
    expect(todoCreateBody({ ...EMPTY_TODO_FORM, title: " Order gloves ", url: " " }, 7)).toEqual({
      assigneeId: 7, title: "Order gloves", notes: null, url: null, priority: "normal", scheduledFor: null, dueDate: null,
    });
  });
});
