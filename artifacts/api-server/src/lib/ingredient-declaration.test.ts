import { describe, expect, it } from "vitest";
import { declarationToStore } from "./ingredient-declaration";

describe("declarationToStore — what an ingredient save writes (regression: unwrapped Salted Butter, 12 Oct)", () => {
  it("wraps a bare list under the ingredient's name and says it did", () => {
    expect(declarationToStore("Salted Butter", "Butter (MILK), Salt.")).toEqual({ value: "Salted Butter (Butter (MILK), Salt)", wrapped: true });
  });
  it("wraps under the tidied name", () => {
    expect(declarationToStore("Honey Sriracha (2.5kg catering)", "Sugar, Chilli, Honey").value).toBe("Honey Sriracha (Sugar, Chilli, Honey)");
  });
  it("stores a good declaration as typed", () => {
    expect(declarationToStore("Basil", "Basil")).toEqual({ value: "Basil", wrapped: false });
    expect(declarationToStore("Pepperoni", "Pepperoni (Pork, Salt)")).toEqual({ value: "Pepperoni (Pork, Salt)", wrapped: false });
  });
  it("clears to null and leaves alone when not sent", () => {
    expect(declarationToStore("Basil", "")).toEqual({ value: null, wrapped: false });
    expect(declarationToStore("Basil", null)).toEqual({ value: null, wrapped: false });
    expect(declarationToStore("Basil", undefined)).toEqual({ value: undefined, wrapped: false });
  });
  it("never wraps under a blank name", () => {
    expect(declarationToStore("  ", "Water, Salt")).toEqual({ value: "Water, Salt", wrapped: false });
  });
});
