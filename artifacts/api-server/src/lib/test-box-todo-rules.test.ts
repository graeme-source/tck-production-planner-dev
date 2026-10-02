import { describe, it, expect } from "vitest";
import { planTodoSync, todoNotes, todoTitle, type TodoState, type WantedTodo } from "./test-box-todo-rules";

const w = (key: string, dueDate = "2026-10-12", title = `T ${key}`): WantedTodo => ({ key, title, dueDate, notes: "n" });
const todo = (id: number, over: Partial<TodoState> = {}): TodoState => ({ id, status: "open", assigneeId: 5, title: "T a", dueDate: "2026-10-12", notes: "n", ...over });

describe("to-do titles and notes", () => {
  it("names the box and the delivery once", () => {
    expect(todoTitle("Properoni Test Box", { label: "Production day" }, "2026-10-16")).toBe("Production day — 16 Oct delivery (Properoni Test Box)");
    expect(todoTitle("Properoni Test Box", { label: "Close orders for 16 Oct (latest)" }, "2026-10-16")).toBe("Close orders for 16 Oct (latest) (Properoni Test Box)");
    expect(todoTitle("Box", { label: "Create a Shopify collection named 'Box' and add the products" })).toBe("Create a Shopify collection named 'Box' and add the products");
  });
  it("notes carry the how, the detail and the ingredients", () => {
    const n = todoNotes({ how: "Do X.", detail: "Because Y.", items: ["Flour", "Salt"], time: "16:00" });
    expect(n).toContain("By 16:00.");
    expect(n).toContain("Do X.");
    expect(n).toContain("Ingredients: Flour, Salt.");
  });
});

describe("planTodoSync — the tick is the source of truth", () => {
  it("creates a to-do for every unticked task with none", () => {
    const a = planTodoSync({ wanted: [w("a"), w("b")], links: [], todos: new Map(), ownerId: 5, active: true });
    expect(a).toEqual([
      { kind: "create", key: "a", title: "T a", dueDate: "2026-10-12", notes: "n", assigneeId: 5 },
      { kind: "create", key: "b", title: "T b", dueDate: "2026-10-12", notes: "n", assigneeId: 5 },
    ]);
  });

  it("doesn't recreate a to-do for a task already ticked", () => {
    expect(planTodoSync({ wanted: [w("a")], links: [{ key: "a", done: true, todoId: null }], todos: new Map(), ownerId: 5, active: true })).toEqual([]);
  });

  it("is a no-op when everything already matches (re-save never duplicates)", () => {
    const a = planTodoSync({ wanted: [w("a")], links: [{ key: "a", done: false, todoId: 1 }], todos: new Map([[1, todo(1)]]), ownerId: 5, active: true });
    expect(a).toEqual([]);
  });

  it("moves an open to-do's due date and owner with the task", () => {
    const a = planTodoSync({ wanted: [w("a", "2026-10-14")], links: [{ key: "a", done: false, todoId: 1 }], todos: new Map([[1, todo(1)]]), ownerId: 8, active: true });
    expect(a).toEqual([{ kind: "update", key: "a", todoId: 1, title: "T a", dueDate: "2026-10-14", notes: "n", assigneeId: 8 }]);
  });

  it("leaves a done to-do's date alone", () => {
    const a = planTodoSync({ wanted: [w("a", "2026-10-14")], links: [{ key: "a", done: true, todoId: 1 }], todos: new Map([[1, todo(1, { status: "done" })]]), ownerId: 5, active: true });
    expect(a).toEqual([]);
  });

  it("sets the to-do to match the tick when they disagree", () => {
    const a = planTodoSync({ wanted: [w("a")], links: [{ key: "a", done: true, todoId: 1 }], todos: new Map([[1, todo(1)]]), ownerId: 5, active: true });
    expect(a).toEqual([{ kind: "set-status", key: "a", todoId: 1, done: true }]);
    const b = planTodoSync({ wanted: [w("a")], links: [{ key: "a", done: false, todoId: 1 }], todos: new Map([[1, todo(1, { status: "done" })]]), ownerId: 5, active: true });
    expect(b).toEqual([{ kind: "set-status", key: "a", todoId: 1, done: false }]);
  });

  it("removes open to-dos whose task has gone; keeps done ones", () => {
    const a = planTodoSync({
      wanted: [],
      links: [{ key: "d3:prep", done: false, todoId: 1 }, { key: "d3:production", done: true, todoId: 2 }],
      todos: new Map([[1, todo(1)], [2, todo(2, { status: "done" })]]),
      ownerId: 5, active: true,
    });
    expect(a).toEqual([{ kind: "remove", key: "d3:prep", todoId: 1 }]);
  });

  it("a deleted or cancelled box removes every open to-do", () => {
    const a = planTodoSync({ wanted: [w("a")], links: [{ key: "a", done: false, todoId: 1 }], todos: new Map([[1, todo(1)]]), ownerId: 5, active: false });
    expect(a).toEqual([{ kind: "remove", key: "a", todoId: 1 }]);
  });
});
