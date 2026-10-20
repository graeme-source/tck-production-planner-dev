import { describe, expect, it } from "vitest";
import {
  CLOSED_DOCK, dialogDockMode, dockLayout, dockStorageKey, parseLegacyListId, parseStoredDock, resolveDockListId, serializeDock,
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
    const s = { open: true, listId: 7 };
    expect(parseStoredDock(serializeDock(s))).toEqual(s);
    expect(parseStoredDock(serializeDock({ open: false, listId: 3 }))).toEqual({ open: false, listId: 3 });
  });
  it("can't be open without a valid list", () => {
    expect(parseStoredDock(JSON.stringify({ open: true, listId: null }))).toEqual({ open: false, listId: null });
    expect(parseStoredDock(JSON.stringify({ open: true, listId: -1 }))).toEqual({ open: false, listId: null });
    expect(parseStoredDock(JSON.stringify({ open: true, listId: 2.5 }))).toEqual({ open: false, listId: null });
    expect(parseStoredDock(JSON.stringify({ open: "yes", listId: 4 }))).toEqual({ open: false, listId: 4 });
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
