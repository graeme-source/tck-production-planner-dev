/**
 * /api/payroll — Finance → Payroll (Graeme, 2026-10-26). Same access as
 * Finance (the founder and the accountants).
 *
 *   GET  /?from&to        the period's report: hours, pay and estimated
 *                         take-home per person, sick days, joiners (with
 *                         their payroll paperwork) and leavers
 *   GET  /pdf?from&to     the same as a PDF
 *   POST /email           { from, to, emails[], note? } — PDF + joiners'
 *                         starter forms, logged (migration 0266)
 *   GET  /sends           the send log
 *
 * Planday is read-only here; lib/payroll/* does the work.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { resolveFinanceAccess } from "./finance";
import { payPeriodFor, previousPayPeriods } from "../lib/payroll/period";
import { loadPayrollData } from "../lib/payroll/load";
import { estimateNetPay } from "../lib/payroll/net-pay";
import { renderPayrollPdf, type PayrollPdfInput } from "../lib/payroll/pdf";
import { sendPayrollEmail } from "../lib/payroll/email";
import { loadStarterDocs } from "../lib/payroll/starter-docs";

const router: IRouter = Router();
router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (await resolveFinanceAccess(req)) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
});

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodQuery = z.object({ from: DATE.optional(), to: DATE.optional() });

function periodOf(q: { from?: string; to?: string }) {
  if (q.from && q.to) return { from: q.from, to: q.to };
  // Default: the period that has just ended (the one being run).
  const current = payPeriodFor(londonDateString());
  return previousPayPeriods(londonDateString(), 1)[0] ?? current;
}

async function buildReport(from: string, to: string) {
  const data = await loadPayrollData(from, to);
  const people = data.people.map(p => {
    const est = p.grossPay > 0 ? estimateNetPay(p.grossPay) : null;
    return { ...p, netEstimate: est ? est.net : null };
  });
  const assumptions = data.people.length ? (estimateNetPay(1000).assumptions ?? []) : [];
  const joinerDocs = await loadStarterDocs(data.joiners.filter(j => j.appUserId != null).map(j => ({ userId: j.appUserId!, name: j.name })));
  const joiners = data.joiners.map(j => ({ ...j, documents: joinerDocs.filter(d => d.userId === j.appUserId).map(d => d.title) }));
  const totals = { ...data.totals, netEstimate: Math.round(people.reduce((s, p) => s + (p.netEstimate ?? 0), 0) * 100) / 100 };
  return { ...data, people, joiners, totals, assumptions, joinerDocs };
}

/** "Wed 14 Oct 2026" — the PDF prints these as given. */
const ukDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function pdfInput(r: Awaited<ReturnType<typeof buildReport>>): PayrollPdfInput {
  return {
    periodLabel: r.period.label,
    generatedAt: new Date().toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    people: r.people.map(p => ({ name: p.name, hours: p.hours, shifts: p.shifts, hourlyRate: p.hourlyRate, grossPay: p.grossPay, netEstimate: p.netEstimate })),
    totals: r.totals,
    sick: r.sick.map(s => ({ name: s.name, date: ukDay(s.date), hours: s.hours, contractDaysPerWeek: s.contractDaysPerWeek, contractHoursPerWeek: s.contractHoursPerWeek })),
    joiners: r.joiners.map(j => ({ name: j.name, date: ukDay(j.date), documents: j.documents })),
    leavers: r.leavers.map(l => ({ name: l.name, date: ukDay(l.date) })),
    assumptions: r.assumptions,
  };
}

router.get("/", validateQuery(periodQuery), async (_req: Request, res: Response) => {
  const { from, to } = periodOf(res.locals["query"] as z.infer<typeof periodQuery>);
  try {
    const { joinerDocs: _docs, ...report } = await buildReport(from, to);
    res.json({ ...report, periods: previousPayPeriods(londonDateString(), 6), current: payPeriodFor(londonDateString()) });
  } catch (err) {
    console.error("[payroll] report failed:", err);
    res.status(502).json({ error: "Couldn't build the payroll report from Planday — try again" });
  }
});

router.get("/pdf", validateQuery(periodQuery), async (_req: Request, res: Response) => {
  const { from, to } = periodOf(res.locals["query"] as z.infer<typeof periodQuery>);
  try {
    const r = await buildReport(from, to);
    const pdf = await renderPayrollPdf(pdfInput(r));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="TCK payroll ${from} to ${to}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("[payroll] pdf failed:", err);
    res.status(502).json({ error: "Couldn't make the PDF — try again" });
  }
});

const emailBody = z.object({
  from: DATE, to: DATE,
  emails: z.array(z.string().trim().email()).min(1).max(10),
  note: z.string().trim().max(1000).nullish(),
  includeStarterForms: z.boolean().default(true),
});

router.post("/email", validate(emailBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof emailBody>;
  const by = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId ?? 0}`);
  const sentByName = by.rows[0]?.name ?? "TCK";
  let ok = false, error: string | null = null, attached: string[] = [];
  try {
    const r = await buildReport(b.from, b.to);
    const pdf = await renderPayrollPdf(pdfInput(r));
    const extras = b.includeStarterForms ? r.joinerDocs.map(d => ({ filename: d.filename, content: d.content, contentType: d.contentType })) : [];
    attached = [`TCK payroll ${b.from} to ${b.to}.pdf`, ...extras.map(e => e.filename)];
    const sent = await sendPayrollEmail({ to: b.emails, periodLabel: r.period.label, pdf, attachments: extras, note: b.note ?? undefined, sentByName });
    ok = sent.ok; error = sent.error ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await db.execute(sql`
    INSERT INTO payroll_report_sends (period_from, period_to, sent_to, attachments, sent_by, sent_by_name, ok, error)
    VALUES (${b.from}, ${b.to}, ${`{${b.emails.map(e => `"${e.replace(/"/g, "")}"`).join(",")}}`}::text[],
            ${`{${attached.map(a => `"${a.replace(/"/g, "")}"`).join(",")}}`}::text[], ${req.session.userId ?? null}, ${sentByName}, ${ok}, ${error})
  `);
  if (!ok) { res.status(502).json({ error: error ?? "Couldn't send the email" }); return; }
  res.json({ ok: true, attached });
});

router.get("/sends", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT id, to_char(period_from, 'YYYY-MM-DD') AS "from", to_char(period_to, 'YYYY-MM-DD') AS "to", sent_to AS "sentTo",
           attachments, sent_by_name AS "sentBy", ok, error, sent_at AS "sentAt"
      FROM payroll_report_sends ORDER BY sent_at DESC LIMIT 50
  `);
  res.json({ sends: rows.rows });
});

export default router;
