import { describe, it, expect } from "vitest";
import {
  waybillSendDate, apcDateToIso, apcDateTimeSortKey, collectionDateOf, decideConsignmentReuse, decideAcrossRows,
  parseTrackingResponse, judgeTracking, liveStatusFromTracking, applyLiveStatus, staleWaybillProblem,
  consignmentMismatches, usedDateOf, mismatchNotificationText, type LedgerConsignment, type ReuseContext,
} from "./apc-consignment-reuse";

// #136845 — the incident row (apc_consignments id 4967), as it stood on 15 Oct.
const INCIDENT_ROW: LedgerConsignment = {
  waybill: "2026100703036990019775",
  collectionDate: null, // before migration 0205
  createdAt: "2026-10-07T07:16:33Z",
  dispatchTag: "2026-10-08",
  cancelledAt: null, // never marked — the bug
  supersededAt: null,
};

// The live tracking for that waybill, 19 Oct 2026 (statuses only, no PII).
const INCIDENT_TRACKING = {
  Tracks: {
    AccountNumber: "TCK001",
    Messages: { Code: "SUCCESS", Description: "SUCCESS" },
    Track: {
      CollectionDate: "07/10/2026",
      WayBill: "2026100703036990019775",
      Reference: "#136845",
      ShipmentDetails: {
        NumberOfPieces: "1",
        Items: [{
          Item: {
            TrackingNumber: "2026100703036990019775001",
            Activity: [
              { Status: { DateTime: "07/10/2026 08:16:33", StatusCode: "1", StatusDescription: "READY TO PRINT" } },
              { Status: { DateTime: "07/10/2026 08:16:33", StatusCode: "92", StatusDescription: "ORDER CREATED" } },
              { Status: { DateTime: "07/10/2026 08:51:02", StatusCode: "62", StatusDescription: "LABEL PRINTED" } },
              { Status: { DateTime: "07/10/2026 14:43:55", StatusCode: "97", StatusDescription: "CANCELLED" } },
              { Status: { DateTime: "15/10/2026 21:20:15", StatusCode: "70", StatusDescription: "AT HUB" } },
              { Status: { DateTime: "19/10/2026 06:40:34", StatusCode: "149", StatusDescription: "DISPOSED OF" } },
            ],
          },
        }],
      },
    },
  },
};

const PACK_DAY: ReuseContext = { today: "2026-10-15", orderDateTag: "2026-10-16" };

describe("waybill and APC dates", () => {
  it("reads the send date from the waybill's first 8 digits", () => {
    expect(waybillSendDate("2026100703036990019775")).toBe("2026-10-07");
    expect(waybillSendDate("03036990019775")).toBeNull();
    expect(waybillSendDate("2026139903036990019775")).toBeNull(); // month 13
    expect(waybillSendDate(null)).toBeNull();
  });
  it("converts APC's DD/MM/YYYY dates", () => {
    expect(apcDateToIso("07/10/2026")).toBe("2026-10-07");
    expect(apcDateToIso("31/02/2026")).toBeNull();
    expect(apcDateTimeSortKey("15/10/2026 21:20:15")).toBe("2026-10-15T21:20:15");
  });
  it("collection date: stored, else waybill, else London created_at", () => {
    expect(collectionDateOf({ waybill: "x", collectionDate: "2026-10-09", createdAt: null })).toBe("2026-10-09");
    expect(collectionDateOf(INCIDENT_ROW)).toBe("2026-10-07");
    // 23:30 UTC on 14 Oct is 00:30 on the 15th in London (BST).
    expect(collectionDateOf({ waybill: "not-a-waybill", collectionDate: null, createdAt: "2026-10-14T23:30:00Z" })).toBe("2026-10-15");
  });
});

describe("decideConsignmentReuse — the date-and-ledger rule", () => {
  it("REGRESSION #136845: a 7 Oct booking is not reused when packing on 15 Oct", () => {
    const d = decideConsignmentReuse(INCIDENT_ROW, PACK_DAY);
    expect(d.action).toBe("book-new");
    if (d.action !== "book-new") return;
    expect(d.reason).toBe("not-today");
    expect(d.waybill).toBe("2026100703036990019775");
    expect(d.collectionDate).toBe("2026-10-07");
    expect(d.retire).toBe("supersede");
    expect(d.message).toContain("Wed 7 Oct");
  });

  it("reuses today's live booking for the order's current date", () => {
    const row: LedgerConsignment = { ...INCIDENT_ROW, waybill: "2026101503036990011111", dispatchTag: "2026-10-16" };
    expect(decideConsignmentReuse(row, PACK_DAY)).toEqual({ action: "reuse", waybill: row.waybill, collectionDate: "2026-10-15" });
  });

  it("never reuses a cancelled or superseded row", () => {
    const today = { ...INCIDENT_ROW, waybill: "2026101503036990011111", dispatchTag: "2026-10-16" };
    const c = decideConsignmentReuse({ ...today, cancelledAt: "2026-10-15T08:00:00Z" }, PACK_DAY);
    expect(c.action === "book-new" && c.reason).toBe("cancelled");
    expect(c.action === "book-new" && c.retire).toBeNull();
    const s = decideConsignmentReuse({ ...today, supersededAt: "2026-10-15T08:00:00Z" }, PACK_DAY);
    expect(s.action === "book-new" && s.reason).toBe("superseded");
  });

  it("a same-day booking made for another delivery date is not reused", () => {
    const row = { ...INCIDENT_ROW, waybill: "2026101503036990011111", dispatchTag: "2026-10-17" };
    const d = decideConsignmentReuse(row, PACK_DAY);
    expect(d.action === "book-new" && d.reason).toBe("other-delivery-date");
    expect(d.action === "book-new" && d.retire).toBe("supersede");
  });

  it("a row with no dispatch tag (label scan) is judged on the date alone", () => {
    const row = { ...INCIDENT_ROW, waybill: "2026101503036990011111", dispatchTag: null };
    expect(decideConsignmentReuse(row, PACK_DAY).action).toBe("reuse");
  });

  it("no row → book new, nothing to retire", () => {
    const d = decideConsignmentReuse(null, PACK_DAY);
    expect(d.action === "book-new" && d.reason).toBe("no-consignment");
    expect(d.action === "book-new" && d.retire).toBeNull();
  });

  it("across rows: retires the stale ones and reuses today's", () => {
    const today = { ...INCIDENT_ROW, waybill: "2026101503036990011111", dispatchTag: "2026-10-16" };
    const r = decideAcrossRows([today, INCIDENT_ROW], PACK_DAY);
    expect(r.decision.action).toBe("reuse");
    expect(r.retire).toEqual([{ waybill: INCIDENT_ROW.waybill, how: "supersede", message: expect.any(String) }]);
    const only = decideAcrossRows([INCIDENT_ROW], PACK_DAY);
    expect(only.decision.action).toBe("book-new");
  });
});

describe("APC tracking", () => {
  it("parses the live response shape and finds every event", () => {
    const p = parseTrackingResponse(INCIDENT_TRACKING);
    expect(p.found).toBe(true);
    expect(p.collectionDate).toBe("2026-10-07");
    expect(p.events.map(e => e.code)).toEqual(["1", "92", "62", "97", "70", "149"]);
  });

  it("REGRESSION #136845: CANCELLED counts even when a later scan says AT HUB", () => {
    const events = parseTrackingResponse(INCIDENT_TRACKING).events;
    // What APC would have said on the morning of 15 Oct.
    const morning15th = events.filter(e => (e.at ?? "") < "2026-10-15T12:00:00");
    expect(judgeTracking(morning15th).dead).toBe(true);
    expect(judgeTracking(morning15th).deadEvent?.code).toBe("97");
    // And the full history, whose latest event is DISPOSED OF.
    const all = judgeTracking(events);
    expect(all.latest?.description).toBe("DISPOSED OF");
    expect(all.deadEvent?.description).toBe("CANCELLED");
    // A history whose last scan is AT HUB is still dead.
    expect(judgeTracking(events.slice(0, 5)).dead).toBe(true);
  });

  it("a healthy consignment is not dead", () => {
    const j = judgeTracking(parseTrackingResponse(INCIDENT_TRACKING).events.slice(0, 3));
    expect(j.dead).toBe(false);
    expect(j.latest?.description).toBe("LABEL PRINTED");
  });

  it("handles a single Item object and an empty / not-found response", () => {
    const single = { Tracks: { Track: { WayBill: "w", ShipmentDetails: { Items: { Item: { Activity: { Status: { DateTime: "15/10/2026 08:00:00", StatusCode: "97", StatusDescription: "CANCELLED" } } } } } } } };
    expect(judgeTracking(parseTrackingResponse(single).events).dead).toBe(true);
    expect(parseTrackingResponse({ Tracks: { Messages: { Code: "107", Description: "NO TRACK FOUND" } } }).found).toBe(false);
    expect(liveStatusFromTracking(parseTrackingResponse(null)).kind).toBe("not-found");
  });
});

describe("applyLiveStatus", () => {
  const todayRow = { ...INCIDENT_ROW, waybill: "2026101503036990011111", dispatchTag: "2026-10-16" };
  const reuse = decideConsignmentReuse(todayRow, PACK_DAY);

  it("a same-day booking cancelled in APC → mark cancelled and book new", () => {
    const tracking = { Tracks: { Track: { WayBill: todayRow.waybill, CollectionDate: "15/10/2026", ShipmentDetails: { Items: [{ Item: { Activity: [
      { Status: { DateTime: "15/10/2026 07:00:00", StatusCode: "92", StatusDescription: "ORDER CREATED" } },
      { Status: { DateTime: "15/10/2026 07:30:00", StatusCode: "97", StatusDescription: "CANCELLED" } },
    ] } }] } } } };
    const d = applyLiveStatus(reuse, liveStatusFromTracking(parseTrackingResponse(tracking)), PACK_DAY);
    expect(d.action === "book-new" && d.reason).toBe("dead-in-apc");
    expect(d.action === "book-new" && d.retire).toBe("cancel");
    expect(d.action === "book-new" && d.message).toContain("CANCELLED");
  });

  it("APC down → still reused on the date rule, with a warning (never blocks packing)", () => {
    const d = applyLiveStatus(reuse, { kind: "unreachable", error: "timeout" }, PACK_DAY);
    expect(d.action).toBe("reuse");
    expect(d.action === "reuse" && d.warning).toContain("timeout");
  });

  it("no tracking yet → reused", () => {
    expect(applyLiveStatus(reuse, { kind: "not-found" }, PACK_DAY).action).toBe("reuse");
  });

  it("APC's own collection date wins over ours", () => {
    const d = applyLiveStatus(reuse, { kind: "ok", dead: false, deadEvent: null, latest: null, collectionDate: "2026-10-14" }, PACK_DAY);
    expect(d.action === "book-new" && d.reason).toBe("not-today");
  });

  it("leaves a book-new alone", () => {
    const bookNew = decideConsignmentReuse(INCIDENT_ROW, PACK_DAY);
    expect(applyLiveStatus(bookNew, { kind: "unreachable", error: "x" }, PACK_DAY)).toBe(bookNew);
  });
});

describe("staleWaybillProblem — the print / push-to-Shopify guard", () => {
  it("REGRESSION #136845: refuses to push the 7 Oct waybill on 15 Oct", () => {
    const p = staleWaybillProblem(INCIDENT_ROW.waybill, INCIDENT_ROW, "2026-10-15");
    expect(p).toContain("Wed 7 Oct");
    expect(p).toContain("open it again");
  });
  it("refuses cancelled and superseded rows even on their own day", () => {
    const row = { ...INCIDENT_ROW, collectionDate: "2026-10-15" };
    expect(staleWaybillProblem(row.waybill, { ...row, cancelledAt: new Date(), cancelledReason: "cancelled in APC" }, "2026-10-15")).toContain("cancelled in APC");
    expect(staleWaybillProblem(row.waybill, { ...row, supersededAt: new Date(), supersededReason: "rescheduled" }, "2026-10-15")).toContain("replaced (rescheduled)");
  });
  it("allows today's booking, and an unknown waybill with no date", () => {
    expect(staleWaybillProblem("2026101503036990011111", null, "2026-10-15")).toBeNull();
    expect(staleWaybillProblem("not-a-waybill", null, "2026-10-15")).toBeNull();
    expect(staleWaybillProblem("2026101403036990011111", null, "2026-10-15")).not.toBeNull();
  });
});

describe("consignmentMismatches — the daily check", () => {
  const base = {
    ...INCIDENT_ROW,
    orderId: 13597182198134,
    orderName: "#136845",
    labelPrintedAt: "2026-10-07T07:51:02Z",
    pushedToShopifyAt: "2026-10-15T09:13:00Z",
    apcStatus: null,
    apcDeadStatus: null,
  };
  it("REGRESSION #136845 would appear: booked 7 Oct, pushed 15 Oct", () => {
    expect(usedDateOf(base)).toBe("2026-10-15");
    expect(consignmentMismatches(base)).toEqual(["collected-other-day"]);
    expect(consignmentMismatches({ ...base, apcDeadStatus: "CANCELLED (07/10/2026 14:43:55)" })).toEqual(["collected-other-day", "dead-in-apc"]);
  });
  it("a same-day booking pushed the same day is fine", () => {
    const ok = { ...base, waybill: "2026101503036990011111", collectionDate: "2026-10-15", labelPrintedAt: "2026-10-15T08:00:00Z" };
    expect(consignmentMismatches(ok)).toEqual([]);
  });
  it("flags a push after our own cancel/supersede", () => {
    const row = { ...base, collectionDate: "2026-10-15", cancelledAt: "2026-10-15T08:00:00Z" };
    expect(consignmentMismatches(row)).toEqual(["retired-in-ledger"]);
  });
  it("notification text names the orders", () => {
    expect(mismatchNotificationText([{ orderName: "#136845", waybill: "w" }])).toContain("1 order went out");
    expect(mismatchNotificationText([{ orderName: "#136845", waybill: "w" }])).toContain("#136845");
    const many = Array.from({ length: 6 }, (_, i) => ({ orderName: `#${i}`, waybill: "w" }));
    expect(mismatchNotificationText(many)).toContain("and 2 more");
  });
});
