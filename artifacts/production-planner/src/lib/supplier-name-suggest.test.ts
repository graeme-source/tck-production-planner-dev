import { describe, it, expect } from "vitest";
import { cleanLink, didYouMean, matchSupplierNames } from "./supplier-name-suggest";

const names = [
  { name: "Amazon", count: 90 }, { name: "Klaviyo Inc", count: 12 }, { name: "Vonage", count: 12 },
  { name: "Costco Wholesale UK", count: 8 }, { name: "Ducting Express Services Ltd", count: 2 },
];

describe("matchSupplierNames", () => {
  it("offers names as you type, starts first", () => {
    expect(matchSupplierNames(names, "kl").map((n) => n.name)).toEqual(["Klaviyo Inc"]);
    expect(matchSupplierNames(names, "express").map((n) => n.name)).toEqual(["Ducting Express Services Ltd"]);
    expect(matchSupplierNames(names, "wholesale").map((n) => n.name)).toEqual(["Costco Wholesale UK"]);
    expect(matchSupplierNames(names, "k")).toEqual([]);
  });
});

describe("didYouMean", () => {
  it("spots Klayvio for Klaviyo", () => {
    expect(didYouMean(names, "Klayvio")).toBe("Klaviyo Inc");
    expect(didYouMean(names, "klaviyo")).toBeNull();
    expect(didYouMean(names, "Vonnage")).toBe("Vonage");
  });
  it("leaves real different names alone", () => {
    expect(didYouMean(names, "Costa Coffee")).toBeNull();
    expect(didYouMean(names, "Brakes")).toBeNull();
    expect(didYouMean(names, "Amaz")).toBeNull();
  });
});

describe("cleanLink", () => {
  it("adds https and refuses non-links", () => {
    expect(cleanLink(" secure.vonage.co.uk/account ")).toBe("https://secure.vonage.co.uk/account");
    expect(cleanLink("https://x.com/a")).toBe("https://x.com/a");
    expect(cleanLink("not a link")).toBeNull();
    expect(cleanLink("localhost")).toBeNull();
    expect(cleanLink("")).toBeNull();
  });
});
