import { describe, expect, it } from "vitest";
import {
  CLOSED_DOCK, createPlanListId, dialogDockMode, dockChoices, dockLayout, dockStorageKey, parseLegacyListId, parseStoredDock, resolveDockListId, serializeDock,
  type StoredDock,
} from "./team-list-dock";

describe("dockLayout", () => {
  it("is a sheet on a phone", () => {
    expect(dockLayout(375)).toEqual({ mode: "sheet", width: null });
    expect(dockLayout(767)).toEqual({ mode: "sheet", width: null });
  });
  it("docks narrower at iPad width", () => {
    expect(dockLayout(768)).toEqual({ mode: "dock", width: 320 });
    expect(dockLayout(810)).toEqual({ mode: "dock", width: 320 });
  });
  it("docks at full width on a desktop", () => {
    expect(dockLayout(1024)).toEqual({ mode: "dock", width: 360 });
    expect(dockLayout(1920)).toEqual({ mode: "dock", width: 360 });
  });
});

describe("dialogDockMode", () => {
  it("slides over the dialog on an iPad, sits beside the plan on a desktop", () => {
    expect(dialogDockMode(810)).toBe("overlay");
    expect(dialogDockMode(1279)).toBe("overlay");
    expect(dialogDockMode(1280)).toBe("column");
  });
});

describe("parseStoredDock", () => {
  it("is closed when nothing is stored or it's junk", () => {
    expect(parseStoredDock(null)).toEqual(CLOSED_DOCK);
    expect(parseStoredDock("")).toEqual(CLOSED_DOCK);
    expect(parseStoredDock("{nope")).toEqual(CLOSED_DOCK);
    expect(parseStoredDock("42")).toEqual(CLOSED_DOCK);
    expect(parseStoredDock("null")).toEqual(CLOSED_DOCK);
  });
  it("round-trips", () => {
    const s: StoredDock = { open: true, view: "list", listId: 7, todoId: null };
    expect(parseStoredDock(serializeDock(s))).toEqual(s);
    expect(parseStoredDock(serializeDock({ ...CLOSED_DOCK, listId: 3 }))).toEqual({ ...CLOSED_DOCK, listId: 3 });
  });
  it("can't show a team list without a valid one", () => {
    expect(parseStoredDock(JSON.stringify({ open: true, listId: null }))).toEqual(CLOSED_DOCK);
    expect(parseStoredDock(JSON.stringify({ open: true, listId: -1 }))).toEqual(CLOSED_DOCK);
    expect(parseStoredDock(JSON.stringify({ open: true, listId: 2.5 }))).toEqual(CLOSED_DOCK);
    expect(parseStoredDock(JSON.stringify({ open: "yes", listId: 4 }))).toEqual({ ...CLOSED_DOCK, listId: 4 });
  });
  it("reads what devices already have saved (no view) as a team list", () => {
    expect(parseStoredDock('{"open":true,"listId":7}')).toEqual({ open: true, view: "list", listId: 7, todoId: null });
  });
  it("reopens on My to-dos, with no team list needed, and keeps the team list for later", () => {
    const s: StoredDock = { open: true, view: "todos", listId: null, todoId: null };
    expect(parseStoredDock(serializeDock(s))).toEqual(s);
    expect(parseStoredDock(serializeDock({ ...s, listId: 7 }))).toEqual({ ...s, listId: 7 });
  });
  it("reopens on the to-do it was on", () => {
    const s: StoredDock = { open: true, view: "todos", listId: 7, todoId: 41 };
    expect(parseStoredDock(serializeDock(s))).toEqual(s);
  });
  it("forgets the to-do when shut or on a team list, and junk ids", () => {
    const s: StoredDock = { open: true, view: "todos", listId: 7, todoId: 41 };
    expect(parseStoredDock(serializeDock({ ...s, open: false })).todoId).toBeNull();
    expect(parseStoredDock(serializeDock({ ...s, view: "list" })).todoId).toBeNull();
    expect(parseStoredDock(JSON.stringify({ ...s, view: "list" })).todoId).toBeNull();
    expect(parseStoredDock(JSON.stringify({ ...s, todoId: "41" })).todoId).toBeNull();
  });
  it("never writes whose list is being looked at", () => {
    const s = { open: true, view: "todos", listId: 7, todoId: null, viewUserId: 12345 } as StoredDock;
    expect(serializeDock(s)).not.toContain("12345");
  });
});

describe("parseLegacyListId", () => {
  it("reads the old Create Plan pop-out's list", () => {
    expect(parseLegacyListId("12")).toBe(12);
    expect(parseLegacyListId(null)).toBeNull();
    expect(parseLegacyListId("0")).toBeNull();
    expect(parseLegacyListId("abc")).toBeNull();
  });
});

describe("dockStorageKey", () => {
  it("is per person", () => {
    expect(dockStorageKey(5)).not.toBe(dockStorageKey(6));
  });
});

describe("resolveDockListId", () => {
  const lists = [{ id: 3 }, { id: 9, archived: true }, { id: 4 }];
  it("keeps the remembered list while it's still open to this person", () => {
    expect(resolveDockListId(4, lists)).toBe(4);
  });
  it("falls back to the first live list", () => {
    expect(resolveDockListId(99, lists)).toBe(3);
    expect(resolveDockListId(null, lists)).toBe(3);
    expect(resolveDockListId(9, lists)).toBe(3);
  });
  it("is none when there are no lists", () => {
    expect(resolveDockListId(3, [])).toBeNull();
  });
});

describe("dockChoices (the panel's switcher)", () => {
  const lists = [{ id: 3, name: "Production planner", emoji: "📋" }, { id: 4, name: "Marketing", emoji: null }];
  it("offers My to-dos and the other team lists while on a team list", () => {
    expect(dockChoices(3, lists)).toEqual([{ value: "todos", label: "My to-dos" }, { value: 4, label: "Marketing" }]);
  });
  it("offers every team list while on My to-dos", () => {
    expect(dockChoices("todos", lists)).toEqual([{ value: 3, label: "📋 Production planner" }, { value: 4, label: "Marketing" }]);
  });
  it("offers nothing to someone with no team lists", () => {
    expect(dockChoices("todos", [])).toEqual([]);
  });
});

describe("createPlanListId", () => {
  const lists = [
    { id: 7, name: "Marketing", sortOrder: 2 },
    { id: 1, name: "Production Flow Manager", sortOrder: 0 },
    { id: 5, name: "Old", sortOrder: -1, archived: true },
    { id: 3, name: "Cleaning", sortOrder: 1 },
  ];
  it("opens the list the setting names", () => {
    expect(createPlanListId("3", lists)).toBe(3);
    expect(createPlanListId(" 7 ", lists)).toBe(7);
  });
  it("falls back to the first live list by sort order, not the order given", () => {
    expect(createPlanListId(null, lists)).toBe(1);
    expect(createPlanListId(undefined, lists)).toBe(1);
    expect(createPlanListId("", lists)).toBe(1);
  });
  it("ignores a setting naming an archived, unknown or nonsense list", () => {
    expect(createPlanListId("5", lists)).toBe(1);
    expect(createPlanListId("99", lists)).toBe(1);
    expect(createPlanListId("abc", lists)).toBe(1);
    expect(createPlanListId("1.5", lists)).toBe(1);
  });
  it("breaks sort-order ties by name", () => {
    expect(createPlanListId(null, [{ id: 2, name: "B", sortOrder: 0 }, { id: 9, name: "A", sortOrder: 0 }])).toBe(9);
  });
  it("is none when the person has no live lists", () => {
    expect(createPlanListId("1", [])).toBeNull();
    expect(createPlanListId(null, [{ id: 5, archived: true }])).toBeNull();
  });
});
