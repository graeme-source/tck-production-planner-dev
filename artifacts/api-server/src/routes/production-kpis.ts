/**
 * Production KPIs (Graeme, 13 Nov 2026) — each station's standard and
 * stretch in one table, so the dashboard tiles, the wrapping station and the
 * packing screen judge against the same numbers. Objective G.
 *
 *   GET /api/production-kpis        every KPI + may-I-edit (anyone signed in:
 *                                   the stations read it)
 *   PUT /api/production-kpis/:kpi   set one KPI's standard + stretch (founder)
 *
 * Grading lives in production-planner lib/production-kpis.ts (pure, tested).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireFounder } from "../middleware/founder-access";
import { validate } from "../middleware/validate";
import { isFounderEmail } from "../lib/founder-email";

const router: IRouter = Router();

export const PRODUCTION_KPIS = ["packing", "wrapping"] as const;
type ProductionKpi = (typeof PRODUCTION_KPIS)[number];

const KpiBody = z.object({
  standard: z.number().positive().max(100_000),
  stretch: z.number().positive().max(100_000).nullable(),
}).refine(b => b.stretch == null || b.stretch > b.standard, { message: "The stretch has to be above the standard.", path: ["stretch"] });

const num = (v: string | null) => (v == null ? null : Number(v));

router.get("/", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const [rows, me] = await Promise.all([
      db.execute<{ kpi: string; standard: string; stretch: string | null; updated_at: string | null }>(
        sql`SELECT kpi, standard, stretch, updated_at::text AS updated_at FROM production_kpis`,
      ),
      db.execute<{ email: string | null }>(sql`SELECT email FROM app_users WHERE id = ${req.session.userId} LIMIT 1`),
    ]);
    res.json({
      kpis: Object.fromEntries(rows.rows.map(r => [r.kpi, { standard: Number(r.standard), stretch: num(r.stretch), updatedAt: r.updated_at }])),
      canEdit: isFounderEmail(me.rows[0]?.email),
    });
  } catch (err) {
    console.error("[production-kpis] read failed:", err);
    res.status(500).json({ error: "Couldn't load the production KPIs" });
  }
});

router.put("/:kpi", requireFounder, validate(KpiBody), async (req: Request, res: Response) => {
  const kpi = req.params["kpi"] as ProductionKpi;
  if (!PRODUCTION_KPIS.includes(kpi)) { res.status(404).json({ error: "Unknown KPI" }); return; }
  const { standard, stretch } = req.body as z.infer<typeof KpiBody>;
  try {
    await db.execute(sql`
      INSERT INTO production_kpis (kpi, standard, stretch, updated_by_id, updated_at)
      VALUES (${kpi}, ${standard}, ${stretch}, ${req.session.userId!}, NOW())
      ON CONFLICT (kpi) DO UPDATE SET standard = ${standard}, stretch = ${stretch},
        updated_by_id = ${req.session.userId!}, updated_at = NOW()
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[production-kpis] save failed:", err);
    res.status(500).json({ error: "Couldn't save that KPI — nothing was changed." });
  }
});

export default router;
