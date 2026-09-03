import { describe, it, expect } from "vitest";
import { countRows, mergeRows, replaceRow, type ReportRow } from "./booking-report";

interface Row extends ReportRow {
  orderName: string;
  reason?: string;
  waybill?: string;
}

const rows: Row[] = [
  { orderId: 1, orderName: "#133821", status: "booked", waybill: "AAA" },
  { orderId: 2, orderName: "#133823", status: "failed", reason: "Delivery City: Enter a value less than 32 characters long" },
  { orderId: 3, orderName: "#133824", status: "booked", waybill: "BBB" },
  { orderId: 4, orderName: "#133825", status: "skipped", reason: "Local delivery — no courier label" },
];

describe("countRows", () => {
  it("counts each outcome", () => {
    expect(countRows(rows)).toEqual({ booked: 2, skipped: 1, failed: 1, recordErrors: 0 });
  });

  it("counts a booked-but-unsaved consignment as a record error too", () => {
    const withRecordError: Row[] = [
      ...rows,
      { orderId: 5, orderName: "#133826", status: "booked", recordError: "insert failed" },
    ];
    expect(countRows(withRecordError)).toMatchObject({ booked: 3, recordErrors: 1 });
  });

  it("handles an empty report", () => {
    expect(countRows([])).toEqual({ booked: 0, skipped: 0, failed: 0, recordErrors: 0 });
  });
});

describe("mergeRows", () => {
  // The whole point of retry: Graeme shortens an over-long Delivery City in
  // Shopify, presses Retry, and the row that failed becomes the row that
  // booked — in place, with the counters following it.
  it("replaces a retried row and leaves the rest alone", () => {
    const merged = mergeRows(rows, [
      { orderId: 2, orderName: "#133823", status: "booked", waybill: "CCC" },
    ]);
    expect(merged.map(r => r.status)).toEqual(["booked", "booked", "booked", "skipped"]);
    expect(merged[1]).toMatchObject({ orderId: 2, waybill: "CCC" });
    expect(countRows(merged)).toMatchObject({ booked: 3, failed: 0 });
  });

  it("keeps the row in its original position", () => {
    const merged = mergeRows(rows, [{ orderId: 2, orderName: "#133823", status: "booked" }]);
    expect(merged.map(r => r.orderId)).toEqual([1, 2, 3, 4]);
  });

  // A retry that fails again must show the NEW reason. Appending would leave
  // two rows for one order, and the operator would act on the stale one.
  it("replaces the old failure reason rather than adding a second row", () => {
    const merged = mergeRows(rows, [
      { orderId: 2, orderName: "#133823", status: "failed", reason: "Delivery Postcode: invalid" },
    ]);
    expect(merged).toHaveLength(4);
    expect(merged.filter(r => r.orderId === 2)).toHaveLength(1);
    expect(merged[1]!.reason).toBe("Delivery Postcode: invalid");
    expect(countRows(merged)).toMatchObject({ failed: 1 });
  });

  it("retries several failures at once", () => {
    const twoFailed: Row[] = [
      { orderId: 1, orderName: "#1", status: "failed", reason: "city too long" },
      { orderId: 2, orderName: "#2", status: "failed", reason: "no postcode" },
      { orderId: 3, orderName: "#3", status: "booked" },
    ];
    const merged = mergeRows(twoFailed, [
      { orderId: 1, orderName: "#1", status: "booked" },
      { orderId: 2, orderName: "#2", status: "failed", reason: "no postcode" },
    ]);
    expect(countRows(merged)).toMatchObject({ booked: 2, failed: 1 });
  });

  it("ignores an outcome for an order that isn't in the report", () => {
    const merged = mergeRows(rows, [{ orderId: 999, orderName: "#999", status: "booked" }]);
    expect(merged).toHaveLength(4);
    expect(merged).toEqual(rows);
  });

  it("returns the report unchanged when nothing came back", () => {
    expect(mergeRows(rows, [])).toEqual(rows);
  });
});

describe("replaceRow", () => {
  // Regression: rescheduling flipped the row but not the counters, so the red
  // "1 failed" tile stayed up over a row that said rescheduled.
  it("updates the counters when a failure is rescheduled away", () => {
    const after = replaceRow(rows, 2, {
      status: "skipped",
      reason: "Rescheduled — moved off this dispatch day",
    });
    expect(countRows(after)).toMatchObject({ failed: 0, skipped: 2 });
    expect(after[1]).toMatchObject({ orderName: "#133823", status: "skipped" });
  });

  it("leaves every other row untouched", () => {
    const after = replaceRow(rows, 2, { status: "skipped" });
    expect(after[0]).toEqual(rows[0]);
    expect(after[3]).toEqual(rows[3]);
  });
});
