import { describe, expect, it } from "vitest";
import { compileDataQuery } from "./jane-data-query";
import { JANE_DATASETS, datasetByName } from "./jane-datasets";

// The line Graeme drew (5 Nov 2026): nothing founder-only, no finance, nothing
// from People, no private records. A new dataset that crosses it fails here.

const FORBIDDEN_TABLES = [
  /^fin_/, /^founder/, /^people/, /^marketing/, /^pnl/, /^cash_flow/, /^payroll/, /^planday/, /^training/, /^onboarding/,
  /^return_to_work/, /^staff_emergency/, /^employee/, /^employment/, /contract/, /^person_/, /^starter/, /^team_message/,
  /^station_messages/, /^todo/, /^notifications/, /^recipe_chat/, /^surveys?/, /^contacts$/, /^app_users$/, /^users$/,
  /^app_settings$/, /^user_/, /^password/, /^push_/, /^issue_triage/, /^issue_fix/, /^incident/, /^prep_sessions/, /^prep_session_/,
  /^ad_/, /^ab_/, /^live_offers/, /^revenue/, /^test_box/, /^lucky/, /^open_order_disputes/, /^postcode/, /^apc_postcode/,
  /^apc_booking/, /^print_jobs/,
];

const FORBIDDEN_COLUMNS = [
  /email/i, /phone/i, /password/i, /pin_hash/i, /token/i, /secret/i, /api_key/i, /address/i, /consignee/i, /postcode/i,
  /\buser_id\b/i, /completed_by/i, /recorded_by/i, /user_name/i, /reported_by/i, /cooked_by/i, /assigned_to/i, /credited_to/i,
  /hourly_rate/i, /labour/i, /lost_value/i, /time_cost/i, /paid_hours/i, /headcount/i, /value_made/i, /value_despatched/i, /\bratio\b/i,
  /visitor_name/i, /illness/i, /signature/i, /photo/i, /credit_weight/i, /driver_name/i, /order_refs/i, /report_context/i, /total_price/i,
];

const tablesIn = (sql: string) => [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]).filter((t) => t !== "jsonb_array_elements");

describe("JANE_DATASETS", () => {
  it("reads nothing founder-only, financial, personal or private", () => {
    for (const d of JANE_DATASETS) {
      for (const table of tablesIn(d.sql)) {
        for (const banned of FORBIDDEN_TABLES) expect(table, `${d.name} reads ${table}`).not.toMatch(banned);
      }
    }
  });

  it("selects no personal, pay or secret column", () => {
    for (const d of JANE_DATASETS) {
      // order_by_email is a yes/no on how a supplier takes orders, not an address.
      const sql = d.sql.replace(/order_by_email/g, "");
      for (const banned of FORBIDDEN_COLUMNS) expect(sql, d.name).not.toMatch(banned);
    }
  });

  it("names its columns, never SELECT *", () => {
    for (const d of JANE_DATASETS) expect(d.sql, d.name).not.toMatch(/\bSELECT\s+\*|\.\*/i);
  });

  it("only the Improvements page's own suggester names a person", () => {
    const named = JANE_DATASETS.filter((d) => /_name\b/.test(d.sql.replace(/\b(sub_recipe_name|recipe_name|ingredient_name|plan_name|station_label|shopify_order_name|order_name|item_name)\b/g, "")));
    expect(named.map((d) => d.name)).toEqual(["improvements"]);
  });

  it("takes only product details from an order, never the customer", () => {
    const { sql } = datasetByName("orders_by_product")!;
    expect(sql.match(/payload->>?'[a-z_]+'/g)?.sort()).toEqual([
      "payload->'line_items'", "payload->>'cancelled_at'", "payload->>'fulfillment_status'", "payload->>'tags'",
    ]);
    expect(sql.match(/\bli->>'[a-z_]+'/g)?.sort()).toEqual(["li->>'quantity'", "li->>'title'", "li->>'variant_title'"]);
  });

  it("keeps expected stock out altogether: counts stay blind", () => {
    for (const d of JANE_DATASETS) expect(`${d.name} ${d.sql}`).not.toMatch(/expected_stock|expected_qty|stock_ledger/i);
  });

  it("keeps Reports tabs a viewer can't open behind a manager floor", () => {
    const open = JANE_DATASETS.filter((d) => d.pageKey === "/reports" && !d.minRole);
    expect(open.map((d) => d.name)).toEqual(["issues"]);
    expect(datasetByName("team_efficiency")?.minRole).toBe("manager");
  });

  it("reports real output, not the batches_complete column only fried chicken moves", () => {
    expect(datasetByName("production_by_recipe")?.sql).not.toContain("batches_complete");
  });

  it("every dataset compiles, with unique names and a gate", () => {
    expect(new Set(JANE_DATASETS.map((d) => d.name)).size).toBe(JANE_DATASETS.length);
    for (const d of JANE_DATASETS) {
      expect(d.pageKey.startsWith("/"), d.name).toBe(true);
      expect(compileDataQuery(d, { dataset: d.name }).outputColumns).toEqual(d.columns.map((c) => c.name));
    }
  });

  it("declares a column for exactly what its SELECT returns, numbers as float8", () => {
    for (const d of JANE_DATASETS) {
      for (const c of d.columns) expect(d.sql, `${d.name}.${c.name}`).toMatch(new RegExp(`\\b${c.name}\\b`));
      if (d.sql.includes("UNION ALL")) continue;
      for (const c of d.columns.filter((col) => col.type === "number")) {
        expect(d.sql, `${d.name}.${c.name} must be ::float8`).toMatch(new RegExp(`float8\\)? AS ${c.name}\\b|float8 AS ${c.name}\\b`));
      }
    }
  });
});
