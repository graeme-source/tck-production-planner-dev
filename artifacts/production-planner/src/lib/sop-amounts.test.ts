import { describe, it, expect } from "vitest";
import { splitStepWithAmounts, type SopAmount } from "./sop-amounts";

// Test data only — the helper itself holds no ingredient names.
const beef: SopAmount = { name: "Diced Beef", amountText: "12.000 kg" };
const plainBeef: SopAmount = { name: "Beef", amountText: "3.000 kg" };
const onion: SopAmount = { name: "Onion", amountText: "800 g" };
const tomatoes: SopAmount = { name: "Tomatoes", amountText: "2.500 kg" };
const salt: SopAmount = { name: "Salt", amountText: "45 g" };

const render = (r: ReturnType<typeof splitStepWithAmounts>) =>
  r.segments.map(s => (s.kind === "text" ? s.text : `${s.text}[${s.amount.amountText}]`)).join("");

describe("splitStepWithAmounts", () => {
  it("places the amount right after the ingredient name, case-insensitively", () => {
    const r = splitStepWithAmounts("Weigh the diced beef into the tray.", [beef]);
    expect(render(r)).toBe("Weigh the diced beef[12.000 kg] into the tray.");
    expect(r.mentioned).toEqual([beef]);
  });

  it("prefers the longest name: Diced Beef beats Beef", () => {
    const r = splitStepWithAmounts("Add the Diced Beef, then the beef stock.", [plainBeef, beef]);
    expect(render(r)).toBe("Add the Diced Beef[12.000 kg], then the beef[3.000 kg] stock.");
    expect(r.mentioned).toEqual([beef, plainBeef]);
  });

  it("never matches inside another word", () => {
    const r = splitStepWithAmounts("Use the saltire tray; desalted is fine. Add salt.", [salt]);
    expect(render(r)).toBe("Use the saltire tray; desalted is fine. Add salt[45 g].");
  });

  it("tolerates simple plurals in both directions", () => {
    expect(render(splitStepWithAmounts("Slice the onions thinly.", [onion]))).toBe("Slice the onions[800 g] thinly.");
    expect(render(splitStepWithAmounts("Add one tomato at a time.", [tomatoes]))).toBe("Add one tomato[2.500 kg] at a time.");
  });

  it("tolerates different spacing inside a multi-word name", () => {
    expect(render(splitStepWithAmounts("Add diced\nbeef now", [beef]))).toBe("Add diced\nbeef[12.000 kg] now");
  });

  it("marks every mention but lists each amount once", () => {
    const r = splitStepWithAmounts("Salt the water. Taste, add more salt if needed.", [salt]);
    expect(r.segments.filter(s => s.kind === "amount")).toHaveLength(2);
    expect(r.mentioned).toEqual([salt]);
  });

  it("leaves a step with no ingredient names untouched", () => {
    const r = splitStepWithAmounts("Wash your hands.", [beef, salt]);
    expect(r.segments).toEqual([{ kind: "text", text: "Wash your hands." }]);
    expect(r.mentioned).toEqual([]);
  });

  it("copes with no amounts, empty text and regex characters in names", () => {
    expect(splitStepWithAmounts("Stir.", []).segments).toEqual([{ kind: "text", text: "Stir." }]);
    expect(splitStepWithAmounts("", [salt])).toEqual({ segments: [], mentioned: [] });
    const odd: SopAmount = { name: "Salt (fine)", amountText: "10 g" };
    expect(render(splitStepWithAmounts("Add Salt (fine) last.", [odd]))).toBe("Add Salt (fine)[10 g] last.");
  });

  it("ignores blank names and keeps the first of duplicate names", () => {
    const dupe: SopAmount = { name: "salt", amountText: "99 g" };
    const r = splitStepWithAmounts("Add salt.", [{ name: "  ", amountText: "1 g" }, salt, dupe]);
    expect(render(r)).toBe("Add salt[45 g].");
  });
});
