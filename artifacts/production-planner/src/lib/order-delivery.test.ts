import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { addBusinessDays } from "@workspace/business-days";
import { resolveDeliveryDate, type SupplierDeliveryInfo } from "./order-delivery";

// Wednesday 2 Sept 2026, 14:00 London — comfortably before every cutoff, so
// the lead time is the only thing moving the date.
const NOW = new Date(2026, 8, 2, 14, 0, 0);

const expectedFrom = (leadDays: number) => addBusinessDays(NOW, leadDays);

// Puffin Packaging: 2-day lead, kanban-only. Never in the DPT calculation —
// its items are in no recipe and aren't stock-checked.
const PUFFIN = 31;
const puffinCard = { supplier: { id: PUFFIN, leadTimeDays: 2, cutoffTime: "17:00" } };
const directory = new Map<number, SupplierDeliveryInfo>([
  [PUFFIN, { leadTimeDays: 2, cutoffTime: "17:00" }],
  [26, { leadTimeDays: 2, cutoffTime: "17:00" }],
]);

describe("resolveDeliveryDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("uses the card's lead time", () => {
    expect(resolveDeliveryDate(PUFFIN, [puffinCard], directory, {}))
      .toEqual(expectedFrom(2));
  });

  it("falls back to the supplier directory when there's no card", () => {
    // The regression: placing an order re-looked-up the supplier in the
    // DPT-calculated list only. Packaging suppliers aren't in it, so the lead
    // time went missing and the order was booked for next day.
    expect(resolveDeliveryDate(PUFFIN, [], directory, {}))
      .toEqual(expectedFrom(2));
  });

  it("gives the same date with or without a card, so display can't diverge from placement", () => {
    const shown = resolveDeliveryDate(PUFFIN, [puffinCard], directory, {});
    const placed = resolveDeliveryDate(PUFFIN, [], directory, {});
    expect(placed).toEqual(shown);
  });

  it("lets an operator-set date win over both", () => {
    const chosen = new Date(2026, 8, 10);
    expect(resolveDeliveryDate(PUFFIN, [puffinCard], directory, { [PUFFIN]: chosen }))
      .toBe(chosen);
  });

  it("defaults to a 1-day lead only when the supplier is genuinely unknown", () => {
    expect(resolveDeliveryDate(999, [], directory, {}))
      .toEqual(expectedFrom(1));
  });

  it("adds a day once the supplier's cutoff has passed", () => {
    vi.setSystemTime(new Date(2026, 8, 2, 17, 30, 0));
    const late = resolveDeliveryDate(PUFFIN, [puffinCard], directory, {});
    expect(late).toEqual(addBusinessDays(new Date(2026, 8, 2, 17, 30, 0), 3));
  });
});
