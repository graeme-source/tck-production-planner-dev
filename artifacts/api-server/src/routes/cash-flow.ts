/**
 * /api/cash-flow — Finance → Cash flow (Graeme, 2026-10-26). Same access as
 * Finance (admins and the bookkeeper). Bills come live from QuickBooks
 * (lib/finance/qbo-open-bills.ts), payouts live from Shopify
 * (lib/finance/shopify-payouts.ts); the bank balance and hand-added
 * money in/out are stored here (migration 0265). Maths:
 * lib/finance/cash-flow.ts.
 *
 *   GET    /?days=14        the forecast, with where each source stands
 *   PUT    /balance         { balance, asOf }
 *   POST   /items           add money in/out (one-off or every N days)
 *   PATCH  /items/:id       change it
 *   DELETE /items/:id       stop it (kept, switched off)
 *   PUT    /rules           a supplier's payment rule (one per supplier)
 *   DELETE /rules/:id       remove it — back to QuickBooks' due dates
 *   PUT    /overrides       move a line to another day (drag / date picker)
 *   POST   /overrides/remove  "Put back"
 *   POST   /demo/reset      test server: reset the sample rule and move
 *
 * Writes with ?demo=1 (test server only) change the in-memory sample, never
 * the tables. Which day a line sits on: hand move > supplier rule >
 * QuickBooks due date > bill date (lib/finance/cash-flow-rules.ts).
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { resolveFinanceAccess } from "./finance";
import { addDays, forecastCashFlow, overrideKey, shortError, staleOverrides, type CfBill, type CfItem, type CfOverride, type CfPayout } from "../lib/finance/cash-flow";
import { describeRule, diagnoseBills, ruleFromRow, vendorKey, type SupplierRule } from "../lib/finance/cash-flow-rules";
import { loadOpenBills } from "../lib/finance/qbo-open-bills";
import { loadShopifyPayouts } from "../lib/finance/shopify-payouts";

const router: IRouter = Router();
router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (await resolveFinanceAccess(req)) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
});

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function nameOf(userId: number | undefined): Promise<string | null> {
  if (!userId) return null;
  const r = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${userId}`);
  return r.rows[0]?.name ?? null;
}

interface ItemRow {
  [k: string]: unknown;
  id: number; label: string; direction: "in" | "out"; amount: string; on_date: string | null; every_days: number | null;
  starts_on: string | null; ends_on: string | null; fin_vendor_id: number | null; vendor_name: string | null; notes: string | null; active: boolean;
}
const ITEM_COLS = sql`id, label, direction, amount, to_char(on_date, 'YYYY-MM-DD') AS on_date, every_days,
  to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, fin_vendor_id, vendor_name, notes, active`;
const toItem = (r: ItemRow) => ({
  id: Number(r.id), label: r.label, direction: r.direction, amount: Number(r.amount), onDate: r.on_date, everyDays: r.every_days,
  startsOn: r.starts_on, endsOn: r.ends_on, finVendorId: r.fin_vendor_id, vendorName: r.vendor_name, notes: r.notes, active: r.active,
});

// ── Supplier payment rules + hand moves (2026-10-27) ─────────────────────
// Stored in cash_flow_supplier_rules (0273) and cash_flow_overrides (0274).
// With ?demo=1 on the test server they live in memory instead, seeded with a
// rule and a move, so trying the page never writes sample rules into the
// real tables.

interface RuleRow { [k: string]: unknown; id: number; vendor_name: string; kind: string; days: number | null; day_of_month: number | null; cutoff_day: number | null; updated_by_name: string | null }
interface OverrideRow { [k: string]: unknown; source: CfOverride["source"]; ref: string; occurrence: string; planned_date: string; moved_by_name: string | null; moved_at: string | null }
const toRuleOut = (r: RuleRow) => {
  const rule = ruleFromRow(r);
  return {
    id: Number(r.id), vendorName: r.vendor_name, kind: r.kind, days: r.days, dayOfMonth: r.day_of_month, cutoffDay: r.cutoff_day,
    text: rule ? describeRule(rule) : "incomplete rule", updatedBy: r.updated_by_name,
  };
};
const toOverride = (r: OverrideRow): CfOverride & { movedBy: string | null; movedAt: string | null } => ({
  source: r.source, ref: r.ref, occurrence: r.occurrence, plannedDate: r.planned_date, movedBy: r.moved_by_name, movedAt: r.moved_at,
});

const DEMO_ALLOWED = process.env["NODE_ENV"] !== "production";
const isDemo = (req: Request) => DEMO_ALLOWED && req.query["demo"] === "1";

let demoStore: { day: string; rules: RuleRow[]; overrides: OverrideRow[]; nextId: number } | null = null;
function demoState(today: string) {
  if (!demoStore || demoStore.day !== today) {
    const day = (n: number) => addDays(today, n);
    demoStore = {
      day: today,
      rules: [{ id: 1, vendor_name: "A.B. Fruits", kind: "next_month_day_cutoff", days: null, day_of_month: 1, cutoff_day: 15, updated_by_name: "Sample" }],
      // Bako's bill pushed back three days by hand.
      overrides: [{ source: "bill", ref: "demo-3", occurrence: "", planned_date: day(8), moved_by_name: "Sample", moved_at: null }],
      nextId: 2,
    };
  }
  return demoStore;
}

// Sample bills and payouts for the TEST server only (?demo=1), so the page
// can be tried without QuickBooks or Shopify. Never on live. Several bills
// have no payment terms and a due date equal to the bill date — the pattern
// that makes so much look overdue — and A.B. Fruits has a rule.
function demoSources(today: string) {
  const day = (n: number) => addDays(today, n);
  // Bill dates for A.B. Fruits: one in the first half of last month, one in
  // the second half, one this month — so the cut-off rule shows both ways.
  const [y, m] = today.split("-").map(Number);
  const lastMonth = (d: number) => { const dt = new Date(Date.UTC(y, m - 2, d)); return dt.toISOString().slice(0, 10); };
  const thisMonth = (d: number) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.toISOString().slice(0, 10); };
  return {
    bills: [
      { id: "demo-1", vendorName: "Brakes", docNumber: "INV-48812", txnDate: day(-33), dueDate: day(-3), termsId: "3", termsName: "Net 30", balance: 2140.55 },
      { id: "demo-2", vendorName: "PIB Butchers", docNumber: "7731", txnDate: day(-12), dueDate: day(2), termsId: "2", termsName: "Net 14", balance: 3890 },
      { id: "demo-3", vendorName: "Bako", docNumber: null, txnDate: day(-25), dueDate: day(5), termsId: "3", termsName: null, balance: 1260.4 },
      { id: "demo-4", vendorName: "Packaging Supplies Ltd", docNumber: "PS-2210", txnDate: day(-6), dueDate: day(-6), termsId: null, termsName: null, balance: 980 },
      { id: "demo-5", vendorName: "AB Fruits", docNumber: "ABF-1021", txnDate: lastMonth(9), dueDate: lastMonth(9), termsId: null, termsName: null, balance: 612.3 },
      { id: "demo-6", vendorName: "AB Fruits", docNumber: "ABF-1040", txnDate: lastMonth(22), dueDate: lastMonth(22), termsId: null, termsName: null, balance: 488.75 },
      { id: "demo-7", vendorName: "AB Fruits", docNumber: "ABF-1052", txnDate: thisMonth(4), dueDate: null, termsId: null, termsName: null, balance: 351.2 },
      { id: "demo-8", vendorName: "Cleaning Direct", docNumber: "CD-77", txnDate: day(-9), dueDate: day(-9), termsId: null, termsName: null, balance: 214 },
    ],
    payouts: [
      { id: "demo-p1", date: day(1), status: "SCHEDULED" as const, net: 6420.18 },
      { id: "demo-p2", date: day(4), status: "SCHEDULED" as const, net: 5875.6 },
      { id: "demo-p3", date: day(8), status: "SCHEDULED" as const, net: 7012.33 },
    ],
  };
}

const RULE_COLS = sql`id, vendor_name, kind, days, day_of_month, cutoff_day, updated_by_name`;
const OVERRIDE_COLS = sql`source, ref, occurrence, to_char(planned_date, 'YYYY-MM-DD') AS planned_date, moved_by_name, moved_at`;

const forecastQuery = z.object({ days: z.coerce.number().int().min(7).max(90).optional(), demo: z.enum(["1"]).optional() });
router.get("/", validateQuery(forecastQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof forecastQuery>;
  const days = q.days ?? 14;
  const today = londonDateString();
  const demo = DEMO_ALLOWED && q.demo === "1" ? demoSources(today) : null;
  const [settings, itemRows, vendors, bills, payouts, ruleRows, overrideRows] = await Promise.all([
    db.execute<{ bank_balance: string; balance_as_of: string; updated_by_name: string | null; updated_at: string }>(sql`
      SELECT bank_balance, to_char(balance_as_of, 'YYYY-MM-DD') AS balance_as_of, updated_by_name, updated_at FROM cash_flow_settings WHERE id = 1`),
    db.execute<ItemRow>(sql`SELECT ${ITEM_COLS} FROM cash_flow_items ORDER BY active DESC, COALESCE(on_date, starts_on), id`),
    db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM fin_vendors ORDER BY name`),
    demo ? Promise.resolve(null) : loadOpenBills(),
    demo ? Promise.resolve(null) : loadShopifyPayouts(),
    demo ? Promise.resolve(demoState(today).rules) : db.execute<RuleRow>(sql`SELECT ${RULE_COLS} FROM cash_flow_supplier_rules ORDER BY vendor_name`).then(r => r.rows),
    demo ? Promise.resolve(demoState(today).overrides) : db.execute<OverrideRow>(sql`SELECT ${OVERRIDE_COLS} FROM cash_flow_overrides`).then(r => r.rows),
  ]);
  const s = settings.rows[0];
  const items = itemRows.rows.map(toItem);
  const balance = s ? Number(s.bank_balance) : 0;
  const balanceAsOf = s?.balance_as_of ?? today;
  const billList: CfBill[] = demo ? demo.bills : (bills?.bills ?? []).map(b => ({
    id: b.id, vendorName: b.vendorName, docNumber: b.docNumber, txnDate: b.txnDate, dueDate: b.dueDate, termsId: b.termsId, termsName: b.termsName, balance: b.balance,
  }));
  const payoutList: CfPayout[] = demo ? demo.payouts : (payouts?.payouts ?? []).map(p => ({ id: p.id, date: p.date, status: p.status, net: p.net }));
  const rules: SupplierRule[] = ruleRows.flatMap(r => { const rule = ruleFromRow(r); return rule ? [{ vendorName: r.vendor_name, rule }] : []; });
  let overrides = overrideRows.map(toOverride);

  // A paid bill (gone from open bills) or a paid payout just drops its move —
  // but only when that source loaded cleanly.
  if (!demo) {
    const stale = staleOverrides(overrides, {
      bills: bills?.connected && !bills.error && bills.fetchedAt ? billList : null,
      payouts: payouts?.available && !payouts.error && payouts.fetchedAt ? payoutList : null,
    });
    if (stale.length) {
      for (const o of stale) {
        await db.execute(sql`DELETE FROM cash_flow_overrides WHERE source = ${o.source} AND ref = ${o.ref} AND occurrence = ${o.occurrence}`);
      }
      const gone = new Set(stale.map(o => overrideKey(o.source, o.ref, o.occurrence)));
      overrides = overrides.filter(o => !gone.has(overrideKey(o.source, o.ref, o.occurrence)));
    }
  }

  const forecast = forecastCashFlow({ today, days, balance, balanceAsOf, bills: billList, payouts: payoutList, items: items as CfItem[], rules, overrides });
  res.json({
    today,
    balance: { amount: balance, asOf: balanceAsOf, set: !!s, updatedBy: s?.updated_by_name ?? null, updatedAt: s?.updated_at ?? null },
    forecast,
    items,
    rules: ruleRows.map(toRuleOut),
    diagnosis: diagnoseBills(billList, rules),
    // Supplier names seen on open bills, for the rule picker.
    billVendors: [...new Set(billList.map(b => b.vendorName))].sort((a, b) => a.localeCompare(b)),
    vendors: vendors.rows.map(v => ({ id: Number(v.id), name: v.name })),
    demo: !!demo,
    demoAllowed: DEMO_ALLOWED,
    sources: demo ? {
      quickbooks: { connected: true, bills: demo.bills.length, fetchedAt: null, error: null },
      shopify: { available: true, reason: null, balance: 1830.4, fetchedAt: null, error: null },
    } : {
      quickbooks: { connected: !!bills?.connected, bills: bills?.bills.length ?? 0, fetchedAt: bills?.fetchedAt ?? null, error: shortError(bills?.error) },
      shopify: { available: !!payouts?.available, reason: shortError(payouts?.reason), balance: payouts?.balance ?? null, fetchedAt: payouts?.fetchedAt ?? null, error: shortError(payouts?.error) },
    },
  });
});

const ruleBody = z.object({
  vendorName: z.string().trim().min(1).max(120),
  kind: z.enum(["days_after", "next_month_day", "next_month_day_cutoff", "qbo"]),
  days: z.number().int().min(0).max(365).nullish(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  cutoffDay: z.number().int().min(1).max(31).nullish(),
}).refine(b =>
  (b.kind === "days_after" && b.days != null) ||
  (b.kind === "next_month_day" && b.dayOfMonth != null) ||
  (b.kind === "next_month_day_cutoff" && b.dayOfMonth != null && b.cutoffDay != null) ||
  b.kind === "qbo", { message: "That rule needs its number of days or day of the month" });

/** Add or change a supplier's rule — one per supplier, matched on vendorKey. */
router.put("/rules", validate(ruleBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof ruleBody>;
  const key = vendorKey(b.vendorName);
  if (!key) { res.status(400).json({ error: "Give the supplier's name" }); return; }
  const fields = {
    days: b.kind === "days_after" ? b.days ?? null : null,
    day_of_month: b.kind === "next_month_day" || b.kind === "next_month_day_cutoff" ? b.dayOfMonth ?? null : null,
    cutoff_day: b.kind === "next_month_day_cutoff" ? b.cutoffDay ?? null : null,
  };
  if (isDemo(req)) {
    const st = demoState(londonDateString());
    const at = st.rules.findIndex(r => vendorKey(r.vendor_name) === key);
    const row: RuleRow = { id: at >= 0 ? st.rules[at].id : st.nextId++, vendor_name: b.vendorName, kind: b.kind, ...fields, updated_by_name: "Sample" };
    if (at >= 0) st.rules[at] = row; else st.rules.push(row);
    res.json(toRuleOut(row));
    return;
  }
  const by = await nameOf(req.session.userId);
  const rows = await db.execute<RuleRow>(sql`
    INSERT INTO cash_flow_supplier_rules (vendor_key, vendor_name, kind, days, day_of_month, cutoff_day, updated_by_name)
    VALUES (${key}, ${b.vendorName}, ${b.kind}, ${fields.days}, ${fields.day_of_month}, ${fields.cutoff_day}, ${by})
    ON CONFLICT (vendor_key) DO UPDATE SET vendor_name = EXCLUDED.vendor_name, kind = EXCLUDED.kind, days = EXCLUDED.days,
      day_of_month = EXCLUDED.day_of_month, cutoff_day = EXCLUDED.cutoff_day, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()
    RETURNING ${RULE_COLS}
  `);
  res.json(toRuleOut(rows.rows[0]));
});

/** Remove a supplier's rule — its bills go back to QuickBooks' due dates. */
router.delete("/rules/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(404).json({ error: "Not found" }); return; }
  if (isDemo(req)) {
    const st = demoState(londonDateString());
    st.rules = st.rules.filter(r => Number(r.id) !== id);
    res.json({ ok: true });
    return;
  }
  await db.execute(sql`DELETE FROM cash_flow_supplier_rules WHERE id = ${id}`);
  res.json({ ok: true });
});

const overrideRef = {
  source: z.enum(["bill", "payout", "item"]),
  ref: z.string().trim().min(1).max(80),
  occurrence: z.union([DATE, z.literal("")]).default(""),
};
const overrideBody = z.object({ ...overrideRef, plannedDate: DATE, movedFrom: DATE.nullish(), label: z.string().max(200).nullish() });

/** Move a line to another day (drag, or the date picker). */
router.put("/overrides", validate(overrideBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof overrideBody>;
  if (isDemo(req)) {
    const st = demoState(londonDateString());
    st.overrides = st.overrides.filter(o => !(o.source === b.source && o.ref === b.ref && o.occurrence === b.occurrence));
    st.overrides.push({ source: b.source, ref: b.ref, occurrence: b.occurrence, planned_date: b.plannedDate, moved_by_name: "Sample", moved_at: new Date().toISOString() });
    res.json({ ok: true });
    return;
  }
  const by = await nameOf(req.session.userId);
  await db.execute(sql`
    INSERT INTO cash_flow_overrides (source, ref, occurrence, planned_date, moved_from, label, moved_by_name, moved_at)
    VALUES (${b.source}, ${b.ref}, ${b.occurrence}, ${b.plannedDate}, ${b.movedFrom ?? null}, ${b.label ?? null}, ${by}, NOW())
    ON CONFLICT (source, ref, occurrence) DO UPDATE SET planned_date = EXCLUDED.planned_date, moved_from = EXCLUDED.moved_from,
      label = EXCLUDED.label, moved_by_name = EXCLUDED.moved_by_name, moved_at = NOW()
  `);
  res.json({ ok: true });
});

const overrideRemove = z.object(overrideRef);
/** "Put back" — the line returns to its rule / QuickBooks date. */
router.post("/overrides/remove", validate(overrideRemove), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof overrideRemove>;
  if (isDemo(req)) {
    const st = demoState(londonDateString());
    st.overrides = st.overrides.filter(o => !(o.source === b.source && o.ref === b.ref && o.occurrence === b.occurrence));
    res.json({ ok: true });
    return;
  }
  await db.execute(sql`DELETE FROM cash_flow_overrides WHERE source = ${b.source} AND ref = ${b.ref} AND occurrence = ${b.occurrence}`);
  res.json({ ok: true });
});

/** Test server: put the sample rule and move back as they started. */
router.post("/demo/reset", validate(z.object({})), async (req: Request, res: Response) => {
  if (!DEMO_ALLOWED) { res.status(404).json({ error: "Not found" }); return; }
  demoStore = null;
  res.json({ ok: true });
});

const balanceBody = z.object({ balance: z.number().min(-10_000_000).max(10_000_000), asOf: DATE });
router.put("/balance", validate(balanceBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof balanceBody>;
  const by = await nameOf(req.session.userId);
  await db.execute(sql`
    INSERT INTO cash_flow_settings (id, bank_balance, balance_as_of, updated_by_name, updated_at)
    VALUES (1, ${b.balance}, ${b.asOf}, ${by}, NOW())
    ON CONFLICT (id) DO UPDATE SET bank_balance = EXCLUDED.bank_balance, balance_as_of = EXCLUDED.balance_as_of,
      updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()
  `);
  res.json({ ok: true });
});

const itemFields = {
  label: z.string().trim().min(1).max(120),
  direction: z.enum(["in", "out"]),
  amount: z.number().min(0).max(10_000_000),
  onDate: DATE.nullish(),
  everyDays: z.number().int().min(1).max(365).nullish(),
  startsOn: DATE.nullish(),
  endsOn: DATE.nullish(),
  finVendorId: z.number().int().positive().nullish(),
  vendorName: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(500).nullish(),
};
const itemBody = z.object(itemFields).refine(b => !!b.onDate || (!!b.everyDays && !!b.startsOn), { message: "Give a date, or how often and from when" });
const itemPatch = z.object({ ...Object.fromEntries(Object.entries(itemFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])), active: z.boolean().optional() });

router.post("/items", validate(itemBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof itemBody>;
  const by = await nameOf(req.session.userId);
  const rows = await db.execute<ItemRow>(sql`
    INSERT INTO cash_flow_items (label, direction, amount, on_date, every_days, starts_on, ends_on, fin_vendor_id, vendor_name, notes, created_by_name)
    VALUES (${b.label}, ${b.direction}, ${b.amount}, ${b.onDate ?? null}, ${b.onDate ? null : b.everyDays ?? null}, ${b.onDate ? null : b.startsOn ?? null},
            ${b.onDate ? null : b.endsOn ?? null}, ${b.finVendorId ?? null}, ${b.vendorName ?? null}, ${b.notes ?? null}, ${by})
    RETURNING ${ITEM_COLS}
  `);
  res.status(201).json(toItem(rows.rows[0]));
});

router.patch("/items/:id", validate(itemPatch), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body as Record<string, unknown>;
  const set = (col: string, key: string) => (key in b ? sql`${sql.raw(col)} = ${b[key] ?? null},` : sql``);
  const rows = await db.execute<ItemRow>(sql`
    UPDATE cash_flow_items SET
      ${set("label", "label")} ${set("direction", "direction")} ${set("amount", "amount")} ${set("on_date", "onDate")}
      ${set("every_days", "everyDays")} ${set("starts_on", "startsOn")} ${set("ends_on", "endsOn")}
      ${set("fin_vendor_id", "finVendorId")} ${set("vendor_name", "vendorName")} ${set("notes", "notes")} ${set("active", "active")}
      updated_at = NOW()
    WHERE id = ${id} RETURNING ${ITEM_COLS}
  `);
  if (!rows.rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toItem(rows.rows[0]));
});

router.delete("/items/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(404).json({ error: "Not found" }); return; }
  await db.execute(sql`UPDATE cash_flow_items SET active = false, updated_at = NOW() WHERE id = ${id}`);
  res.json({ ok: true });
});

export default router;
