import { describe, it, expect } from "vitest";
import { canEditImprovement, managerOnlyFieldsIn } from "./improvement-stage";

// #309: Kerri-Leigh couldn't remove her own before photo from the after slot.
describe("canEditImprovement", () => {
  it("lets the author edit their own improvement", () => {
    expect(canEditImprovement({ role: "viewer", userId: 7 }, 7)).toBe(true);
  });
  it("refuses another viewer", () => {
    expect(canEditImprovement({ role: "viewer", userId: 8 }, 7)).toBe(false);
  });
  it("lets a manager or admin edit anyone's", () => {
    expect(canEditImprovement({ role: "manager", userId: 8 }, 7)).toBe(true);
    expect(canEditImprovement({ role: "admin", userId: 8 }, null)).toBe(true);
  });
  it("refuses when nobody is logged in or the author is unknown", () => {
    expect(canEditImprovement({ role: "viewer", userId: null }, null)).toBe(false);
    expect(canEditImprovement({ role: "viewer", userId: 7 }, null)).toBe(false);
    expect(canEditImprovement({}, 7)).toBe(false);
  });
});

describe("managerOnlyFieldsIn", () => {
  it("finds management fields an author may not set", () => {
    expect(managerOnlyFieldsIn({ title: "x", assignedTo: null, progressStatus: "complete" }))
      .toEqual(["progressStatus", "assignedTo"]);
  });
  it("is empty for content-only edits", () => {
    expect(managerOnlyFieldsIn({ title: "x", description: "y", notes: "z" })).toEqual([]);
    expect(managerOnlyFieldsIn(undefined)).toEqual([]);
  });
});
