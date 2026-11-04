import { describe, it, expect } from "vitest";
import { keyboardClosed, opensKeyboard } from "./keyboard-resnap";

// #382: the station bottom bar stayed stuck part-way up the iPad screen after
// the on-screen keyboard closed.
describe("keyboardClosed", () => {
  it("is true when the visible area grows by a keyboard's height", () => {
    expect(keyboardClosed(500, 810)).toBe(true);
    expect(keyboardClosed(690, 810)).toBe(true);
  });

  it("ignores the address bar showing or hiding", () => {
    expect(keyboardClosed(760, 810)).toBe(false);
  });

  it("ignores the keyboard opening", () => {
    expect(keyboardClosed(810, 500)).toBe(false);
  });
});

describe("opensKeyboard", () => {
  it("is true for typing boxes", () => {
    expect(opensKeyboard({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(opensKeyboard({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(opensKeyboard({ tagName: "INPUT" })).toBe(true);
    expect(opensKeyboard({ tagName: "TEXTAREA" })).toBe(true);
    expect(opensKeyboard({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for anything tapped without typing", () => {
    expect(opensKeyboard({ tagName: "BUTTON" })).toBe(false);
    expect(opensKeyboard({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(opensKeyboard({ tagName: "DIV" })).toBe(false);
    expect(opensKeyboard(null)).toBe(false);
  });
});
