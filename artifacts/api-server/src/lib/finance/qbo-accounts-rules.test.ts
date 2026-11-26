import { describe, it, expect } from "vitest";
import { qboAccountsForPicker } from "./qbo-accounts-rules";

describe("qboAccountsForPicker", () => {
  it("keeps QuickBooks' exact names, spending accounts first, with the parent of a sub-account", () => {
    const out = qboAccountsForPicker([
      { Id: "9", Name: "Business Current Account", AccountType: "Bank" },
      { Id: "3", Name: "Food Purchases  TCK Delivered", FullyQualifiedName: "Cost of Sales:Food Purchases  TCK Delivered", AccountType: "CostofGoodsSold" },
      { Id: "5", Name: "Staff Entertainment", AccountType: "Expense" },
      { Id: "6", Name: "Advertising", AccountType: "Expense" },
    ]);
    expect(out.map(a => a.name)).toEqual(["Advertising", "Staff Entertainment", "Food Purchases  TCK Delivered", "Business Current Account"]);
    expect(out[2]).toEqual({ id: "3", name: "Food Purchases  TCK Delivered", parent: "Cost of Sales", type: "Cost of Goods Sold" });
    expect(out[0].parent).toBeNull();
  });
  it("drops inactive, nameless and repeated accounts", () => {
    expect(qboAccountsForPicker([
      { Id: "1", Name: "Old", Active: false, AccountType: "Expense" },
      { Id: "2", Name: " ", AccountType: "Expense" },
      { Id: "3", Name: "Rent", AccountType: "Expense" },
      { Id: "3", Name: "Rent", AccountType: "Expense" },
    ]).map(a => a.id)).toEqual(["3"]);
  });
});
