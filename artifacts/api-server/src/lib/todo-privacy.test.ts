import { describe, it, expect } from "vitest";
import { isPrivateTodo } from "./todo-privacy";

describe("isPrivateTodo", () => {
  it("keeps employment-record to-dos private", () => {
    expect(isPrivateTodo({ url: "/return-to-work?u=5&s=2026-11-01", created_by_name: "Return to work" })).toBe(true);
    expect(isPrivateTodo({ url: "/people/22?entry=9" })).toBe(true);
    expect(isPrivateTodo({ url: "/people", created_by_name: "HR" })).toBe(true);
    expect(isPrivateTodo({ url: null, created_by_name: "Probation reminder" })).toBe(true);
  });
  it("leaves ordinary work to-dos open to managers", () => {
    expect(isPrivateTodo({ url: "/orders", created_by_name: "Graeme Carter" })).toBe(false);
    expect(isPrivateTodo({ url: "/reports?tab=haccp&haccp=incidents&incident=4" })).toBe(false);
    expect(isPrivateTodo({ url: "/peoples-choice" })).toBe(false);
    expect(isPrivateTodo({})).toBe(false);
  });
});
