import { describe, it, expect } from "vitest";
import { searchQboAccounts, type QboPickerAccount } from "./qbo-account-search";

const accounts: QboPickerAccount[] = [
  { id: "1", name: "Advertising", parent: null, type: "Expense" },
  { id: "2", name: "Entertainment", parent: null, type: "Expense" },
  { id: "3", name: "Staff Entertainment", parent: "Staff Costs", type: "Expense" },
  { id: "4", name: "Client entertainment - non-allowable", parent: null, type: "Expense" },
  { id: "5", name: "Food Purchases  TCK Delivered", parent: "Cost of Sales", type: "Cost of Goods Sold" },
  { id: "6", name: "Repairs and Maintenance", parent: null, type: "Expense" },
];

describe("searchQboAccounts", () => {
  it("narrows as you type, any case, best matches first", () => {
    expect(searchQboAccounts(accounts, [], "entertain").map(a => a.id)).toEqual(["2", "3", "4"]);
    expect(searchQboAccounts(accounts, [], "ENT").map(a => a.id)).toEqual(["2", "3", "4"]);
    expect(searchQboAccounts(accounts, [], "e").length).toBe(6);
  });
  it("matches every word in any order, and the parent or type too", () => {
    expect(searchQboAccounts(accounts, [], "entertainment staff").map(a => a.id)).toEqual(["3"]);
    expect(searchQboAccounts(accounts, [], "food tck").map(a => a.id)).toEqual(["5"]);
    expect(searchQboAccounts(accounts, [], "cost of sales").map(a => a.id)).toEqual(["5"]);
    expect(searchQboAccounts(accounts, [], "food   purchases").map(a => a.id)).toEqual(["5"]);
  });
  it("says which are already categories, and puts the showing ones last", () => {
    const out = searchQboAccounts(accounts, [{ id: 10, name: "Entertainment", hidden: false }, { id: 11, name: "staff entertainment", hidden: true }], "entertain");
    expect(out.map(a => a.id)).toEqual(["3", "4", "2"]);
    expect(out[0].category).toEqual({ id: 11, hidden: true });
    expect(out[2].category).toEqual({ id: 10, hidden: false });
    expect(out[1].category).toBeNull();
  });
  it("lists everything with nothing typed, up to the limit", () => {
    expect(searchQboAccounts(accounts, [], "", 4).length).toBe(4);
    expect(searchQboAccounts(accounts, [], "zzz")).toEqual([]);
  });
});
