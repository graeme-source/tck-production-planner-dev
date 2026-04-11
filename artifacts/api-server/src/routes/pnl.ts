import { Router, type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getOrdersForPnl, getOrderTransactionFees, type ShopifyOrder } from "../services/shopify";
import { calculateCogs, classifyBoxes } from "../lib/pnl-calculator";
import { getPayrollCosts } from "../services/planday";

const router = Router();

// ── Founder auth ────────────────────────────────────────────────────────────

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

async function requireFounder(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const [user] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (user?.email === FOUNDER_EMAIL) { next(); return; }
    res.status(403).json({ error: "Access denied" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[requireFounder] DB lookup failed:", msg);
    res.status(500).json({ error: "Internal server error" });
  }
}

router.use(requireFounder);

// ── Helpers ─────────────────────────────────────────────────────────────────

const EXCLUDED_FINANCIAL = new Set(["refunded", "voided"]);

function isCountableOrder(o: ShopifyOrder): boolean {
  if (o.cancelled_at) return false;
  if (EXCLUDED_FINANCIAL.has(o.financial_status)) return false;
  return true;
}

function getRefundTotal(o: ShopifyOrder): number {
  if (!o.refunds || o.refunds.length === 0) return 0;
  return o.refunds.reduce((sum, r) => {
    if (!r.transactions) return sum;
    return sum + r.transactions
      .filter(t => t.kind === "refund" && t.status === "success")
      .reduce((s, t) => s + parseFloat(t.amount || "0"), 0);
  }, 0);
}

function getNetRevenue(o: ShopifyOrder): number {
  const total = parseFloat(o.total_price || "0");
  return total - getRefundTotal(o);
}

async function getPnlSetting(key: string): Promise<string | null> {
  const rows = await db.execute<{ value: string }>(
    sql`SELECT value FROM pnl_settings WHERE key = ${key} LIMIT 1`,
  );
  return rows.rows[0]?.value ?? null;
}

async function getAppSetting(key: string): Promise<string | null> {
  const rows = await db.execute<{ value: string }>(
    sql`SELECT value FROM app_settings WHERE key = ${key} LIMIT 1`,
  );
  return rows.rows[0]?.value ?? null;
}

// ── GET /summary ────────────────────────────────────────────────────────────

router.get("/summary", async (req: Request, res: Response) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) {
    res.status(400).json({ error: "from and to query params required (YYYY-MM-DD)" });
    return;
  }

  try {
    const orders = await getOrdersForPnl(from, to);
    const countable = orders.filter(isCountableOrder);

    // Revenue
    const grossRevenue = countable.reduce((s, o) => s + parseFloat(o.total_price || "0"), 0);
    const refunds = countable.reduce((s, o) => s + getRefundTotal(o), 0);
    const netRevenue = grossRevenue - refunds;

    // COGS
    const cogs = await calculateCogs(countable);

    const grossProfit = netRevenue - cogs.totalCogs;
    const grossMarginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

    // Transaction fees from Shopify
    const orderIds = countable.map(o => o.id);
    const fees = await getOrderTransactionFees(orderIds);
    const totalTransactionFees = Object.values(fees).reduce((s, f) => s + f, 0);

    // P&P
    const [smallBoxCostStr, largeBoxCostStr, weightThreshStr] = await Promise.all([
      getPnlSetting("small_box_cost"),
      getPnlSetting("large_box_cost"),
      getAppSetting("apc_weight_threshold_grams"),
    ]);
    const smallBoxCost = parseFloat(smallBoxCostStr ?? "2.50");
    const largeBoxCost = parseFloat(largeBoxCostStr ?? "3.50");
    const weightThreshold = Number(weightThreshStr) || 7001;

    const boxes = classifyBoxes(countable, weightThreshold);
    const totalPP = (boxes.smallBoxCount * smallBoxCost) + (boxes.largeBoxCount * largeBoxCost);

    // Overheads
    const overheadRows = await db.execute<{ monthly_amount: string }>(
      sql`SELECT monthly_amount FROM pnl_overheads`,
    );
    const totalMonthlyOverheads = overheadRows.rows.reduce(
      (s: number, r: { monthly_amount: string }) => s + parseFloat(r.monthly_amount), 0,
    );
    const dailyOverhead = (totalMonthlyOverheads * 12) / 365;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const dayCount = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const totalOverheads = dailyOverhead * dayCount;

    // Actual labour from Planday (runs in parallel with nothing — just awaited here)
    let actualLabour: Awaited<ReturnType<typeof getPayrollCosts>>;
    try {
      actualLabour = await getPayrollCosts(from, to);
    } catch (err) {
      console.warn("[pnl/summary] Planday fetch failed:", err instanceof Error ? err.message : err);
      actualLabour = { available: false, grossWages: 0, employerNI: 0, pension: 0, totalCost: 0, shiftCount: 0, totalHours: 0, costPerHour: 0, settings: { niRate: 0, niWeeklyThreshold: 0, employmentAllowanceAnnual: 0, pensionRate: 0 } };
    }

    // Net profit
    const contributionProfit = grossProfit - totalTransactionFees - totalPP;
    const contributionMarginPercent = netRevenue > 0 ? (contributionProfit / netRevenue) * 100 : 0;
    const netProfit = contributionProfit - totalOverheads;
    const netMarginPercent = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

    res.json({
      from,
      to,
      dayCount,
      orderCount: countable.length,
      revenue: {
        gross: round2(grossRevenue),
        refunds: round2(refunds),
        net: round2(netRevenue),
      },
      cogs: {
        total: round2(cogs.totalCogs),
        ingredientCost: round2(cogs.ingredientCost),
        packagingCost: round2(cogs.packagingCost),
        labourCost: round2(cogs.labourCost),
        unmappedItemCount: cogs.unmappedItemCount,
        unmappedRevenue: round2(cogs.unmappedRevenue),
      },
      grossProfit: round2(grossProfit),
      grossMarginPercent: round1(grossMarginPercent),
      transactionFees: round2(totalTransactionFees),
      packagingAndPostage: {
        total: round2(totalPP),
        smallBoxCount: boxes.smallBoxCount,
        largeBoxCount: boxes.largeBoxCount,
        noShipCount: boxes.noShipCount,
        smallBoxCost,
        largeBoxCost,
      },
      overheads: {
        total: round2(totalOverheads),
        dailyRate: round2(dailyOverhead),
      },
      contributionProfit: round2(contributionProfit),
      contributionMarginPercent: round1(contributionMarginPercent),
      netProfit: round2(netProfit),
      netMarginPercent: round1(netMarginPercent),
      actualLabour,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pnl/summary]", msg);
    res.status(500).json({ error: msg });
  }
});

// ── GET /breakdown ──────────────────────────────────────────────────────────

router.get("/breakdown", async (req: Request, res: Response) => {
  const from = req.query.from as string;
  const to = req.query.to as string;
  if (!from || !to) {
    res.status(400).json({ error: "from and to query params required" });
    return;
  }

  try {
    const orders = await getOrdersForPnl(from, to);
    const countable = orders.filter(isCountableOrder);
    const cogs = await calculateCogs(countable);

    res.json({
      from,
      to,
      recipes: cogs.perRecipe.map(r => ({
        ...r,
        unitCost: round2(r.unitCost),
        totalCost: round2(r.totalCost),
        revenue: round2(r.revenue),
        marginPercent: r.marginPercent != null ? round1(r.marginPercent) : null,
      })),
      unmappedItemCount: cogs.unmappedItemCount,
      unmappedRevenue: round2(cogs.unmappedRevenue),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pnl/breakdown]", msg);
    res.status(500).json({ error: msg });
  }
});

// ── Settings CRUD ───────────────────────────────────────────────────────────

router.get("/settings", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute<{ key: string; value: string }>(
      sql`SELECT key, value FROM pnl_settings ORDER BY key`,
    );
    const settings: Record<string, string> = {};
    for (const r of rows.rows) settings[r.key] = r.value;
    res.json(settings);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.put("/settings/:key", async (req: Request, res: Response) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined || value === null) {
    res.status(400).json({ error: "value is required" });
    return;
  }
  try {
    await db.execute(
      sql`INSERT INTO pnl_settings (key, value, updated_at) VALUES (${key}, ${String(value)}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = ${String(value)}, updated_at = NOW()`,
    );
    res.json({ key, value: String(value) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Overheads CRUD ──────────────────────────────────────────────────────────

router.get("/overheads", async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute<{
      id: number;
      name: string;
      monthly_amount: string;
      created_at: string;
      updated_at: string;
    }>(sql`SELECT id, name, monthly_amount, created_at, updated_at FROM pnl_overheads ORDER BY name`);
    res.json(rows.rows.map((r: { id: number; name: string; monthly_amount: string; created_at: string; updated_at: string }) => ({
      id: r.id,
      name: r.name,
      monthlyAmount: parseFloat(r.monthly_amount),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/overheads", async (req: Request, res: Response) => {
  const { name, monthlyAmount } = req.body;
  if (!name || monthlyAmount === undefined) {
    res.status(400).json({ error: "name and monthlyAmount are required" });
    return;
  }
  try {
    const rows = await db.execute<{ id: number }>(
      sql`INSERT INTO pnl_overheads (name, monthly_amount) VALUES (${name}, ${Number(monthlyAmount)}) RETURNING id`,
    );
    res.json({ id: rows.rows[0].id, name, monthlyAmount: Number(monthlyAmount) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.put("/overheads/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, monthlyAmount } = req.body;
  try {
    await db.execute(
      sql`UPDATE pnl_overheads SET
        name = COALESCE(${name ?? null}, name),
        monthly_amount = COALESCE(${monthlyAmount !== undefined ? Number(monthlyAmount) : null}, monthly_amount),
        updated_at = NOW()
      WHERE id = ${id}`,
    );
    res.json({ id, name, monthlyAmount });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.delete("/overheads/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await db.execute(sql`DELETE FROM pnl_overheads WHERE id = ${id}`);
    res.json({ deleted: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Utils ───────────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }

export default router;
