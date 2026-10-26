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
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { resolveFinanceAccess } from "./finance";
import { forecastCashFlow, shortError, type CfItem } from "../lib/finance/cash-flow";
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

// Sample bills and payouts for the TEST server only (?demo=1), so the page
// can be tried without QuickBooks or Shopify. Never on live.
const DEMO_ALLOWED = process.env["NODE_ENV"] !== "production";
function demoSources(today: string) {
  const day = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return {
    bills: [
      { id: "demo-1", vendorName: "Brakes", docNumber: "INV-48812", dueDate: day(-3), balance: 2140.55 },
      { id: "demo-2", vendorName: "PIB Butchers", docNumber: "7731", dueDate: day(2), balance: 3890 },
      { id: "demo-3", vendorName: "Bako", docNumber: null, dueDate: day(5), balance: 1260.4 },
      { id: "demo-4", vendorName: "Packaging Supplies Ltd", docNumber: "PS-2210", dueDate: day(9), balance: 980 },
    ],
    payouts: [
      { id: "demo-p1", date: day(1), status: "SCHEDULED" as const, net: 6420.18 },
      { id: "demo-p2", date: day(4), status: "SCHEDULED" as const, net: 5875.6 },
      { id: "demo-p3", date: day(8), status: "SCHEDULED" as const, net: 7012.33 },
    ],
  };
}

const forecastQuery = z.object({ days: z.coerce.number().int().min(7).max(90).optional(), demo: z.enum(["1"]).optional() });
router.get("/", validateQuery(forecastQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof forecastQuery>;
  const days = q.days ?? 14;
  const today = londonDateString();
  const demo = DEMO_ALLOWED && q.demo === "1" ? demoSources(today) : null;
  const [settings, itemRows, vendors, bills, payouts] = await Promise.all([
    db.execute<{ bank_balance: string; balance_as_of: string; updated_by_name: string | null; updated_at: string }>(sql`
      SELECT bank_balance, to_char(balance_as_of, 'YYYY-MM-DD') AS balance_as_of, updated_by_name, updated_at FROM cash_flow_settings WHERE id = 1`),
    db.execute<ItemRow>(sql`SELECT ${ITEM_COLS} FROM cash_flow_items ORDER BY active DESC, COALESCE(on_date, starts_on), id`),
    db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM fin_vendors ORDER BY name`),
    demo ? Promise.resolve(null) : loadOpenBills(),
    demo ? Promise.resolve(null) : loadShopifyPayouts(),
  ]);
  const s = settings.rows[0];
  const items = itemRows.rows.map(toItem);
  const balance = s ? Number(s.bank_balance) : 0;
  const balanceAsOf = s?.balance_as_of ?? today;
  const forecast = forecastCashFlow({
    today, days, balance, balanceAsOf,
    bills: demo ? demo.bills : (bills?.bills ?? []).map(b => ({ id: b.id, vendorName: b.vendorName, docNumber: b.docNumber, dueDate: b.dueDate, balance: b.balance })),
    payouts: demo ? demo.payouts : (payouts?.payouts ?? []).map(p => ({ id: p.id, date: p.date, status: p.status, net: p.net })),
    items: items as CfItem[],
  });
  res.json({
    today,
    balance: { amount: balance, asOf: balanceAsOf, set: !!s, updatedBy: s?.updated_by_name ?? null, updatedAt: s?.updated_at ?? null },
    forecast,
    items,
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
