import { describe, it, expect } from "vitest";
import {
  countsByFilter,
  formatPence,
  looksLikeLink,
  matchesSearch,
  poundsInputToPence,
  penceToPoundsInput,
  sortItems,
  visibleItems,
  voteBarPercent,
  voteSpreadLine,
  vatWord,
  type WishListItem,
} from "./wish-list";

function item(id: number, over: Partial<WishListItem> = {}): WishListItem {
  return {
    id, url: null, title: `Item ${id}`, pricePence: null, priceIncludesVat: null, priceExVatPence: null,
    currency: "GBP", imageUrl: null, storeName: null, notes: null, quantity: 1, status: "requested",
    statusNote: null, statusChangedAt: null, statusChangedByName: null, orderedAt: null, orderedByName: null,
    receivedAt: null, createdByName: "Sam", createdAt: `2026-10-${String(10 + id).padStart(2, "0")}T09:00:00Z`,
    mine: false, canEdit: false, votes: { total: 1, people: 1, days: 1, votedToday: false },
    ...over,
  };
}

describe("sortItems", () => {
  const a = item(1, { pricePence: 5000, votes: { total: 2, people: 2, days: 1, votedToday: false } });
  const b = item(2, { pricePence: null, votes: { total: 7, people: 3, days: 4, votedToday: true } });
  const c = item(3, { pricePence: 1200, votes: { total: 2, people: 1, days: 2, votedToday: false } });
  it("most votes first (default), ties by more people", () => {
    expect(sortItems([a, b, c], "votes").map(i => i.id)).toEqual([2, 1, 3]);
  });
  it("newest and oldest", () => {
    expect(sortItems([a, b, c], "newest").map(i => i.id)).toEqual([3, 2, 1]);
    expect(sortItems([a, b, c], "oldest").map(i => i.id)).toEqual([1, 2, 3]);
  });
  it("price either way, unpriced items last", () => {
    expect(sortItems([a, b, c], "price-low").map(i => i.id)).toEqual([3, 1, 2]);
    expect(sortItems([a, b, c], "price-high").map(i => i.id)).toEqual([1, 3, 2]);
  });
  it("doesn't change the list it was given", () => {
    const list = [a, b, c];
    sortItems(list, "newest");
    expect(list.map(i => i.id)).toEqual([1, 2, 3]);
  });
});

describe("filters and search", () => {
  const list = [
    item(1, { status: "requested", title: "Scrubber dryer", storeName: "GGM Gastro" }),
    item(2, { status: "approved", title: "Blue chopping boards" }),
    item(3, { status: "ordered" }),
    item(4, { status: "received" }),
    item(5, { status: "declined" }),
  ];
  it("Open = asked for + approved", () => {
    expect(visibleItems(list, { filter: "open", sort: "oldest", query: "" }).map(i => i.id)).toEqual([1, 2]);
    expect(countsByFilter(list)).toEqual({ open: 2, ordered: 1, received: 1, declined: 1, all: 5 });
  });
  it("search matches every word across title, shop, requester and notes", () => {
    expect(matchesSearch(list[0], "ggm scrubber")).toBe(true);
    expect(matchesSearch(list[0], "ggm boards")).toBe(false);
    expect(matchesSearch(list[0], "sam")).toBe(true);
    expect(matchesSearch(list[0], "  ")).toBe(true);
  });
});

describe("prices", () => {
  it("formats pence for people", () => {
    expect(formatPence(65412)).toBe("£654.12");
    expect(formatPence(120000)).toBe("£1,200");
    expect(formatPence(999, "EUR")).toBe("€9.99");
    expect(formatPence(null)).toBeNull();
  });
  it("reads what people type into the price box", () => {
    expect(poundsInputToPence("£12.50")).toBe(1250);
    expect(poundsInputToPence("1,200")).toBe(120000);
    expect(poundsInputToPence("")).toBeNull();
    expect(poundsInputToPence("about a tenner")).toBeUndefined();
    expect(penceToPoundsInput(1250)).toBe("12.50");
    expect(penceToPoundsInput(1200)).toBe("12");
  });
  it("says inc/ex VAT only when the shop did", () => {
    expect(vatWord(true)).toBe("inc VAT");
    expect(vatWord(false)).toBe("ex VAT");
    expect(vatWord(null)).toBe("");
  });
});

describe("votes bar", () => {
  it("is relative to the top item and never invisible", () => {
    expect(voteBarPercent(10, 10)).toBe(100);
    expect(voteBarPercent(5, 10)).toBe(50);
    expect(voteBarPercent(1, 100)).toBe(6);
    expect(voteBarPercent(0, 10)).toBe(0);
  });
  it("says how widely it's been felt", () => {
    expect(voteSpreadLine({ total: 5, people: 2, days: 3 })).toBe("on 3 different days by 2 people");
    expect(voteSpreadLine({ total: 1, people: 1, days: 1 })).toBe("on 1 day by 1 person");
    expect(voteSpreadLine({ total: 0, people: 0, days: 0 })).toBe("No votes yet");
  });
});

describe("looksLikeLink", () => {
  it("spots pasted links, not typed words", () => {
    expect(looksLikeLink("https://www.ggmgastro.com/en-gb-gbp/x")).toBe(true);
    expect(looksLikeLink("www.amazon.co.uk/dp/B00AB12CDE")).toBe(true);
    expect(looksLikeLink("nisbets.co.uk/tongs")).toBe(true);
    expect(looksLikeLink("new mop bucket")).toBe(false);
    expect(looksLikeLink("mop")).toBe(false);
  });
});
