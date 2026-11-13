import { describe, it, expect } from "vitest";
import { collectionDateOptions, collectionDateProblem, localDeliveryCollection } from "./local-delivery-collection-rules";

describe("local-delivery collection days", () => {
  it("offers delivery − 3 up to the delivery day, earliest first", () => {
    expect(collectionDateOptions("2026-11-20", "2026-11-13")).toEqual(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  });
  it("never offers a day before today", () => {
    expect(collectionDateOptions("2026-11-14", "2026-11-13")).toEqual(["2026-11-13", "2026-11-14"]);
  });
  it("refuses after delivery, in the past, or more than 3 days early", () => {
    expect(collectionDateProblem("2026-11-20", "2026-11-20", "2026-11-13")).toBeNull();
    expect(collectionDateProblem("2026-11-17", "2026-11-20", "2026-11-13")).toBeNull();
    expect(collectionDateProblem("2026-11-21", "2026-11-20", "2026-11-13")).toMatch(/after the delivery/);
    expect(collectionDateProblem("2026-11-12", "2026-11-14", "2026-11-13")).toMatch(/passed/);
    expect(collectionDateProblem("2026-11-16", "2026-11-20", "2026-11-13")).toMatch(/at most 3 days/);
  });
});

describe("what goods-in sees", () => {
  it("names the order and the customer, one order to tick", () => {
    expect(localDeliveryCollection({ name: "#139600", customerName: "Deli Co" })).toEqual({
      reference: "Local delivery #139600 · Deli Co",
      line: { description: "Wholesale order #139600 for Deli Co — every box labelled #139600", quantity: 1, unit: "order" },
    });
  });
  it("copes with no customer name", () => {
    expect(localDeliveryCollection({ name: "#1", customerName: " " }).reference).toBe("Local delivery #1");
  });
});
