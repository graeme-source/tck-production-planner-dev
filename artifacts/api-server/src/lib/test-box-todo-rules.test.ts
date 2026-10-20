import { describe, it, expect } from "vitest";
import { orderTickCascade } from "./test-box-todo-rules";

describe("orderTickCascade — the order task and its ingredient lines tick together", () => {
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
