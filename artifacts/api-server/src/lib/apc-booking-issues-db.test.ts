/**
 * Regression: reopening the booking-issues report must NOT call APC
 * (Graeme, 2026-10-09 — the only way back to the report used to be booking
 * the failed orders again). The database and the postcode context are
 * replaced with fakes; every APC function is a spy that must stay untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apc = vi.hoisted(() => ({
  createShipment: vi.fn(), addParcel: vi.fn(), cancelShipment: vi.fn(), fetchLabel: vi.fn(),
  checkPostcodeService: vi.fn(), lookupOrderByReference: vi.fn(), lookupOrdersByReference: vi.fn(), lookupOrderByWaybill: vi.fn(),
}));
const dbExecute = vi.hoisted(() => vi.fn());

vi.mock("../services/apc", () => apc);
vi.mock("@workspace/db", () => ({ db: { execute: dbExecute } }));
vi.mock("./apc-postcode-context", () => ({ loadPostcodeContext: vi.fn(async () => ({ overrides: [], contact: null })) }));

import { loadTodayReport } from "./apc-booking-issues-db";

const row = (over: Record<string, unknown> = {}) => ({
  id: 1, report_date: "2026-10-09", dispatch_tag: "2026-10-10", shopify_order_id: "6100000000001",
  order_name: "#1234", admin_url: "https://admin.shopify.com/store/x/orders/6100000000001",
  customer_name: "Jane Smith", customer_first_name: "Jane", customer_email: "jane@example.com",
  postcode: "KA3 1AB", reason: "NO Services available", used_service_code: "SAT", suggested_retry_code: null,
  saturday_attempt: true, refused_no_service: true, data_fixable: false, postcode_service: null, postcode_check: null,
  scenario: "saturday_temporary", attempts: 1, first_failed_at: "2026-10-09T08:00:00Z", last_failed_at: "2026-10-09T08:00:00Z",
  first_failed_by: "Grant", resolved_at: null, resolved_note: null, dealt_with_at: null, dealt_with_by: null, actions: [],
  ...over,
});

describe("loadTodayReport", () => {
  beforeEach(() => { dbExecute.mockReset(); Object.values(apc).forEach(f => f.mockReset()); });

  it("builds the report from stored rows and never calls APC", async () => {
    dbExecute.mockResolvedValue({ rows: [row(), row({ id: 2, shopify_order_id: "6100000000002", order_name: "#1235", reason: "Creation failed: Delivery City too long", refused_no_service: false, data_fixable: true })] });
    const report = await loadTodayReport(true, new Date("2026-10-09T10:00:00Z"));

    expect(report.date).toBe("2026-10-09");
    expect(report.issues.map(i => i.orderName)).toEqual(["#1234", "#1235"]);
    expect(report.open).toBe(2);
    // Exactly one read of today's rows, and nothing else.
    expect(dbExecute).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(apc)) expect(fn).not.toHaveBeenCalled();
  });

  it("re-reads the postcode table, so the scenario reflects it (KA3 lists Saturday → refused today)", async () => {
    dbExecute.mockResolvedValue({ rows: [row()] });
    const report = await loadTodayReport(true, new Date("2026-10-09T10:00:00Z"));
    expect(report.issues[0].postcodeService?.matchedOn).toBe("KA3");
    expect(report.issues[0].scenario).toBe("saturday_temporary");
  });

  it("an empty day is an empty report, with no postcode work at all", async () => {
    dbExecute.mockResolvedValue({ rows: [] });
    const report = await loadTodayReport(false, new Date("2026-10-09T10:00:00Z"));
    expect(report).toMatchObject({ open: 0, total: 0, issues: [] });
    for (const fn of Object.values(apc)) expect(fn).not.toHaveBeenCalled();
  });
});
