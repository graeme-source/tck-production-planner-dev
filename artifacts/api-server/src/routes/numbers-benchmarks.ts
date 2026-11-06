/**
 * Benchmarks for the Numbers page panels (Graeme, 5 Nov 2026). Objective I.
 *
 *   GET /api/numbers-benchmarks        every KPI's benchmarks, + may-I-edit
 *   PUT /api/numbers-benchmarks/:kpi   set one KPI's two figures (founder only)
 *
 * Reading is the same gate as the rest of Numbers; changing is the founder
 * alone. The grading itself is production-planner lib/numbers-benchmarks.ts
 * (pure, tested), which also lists the KPIs and what they mean.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireFounder } from "../middleware/founder-access";
import { requireFounderArea } from "../middleware/founder-area-access";
import { validate } from "../middleware/validate";
import { isFounderEmail } from "../lib/founder-email";

const router: IRouter = Router();
router.use(requireFounderArea("founder.numbers"));

const KPIS = [
  "aov", "newCustomerShare", "newCustomers", "newCustomerRevenue", "newCustomerRoas",
  "adSpend", "recurringSubs", "newSubs", "subscriptionRevenue", "conversionRate",
  "adsCostPerResult", "adsPurchaseRoas", "adsCostPerReach",
] as const;

const figure = z.number().min(0).max(999_999_999).nullable();
const BenchmarkBody = z.object({ minimum: figure, stretch: figure });

async function canEdit(userId: number): Promise<boolean> {
  const me = await db.execute<{ email: string | null }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  return isFounderEmail(me.rows[0]?.email);
}

const num = (v: string | null) => (v == null ? null : Number(v));

router.get("/", async (req: Request, res: Response) => {
  try {
    const rows = await db.execute<{ kpi: string; minimum: string | null; stretch: string | null }>(
      sql`SELECT kpi, minimum, stretch FROM numbers_benchmarks`,
    );
    res.json({
      benchmarks: Object.fromEntries(rows.rows.map(r => [r.kpi, { minimum: num(r.minimum), stretch: num(r.stretch) }])),
      canEdit: await canEdit(req.session.userId!),
    });
  } catch (err) {
    console.error("[numbers-benchmarks] read failed:", err);
    res.status(500).json({ error: "Couldn't load the benchmarks" });
  }
});

router.put("/:kpi", requireFounder, validate(BenchmarkBody), async (req: Request, res: Response) => {
  const kpi = req.params["kpi"] as (typeof KPIS)[number];
  if (!KPIS.includes(kpi)) { res.status(404).json({ error: "Unknown KPI" }); return; }
  const { minimum, stretch } = req.body as z.infer<typeof BenchmarkBody>;
  try {
    await db.execute(sql`
      INSERT INTO numbers_benchmarks (kpi, minimum, stretch, updated_by_id, updated_at)
      VALUES (${kpi}, ${minimum}, ${stretch}, ${req.session.userId!}, NOW())
      ON CONFLICT (kpi) DO UPDATE SET minimum = ${minimum}, stretch = ${stretch},
        updated_by_id = ${req.session.userId!}, updated_at = NOW()
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[numbers-benchmarks] save failed:", err);
    res.status(500).json({ error: "Couldn't save that benchmark — nothing was changed." });
  }
});

export default router;
