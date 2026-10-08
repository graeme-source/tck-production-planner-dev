import { describe, it, expect } from "vitest";
import { orderTickCascade, planTodoSync, todoNotes, todoTitle, type TodoState, type WantedTodo } from "./test-box-todo-rules";

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

describe("new-ingredient lines in the to-do notes", () => {
  it("one line per ingredient: supplier, order-by and where to order", () => {
    const n = todoNotes({
      detail: "Why.",
      subItems: [
        { key: "d1:order-new-i300", ingredientId: 300, name: "Classic Sliced Pepperoni", supplier: "Salvo 1968", orderBy: "2026-10-05", time: "14:00", link: "https://x.test/p", assumed: false, past: false },
        { key: "d1:order-new-i11", ingredientId: 11, name: "Sage", supplier: null, orderBy: "2026-10-06", link: null, assumed: true, past: false },
      ],
    });
    expect(n).toContain("• Classic Sliced Pepperoni — Salvo 1968, order by Mon 5 Oct 14:00 — https://x.test/p");
    expect(n).toContain("• Sage — no supplier set, order by Tue 6 Oct");
    expect(n).toContain("ticks itself when they all are");
  });
});

describe("orderTickCascade — the order to-do and its ingredient lines tick together", () => {
  const parentKey = "d1:order-new";
  const subKeys = ["d1:order-new-i300", "d1:order-new-i326"];
  it("ticking the parent ticks every line not already ticked", () => {
    expect(orderTickCascade({ key: parentKey, done: true, parentKey, subKeys, doneKeys: new Set(["d1:order-new-i300"]) }))
      .toEqual([{ key: "d1:order-new-i326", done: true }]);
  });
  it("unticking the parent unticks the lines", () => {
    expect(orderTickCascade({ key: parentKey, done: false, parentKey, subKeys, doneKeys: new Set([parentKey, ...subKeys]) }))
      .toEqual(subKeys.map(key => ({ key, done: false })));
  });
  it("the last line ticked ticks the parent; one line short doesn't", () => {
    expect(orderTickCascade({ key: subKeys[1], done: true, parentKey, subKeys, doneKeys: new Set([subKeys[0]]) }))
      .toEqual([{ key: parentKey, done: true }]);
    expect(orderTickCascade({ key: subKeys[0], done: true, parentKey, subKeys, doneKeys: new Set() })).toEqual([]);
  });
  it("unticking a line reopens a ticked parent", () => {
    expect(orderTickCascade({ key: subKeys[0], done: false, parentKey, subKeys, doneKeys: new Set([parentKey, ...subKeys]) }))
      .toEqual([{ key: parentKey, done: false }]);
  });
  it("a key that isn't one of the lines changes nothing", () => {
    expect(orderTickCascade({ key: "d1:order-new-i999", done: true, parentKey, subKeys, doneKeys: new Set() })).toEqual([]);
    expect(orderTickCascade({ key: parentKey, done: true, parentKey, subKeys: [], doneKeys: new Set() })).toEqual([]);
  });
});

describe("milestone to-dos made before 2026-10-08 are cleared", () => {
  it("open ones for prep / production / supplier orders are removed, done ones kept", () => {
    const a = planTodoSync({
      wanted: [w("d1:close-orders")],
      links: [
        { key: "d1:close-orders", done: false, todoId: 1 },
        { key: "d1:prep", done: false, todoId: 2 },
        { key: "d1:order-supplier-4", done: false, todoId: 3 },
        { key: "d1:production", done: true, todoId: 4 },
      ],
      todos: new Map([[1, todo(1, { title: "T d1:close-orders" })], [2, todo(2)], [3, todo(3)], [4, todo(4, { status: "done" })]]),
      ownerId: 5, active: true,
    });
    expect(a).toEqual([{ kind: "remove", key: "d1:prep", todoId: 2 }, { kind: "remove", key: "d1:order-supplier-4", todoId: 3 }]);
  });
});
