import { describe, it, expect } from "vitest";
import {
  toggleCreditId, isLockedCredit, orderCreditPeople, creditLabel, isCreditedTo, creditIds,
} from "./improvement-credits";

describe("toggleCreditId", () => {
  it("adds someone who wasn't ticked, at the end", () => {
    expect(toggleCreditId([1], 2)).toEqual([1, 2]);
  });

  it("removes someone who was ticked", () => {
    expect(toggleCreditId([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("never removes the last person — no improvement is credited to nobody", () => {
    expect(toggleCreditId([1], 1)).toEqual([1]);
  });

  it("lets the recorder step aside once someone else is ticked", () => {
    expect(toggleCreditId([1, 2], 1)).toEqual([2]);
  });

  it("adds to an empty list (an idea nobody is credited on yet)", () => {
    expect(toggleCreditId([], 4)).toEqual([4]);
  });
});

describe("isLockedCredit", () => {
  it("is true only for the one remaining ticked person", () => {
    expect(isLockedCredit([1], 1)).toBe(true);
    expect(isLockedCredit([1, 2], 1)).toBe(false);
    expect(isLockedCredit([1], 2)).toBe(false);
    expect(isLockedCredit([], 1)).toBe(false);
  });
});

describe("orderCreditPeople", () => {
  const people = [
    { id: 1, name: "Graeme" },
    { id: 2, name: "Bodan" },
    { id: 3, name: "Lorna" },
    { id: 4, name: "Amy" },
  ];

  it("puts the ticked people first in ticked order, then everyone else A–Z", () => {
    expect(orderCreditPeople(people, [3, 1]).map(p => p.name)).toEqual(["Lorna", "Graeme", "Amy", "Bodan"]);
  });

  it("filters the unticked by name but never hides a ticked person", () => {
    expect(orderCreditPeople(people, [1], "bo").map(p => p.name)).toEqual(["Graeme", "Bodan"]);
  });

  it("skips ticked ids that aren't on the list (e.g. a deactivated user)", () => {
    expect(orderCreditPeople(people, [99, 2]).map(p => p.id)).toEqual([2, 4, 1, 3]);
  });
});

describe("creditLabel", () => {
  it("names everyone credited when the server joined them", () => {
    expect(creditLabel({ creditNames: "Graeme & Bodan", creditedToName: "Graeme", submittedByName: "Graeme" }))
      .toBe("Graeme & Bodan");
  });

  it("falls back to the lead, then whoever logged it, then null", () => {
    expect(creditLabel({ creditNames: null, creditedToName: "Lorna", submittedByName: "Graeme" })).toBe("Lorna");
    expect(creditLabel({ creditNames: null, creditedToName: null, submittedByName: "Graeme" })).toBe("Graeme");
    expect(creditLabel({})).toBeNull();
  });
});

describe("isCreditedTo / creditIds", () => {
  const item = { credits: [{ userId: 1, name: "Graeme" }, { userId: 2, name: "Bodan" }] };
  it("counts every credited person, not just the first", () => {
    expect(isCreditedTo(item, 1)).toBe(true);
    expect(isCreditedTo(item, 2)).toBe(true);
    expect(isCreditedTo(item, 3)).toBe(false);
    expect(isCreditedTo(item, null)).toBe(false);
    expect(isCreditedTo({}, 1)).toBe(false);
  });
  it("lists the ids lead first", () => {
    expect(creditIds(item)).toEqual([1, 2]);
    expect(creditIds({})).toEqual([]);
  });
});
