import { describe, expect, it } from "vitest";
import {
  keepRestoredTask, ownListOnly, OWN_TODO_LIST, placeForOpening, placeForPerson, placeFromMemory, TODO_LIST_PAGE, todoIdToRemember,
  todoListTitle, todoPageBack, type TodoDockPlace,
} from "./todo-dock";

const ME = 4;
const LORNA = 9;

describe("todoPageBack", () => {
  it("a to-do and a new to-do go back to the list", () => {
    expect(todoPageBack({ kind: "task", id: 3 })).toEqual(TODO_LIST_PAGE);
    expect(todoPageBack({ kind: "create" })).toEqual(TODO_LIST_PAGE);
    expect(todoPageBack(TODO_LIST_PAGE)).toEqual(TODO_LIST_PAGE);
  });
  it("editing goes back to the to-do", () => {
    expect(todoPageBack({ kind: "edit", id: 3 })).toEqual({ kind: "task", id: 3 });
  });
});

describe("what's remembered", () => {
  it("the to-do you were on, from your own list", () => {
    expect(todoIdToRemember({ viewUserId: null, page: { kind: "task", id: 3 } })).toBe(3);
    expect(todoIdToRemember({ viewUserId: null, page: { kind: "edit", id: 3 } })).toBe(3);
  });
  it("nothing for the list or a new to-do", () => {
    expect(todoIdToRemember(OWN_TODO_LIST)).toBeNull();
    expect(todoIdToRemember({ viewUserId: null, page: { kind: "create" } })).toBeNull();
  });
  it("never a to-do from someone else's list", () => {
    expect(todoIdToRemember({ viewUserId: LORNA, page: { kind: "task", id: 3 } })).toBeNull();
    expect(todoIdToRemember({ viewUserId: LORNA, page: { kind: "edit", id: 3 } })).toBeNull();
  });
});

describe("placeFromMemory (a reload)", () => {
  it("is always your own list", () => {
    expect(placeFromMemory(null)).toEqual(OWN_TODO_LIST);
    expect(placeFromMemory(3)).toEqual({ viewUserId: null, page: { kind: "task", id: 3, restored: true } });
  });
  it("looking at someone else's list, or a to-do of theirs, reloads to your own list", () => {
    const theirs: TodoDockPlace = { viewUserId: LORNA, page: { kind: "task", id: 3 } };
    expect(placeFromMemory(todoIdToRemember(theirs))).toEqual(OWN_TODO_LIST);
    expect(placeFromMemory(todoIdToRemember({ ...theirs, page: TODO_LIST_PAGE }))).toEqual(OWN_TODO_LIST);
  });
});

describe("keepRestoredTask", () => {
  it("stays on your own to-do", () => {
    expect(keepRestoredTask({ assignee_id: ME }, ME)).toBe(true);
  });
  it("leaves one that's gone or isn't yours", () => {
    expect(keepRestoredTask(null, ME)).toBe(false);
    expect(keepRestoredTask(undefined, ME)).toBe(false);
    expect(keepRestoredTask({ assignee_id: LORNA }, ME)).toBe(false);
  });
});

describe("ownListOnly (PIN pad, next sign-in)", () => {
  it("drops someone else's list and the to-do open from it", () => {
    expect(ownListOnly({ viewUserId: LORNA, page: { kind: "task", id: 3 } })).toEqual(OWN_TODO_LIST);
    expect(ownListOnly({ viewUserId: LORNA, page: TODO_LIST_PAGE })).toEqual(OWN_TODO_LIST);
  });
  it("leaves your own where it was", () => {
    const mine: TodoDockPlace = { viewUserId: null, page: { kind: "edit", id: 3 } };
    expect(ownListOnly(mine)).toBe(mine);
  });
  it("keeps everything else about the panel", () => {
    expect(ownListOnly({ viewUserId: LORNA, page: TODO_LIST_PAGE, open: true, listId: 7 })).toEqual({ ...OWN_TODO_LIST, open: true, listId: 7 });
  });
});

describe("opening", () => {
  it("My to-dos opens your own list, on the to-do that's named", () => {
    expect(placeForOpening()).toEqual(OWN_TODO_LIST);
    expect(placeForOpening(null)).toEqual(OWN_TODO_LIST);
    expect(placeForOpening(8)).toEqual({ viewUserId: null, page: { kind: "task", id: 8 } });
  });
  it("a manager's 'whose list': someone else, or yourself", () => {
    expect(placeForPerson(LORNA, ME)).toEqual({ viewUserId: LORNA, page: TODO_LIST_PAGE });
    expect(placeForPerson(ME, ME)).toEqual(OWN_TODO_LIST);
  });
});

describe("todoListTitle", () => {
  it("says whose list it is", () => {
    expect(todoListTitle(null, "Graeme")).toBe("My to-dos");
    expect(todoListTitle(LORNA, "Lorna Smith")).toBe("Lorna Smith's to-dos");
    expect(todoListTitle(LORNA, null)).toBe("Someone else's to-dos");
  });
});
