import { describe, expect, it } from "vitest";
import { alertToShow, hasGivenUp, isCheckDue, ordersMissingCutoff, type CutoffAlert } from "./dispatch-cutoff-rules";

const today = "2026-11-05";
const order = (id: number, tags: string, at = "2026-11-05T13:54:00Z") => ({ id, name: `#${id}`, tags, created_at: at, customer: { first_name: "Dennis", last_name: "Hunter" } });

describe("when the check runs", () => {
  it("starts at 2:16, not before", () => {
    expect(isCheckDue(14 * 60 + 15)).toBe(false);
    expect(isCheckDue(14 * 60 + 16)).toBe(true);
    expect(hasGivenUp(14 * 60 + 59)).toBe(false);
    expect(hasGivenUp(15 * 60)).toBe(true);
  });
});

describe("ordersMissingCutoff", () => {
  it("finds an order for tomorrow with no dispatch tag", () => {
    expect(ordersMissingCutoff([order(1, "2026-11-06, Friday, Small Box")], today)).toEqual([{
      id: 1, name: "#1", customer: "Dennis Hunter", placedAt: "2026-11-05T13:54:00Z", reason: "Not tagged for dispatch",
    }]);
  });

  it("leaves one that's tagged for dispatch", () => {
    expect(ordersMissingCutoff([order(1, "2026-11-06, dispatch")], today)).toEqual([]);
  });

  it("finds an order placed today with no delivery date", () => {
    expect(ordersMissingCutoff([order(1, "Small Box")], today)[0]?.reason).toBe("No delivery date");
  });

  it("ignores old undated orders, which aren't today's job", () => {
    expect(ordersMissingCutoff([order(1, "Small Box", "2026-10-17T10:00:00Z")], today)).toEqual([]);
  });

  it("ignores orders placed at 2:00 or later, in London time", () => {
    expect(ordersMissingCutoff([order(1, "2026-11-06", "2026-11-05T14:00:00Z")], today)).toEqual([]);
    expect(ordersMissingCutoff([order(1, "2026-07-02", "2026-07-01T13:30:00Z")], "2026-07-01")).toEqual([]);
    expect(ordersMissingCutoff([order(1, "2026-07-02", "2026-07-01T12:30:00Z")], "2026-07-01")).toHaveLength(1);
  });

  it("includes an order placed before today for tomorrow", () => {
    expect(ordersMissingCutoff([order(1, "2026-11-06", "2026-11-04T16:00:00Z")], today)).toHaveLength(1);
  });

  it("ignores later dates and collections", () => {
    expect(ordersMissingCutoff([order(1, "2026-12-23")], today)).toEqual([]);
    expect(ordersMissingCutoff([order(1, "2026-11-06, Collection")], today)).toEqual([]);
  });
});

describe("alertToShow", () => {
  const alert: CutoffAlert = { date: today, orders: [{ id: 1, name: "#1", customer: null, placedAt: "", reason: "x" }], failed: false, closed: false, checkedAt: "" };

  it("shows today's open alert", () => {
    expect(alertToShow(alert, today)).toBe(alert);
  });

  it("is gone once closed, or on another day", () => {
    expect(alertToShow({ ...alert, closed: true }, today)).toBeNull();
    expect(alertToShow(alert, "2026-11-06")).toBeNull();
  });

  it("shows a failed check, which has no orders to list", () => {
    expect(alertToShow({ ...alert, orders: [], failed: true }, today)?.failed).toBe(true);
  });

  it("has nothing to show when every order was fine", () => {
    expect(alertToShow({ ...alert, orders: [] }, today)).toBeNull();
  });
});
