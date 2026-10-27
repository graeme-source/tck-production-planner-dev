/**
 * /api/payroll/month-end — the month-end adjustments on Finance → Payroll
 * (Graeme, 27 Oct 2026). Mounted inside routes/payroll.ts, behind its
 * Finance guard (the founder and the accountants). Objective I.
 *
 *   GET  /?from&to | ?monthEnd   the pay period's month end: deferred
 *                                income + 25th → month-end labour, with the
 *                                previous month end (opening) and movement
 *   GET  /lines.csv?monthEnd     that month end's deferred orders
 *   GET  /history                every month end from 31 Mar 2025, grouped
 *                                by financial year
 *   GET  /history.csv            the same as a CSV
 *   POST /recalculate            { monthEnd } — ignore the stored result
 *
 * Shopify and Planday are read-only here; lib/payroll/month-end*.ts does
 * the work.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { getMonthEnd, getMonthEndHistory } from "../lib/payroll/month-end-load";
import { buildSection, summariseMonthEnd, type MonthEndSection } from "../lib/payroll/month-end-report";
import {
  deferredLinesCsv, groupByFinancialYear, historyCsv, lastDayOfMonth, monthEndInPeriod, previousMonthEnd, shortDay,
  type FinancialYearGroup, type HistoryRow,
} from "../lib/payroll/month-end";
import { payPeriodFor, previousPayPeriods } from "../lib/payroll/period";

const router: IRouter = Router();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MONTH_END = DATE.refine(d => lastDayOfMonth(d) === d, "Not the last day of a month");

/** The month end inside a pay period; the default period is the one that
 *  has just ended, as on the report. */
export function monthEndForPeriod(from?: string, to?: string): string {
  const p = from && to ? { from, to } : previousPayPeriods(londonDateString(), 1)[0] ?? payPeriodFor(londonDateString());
  const me = monthEndInPeriod(p.from, p.to);
  if (!me) throw new Error(`${p.from} to ${p.to} holds no month end.`);
  return me;
}

async function userName(req: Request): Promise<string | null> {
  const r = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId ?? 0}`);
  return r.rows[0]?.name ?? null;
}

/** This pay period's month end plus the one before — shared by the page,
 *  the PDF and the email. */
export async function monthEndSection(monthEnd: string, opts: { force?: boolean; by?: string | null } = {}): Promise<MonthEndSection> {
  const before = previousMonthEnd(monthEnd);
  // One after the other: both may read Shopify and Planday.
  const cur = await getMonthEnd(monthEnd, { force: opts.force, computedByName: opts.by ?? null });
  const prev = await getMonthEnd(before, { computedByName: opts.by ?? null }).catch(() => null);
  return buildSection(summariseMonthEnd(cur), prev ? summariseMonthEnd(prev) : null);
}

export async function monthEndHistory(): Promise<{ first: string; last: string; rows: HistoryRow[]; years: FinancialYearGroup[] }> {
  const h = await getMonthEndHistory();
  return { ...h, years: groupByFinancialYear(h.rows) };
}

const sectionQuery = z.object({ from: DATE.optional(), to: DATE.optional(), monthEnd: MONTH_END.optional() });

router.get("/", validateQuery(sectionQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof sectionQuery>;
  try {
    const me = q.monthEnd ?? monthEndForPeriod(q.from, q.to);
    res.json(await monthEndSection(me));
  } catch (err) {
    console.error("[payroll/month-end] failed:", err);
    res.status(502).json({ error: "Couldn't work out the month-end adjustments — try again" });
  }
});

const monthEndQuery = z.object({ monthEnd: MONTH_END });

router.get("/lines.csv", validateQuery(monthEndQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof monthEndQuery>;
  try {
    const r = await getMonthEnd(q.monthEnd);
    if (!r.deferred) { res.status(502).json({ error: r.deferredError ?? "No deferred income for that month end" }); return; }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="TCK deferred orders at ${q.monthEnd}.csv"`);
    res.send(deferredLinesCsv(r.deferred));
  } catch (err) {
    console.error("[payroll/month-end] lines csv failed:", err);
    res.status(502).json({ error: "Couldn't make the CSV — try again" });
  }
});

router.get("/history", async (_req: Request, res: Response) => {
  try {
    res.json(await monthEndHistory());
  } catch (err) {
    console.error("[payroll/month-end] history failed:", err);
    res.status(502).json({ error: "Couldn't work out the month-end history — try again" });
  }
});

router.get("/history.csv", async (_req: Request, res: Response) => {
  try {
    const h = await monthEndHistory();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="TCK month-end adjustments ${h.first} to ${h.last}.csv"`);
    res.send(historyCsv(h.rows));
  } catch (err) {
    console.error("[payroll/month-end] history csv failed:", err);
    res.status(502).json({ error: "Couldn't make the CSV — try again" });
  }
});

const recalcBody = z.object({ monthEnd: MONTH_END });

router.post("/recalculate", validate(recalcBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof recalcBody>;
  try {
    res.json(await monthEndSection(b.monthEnd, { force: true, by: await userName(req) }));
  } catch (err) {
    console.error("[payroll/month-end] recalculate failed:", err);
    res.status(502).json({ error: `Couldn't recalculate ${shortDay(b.monthEnd)} — try again` });
  }
});

export default router;
