import { describe, it, expect } from "vitest";
import {
  openOrdersForSupplier,
  orderTargetFor,
  placedOrderEditState,
  showsPendingCard,
  kanbansToPutBack,
  type OpenOrderLike,
} from "./supplier-order-target";

const PLAN = 135;
const SUPPLIER = 7;
const OTHER = 9;

const po = (id: number, over: Partial<OpenOrderLike> = {}): OpenOrderLike => ({
  id,
  supplierId: SUPPLIER,
  planId: PLAN,
  status: "placed",
  expectedDeliveryDate: "2026-10-23",
  ...over,
});

describe("openOrdersForSupplier", () => {
  it("lists every placed order for the supplier on the plan, soonest delivery first", () => {
    const orders = [
      po(12, { expectedDeliveryDate: "2026-10-27" }),
      po(10, { expectedDeliveryDate: "2026-10-23" }),
      po(11, { expectedDeliveryDate: null }),
    ];
    expect(openOrdersForSupplier(orders, SUPPLIER, PLAN).map(o => o.id)).toEqual([10, 12, 11]);
  });

  it("leaves out received orders, drafts, other suppliers and other plans", () => {
    const orders = [
      po(1),
      po(2, { status: "received" }),
      po(3, { status: "draft" }),
      po(4, { supplierId: OTHER }),
      po(5, { planId: 999 }),
    ];
    expect(openOrdersForSupplier(orders, SUPPLIER, PLAN).map(o => o.id)).toEqual([1]);
  });

  it("keeps two orders on the same day apart, oldest first", () => {
    expect(openOrdersForSupplier([po(21), po(20)], SUPPLIER, PLAN).map(o => o.id)).toEqual([20, 21]);
  });
});

describe("showsPendingCard", () => {
  const base = { placed: false, reopened: false, separate: false, lockedOpenPo: false };

  it("shows the card when nothing is placed yet (normal single order, unchanged)", () => {
    expect(showsPendingCard(base)).toBe(true);
  });
  it("hides the supplier once its order is placed", () => {
    expect(showsPendingCard({ ...base, placed: true })).toBe(false);
  });
  it("shows it again while that order is being edited", () => {
    expect(showsPendingCard({ ...base, placed: true, reopened: true })).toBe(true);
  });
  it("keeps showing pulled kanbans not yet ordered, even after the supplier's order is placed (regression, 28 Oct 2026)", () => {
    expect(showsPendingCard({ ...base, placed: true, queuedKanbans: true })).toBe(true);
    expect(showsPendingCard({ ...base, placed: true, queuedKanbans: false })).toBe(false);
  });
  it("shows it for a separate second order", () => {
    expect(showsPendingCard({ ...base, placed: true, separate: true })).toBe(true);
  });
  it("shows it when the placed order is past its cutoff and new needs came up", () => {
    expect(showsPendingCard({ ...base, placed: true, lockedOpenPo: true })).toBe(true);
  });
});

describe("orderTargetFor — which order a new line joins", () => {
  it("joins the in-progress card without asking", () => {
    expect(orderTargetFor(true, [po(1)])).toEqual({ kind: "card" });
  });
  it("starts the first order when nothing is placed", () => {
    expect(orderTargetFor(false, [])).toEqual({ kind: "card" });
  });
  it("asks when the supplier already has a placed order and no card", () => {
    const target = orderTargetFor(false, [po(1)]);
    expect(target.kind).toBe("choose");
    if (target.kind === "choose") expect(target.orders.map(o => o.id)).toEqual([1]);
  });
  it("offers every placed order when there are two", () => {
    const target = orderTargetFor(false, [po(1), po(2, { expectedDeliveryDate: "2026-10-27" })]);
    expect(target.kind === "choose" ? target.orders.map(o => o.id) : []).toEqual([1, 2]);
  });
});

describe("placedOrderEditState — keyed by order, not supplier", () => {
  it("marks only the order actually being edited", () => {
    const reopened = { [SUPPLIER]: { id: 10 } };
    expect(placedOrderEditState(po(10), reopened, new Set())).toBe("editing");
    // The supplier's OTHER order is not "being edited" — it just has to wait.
    expect(placedOrderEditState(po(11), reopened, new Set())).toBe("supplier-busy");
  });
  it("is busy while a separate new order for the supplier is in progress", () => {
    expect(placedOrderEditState(po(10), {}, new Set([SUPPLIER]))).toBe("supplier-busy");
  });
  it("is free otherwise, and other suppliers are unaffected", () => {
    expect(placedOrderEditState(po(10), {}, new Set())).toBe("free");
    expect(placedOrderEditState(po(30, { supplierId: OTHER }), { [SUPPLIER]: { id: 10 } }, new Set([SUPPLIER]))).toBe("free");
  });
});

describe("kanbansToPutBack", () => {
  it("puts back every pulled kanban on a dismissed card, once each, and nothing else (regression, 28 Oct 2026)", () => {
    expect(kanbansToPutBack([
      { ingredientId: 334, isKanban: true },
      { ingredientId: 334, isKanban: true },
      { ingredientId: 12, isKanban: false },
      { ingredientId: -1, isKanban: true },
    ])).toEqual([334]);
  });
});
