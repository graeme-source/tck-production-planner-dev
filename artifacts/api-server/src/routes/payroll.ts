/**
 * /api/payroll — Finance → Payroll (Graeme, 2026-10-26). Same access as
 * Finance (the founder and the accountants).
 *
 *   GET  /?from&to        the period's report: hours and gross pay per
 *                         person, sick days, joiners (with their payroll
 *                         paperwork) and leavers (added by hand — Planday
 *                         only marks them after their last payroll). No take-home estimate —
 *                         Graeme removed it 2026-10-26; the bureau's
 *                         figures are the only net pay.
 *   GET  /pdf?from&to     the same as a PDF
 *   POST /email           { from, to, emails[], note? } — PDF + joiners'
 *                         starter forms, logged (migration 0266)
 *   GET  /sends           the send log
 *   POST /leavers         { from, name, lastDay, note? } — add a leaver to
 *                         the period (migration 0267)
 *   DELETE /leavers/:id   take one off again
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
import type { PayrollData } from "../lib/payroll/report-data";
import { renderPayrollPdf, type PayrollPdfInput } from "../lib/payroll/pdf";
import { sendPayrollEmail } from "../lib/payroll/email";
import { loadStarterDocs } from "../lib/payroll/starter-docs";

const router: IRouter = Router();
router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (await resolveFinanceAccess(req)) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
});

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodQuery = z.object({ from: DATE.optional(), to: DATE.optional(), demo: z.enum(["1"]).optional() });

// Made-up people for the TEST server only (?demo=1), so the report and PDF
// can be looked at without Planday. Never on live.
const DEMO_ALLOWED = process.env["NODE_ENV"] !== "production";
function demoPayroll(from: string, to: string): PayrollData {
  const person = (id: number, name: string, shifts: number, hours: number, rate: number, days: number | null, weekHours: number | null) =>
    ({ plandayEmployeeId: id, appUserId: null, name, hours, shifts, hourlyRate: rate, salaried: false, grossPay: Math.round(hours * rate * 100) / 100, contractHoursPerWeek: weekHours, contractDaysPerWeek: days });
  const people = [
    person(1, "Sample Person A", 19, 141.5, 12.21, 5, 37.5), person(2, "Sample Person B", 12, 88, 12.21, 3, 22.5),
    person(3, "Sample Person C", 21, 160.25, 13.5, 5, 40), person(4, "Sample Person D", 8, 52, 12.21, null, 16),
  ];
  return {
    period: { from, to, label: `${payPeriodFor(to).label} (SAMPLE DATA)` },
    people,
    sick: [{ plandayEmployeeId: 2, name: "Sample Person B", date: to.slice(0, 8) + "14", hours: 7.5, contractHoursPerWeek: 22.5, contractDaysPerWeek: 3 }],
    joiners: [{ plandayEmployeeId: 4, appUserId: null, name: "Sample Person D", date: to.slice(0, 8) + "06" }],
    leavers: [],
    totals: { hours: people.reduce((s, p) => s + p.hours, 0), grossPay: Math.round(people.reduce((s, p) => s + p.grossPay, 0) * 100) / 100 },
    warnings: ["Sample data — made-up people so the report can be looked at. Test server only."],
  };
}

function periodOf(q: { from?: string; to?: string }) {
  if (q.from && q.to) return { from: q.from, to: q.to };
  // Default: the period that has just ended (the one being run).
  const current = payPeriodFor(londonDateString());
  return previousPayPeriods(londonDateString(), 1)[0] ?? current;
}

async function buildReport(from: string, to: string, demo = false) {
  const data = demo && DEMO_ALLOWED ? demoPayroll(from, to) : await loadPayrollData(from, to);
  const joinerDocs = await loadStarterDocs(data.joiners.filter(j => j.appUserId != null).map(j => ({ userId: j.appUserId!, name: j.name })));
  const joiners = data.joiners.map(j => ({ ...j, documents: joinerDocs.filter(d => d.userId === j.appUserId).map(d => d.title) }));
  // Leavers come only from the hand-added list: Planday doesn't know yet.
  const leavers = (await db.execute<{ id: number; name: string; date: string; note: string | null; addedBy: string | null }>(sql`
    SELECT id, name, to_char(last_day, 'YYYY-MM-DD') AS date, note, added_by_name AS "addedBy"
      FROM payroll_leavers WHERE period_from = ${from} ORDER BY last_day, name
  `)).rows;
  return { ...data, joiners, leavers, joinerDocs };
}

/** "Wed 14 Oct 2026" — the PDF prints these as given. */
const ukDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function pdfInput(r: Awaited<ReturnType<typeof buildReport>>): PayrollPdfInput {
  return {
    periodLabel: r.period.label,
    generatedAt: new Date().toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    people: r.people.map(p => ({ name: p.name, hours: p.hours, shifts: p.shifts, hourlyRate: p.hourlyRate, grossPay: p.grossPay })),
    totals: r.totals,
    sick: r.sick.map(s => ({ name: s.name, date: ukDay(s.date), hours: s.hours, contractDaysPerWeek: s.contractDaysPerWeek, contractHoursPerWeek: s.contractHoursPerWeek })),
    joiners: r.joiners.map(j => ({ name: j.name, date: ukDay(j.date), documents: j.documents })),
    leavers: r.leavers.map(l => ({ name: l.name, date: ukDay(l.date), note: l.note })),
  };
}

router.get("/", validateQuery(periodQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof periodQuery>;
  const { from, to } = periodOf(q);
  try {
    const { joinerDocs: _docs, ...report } = await buildReport(from, to, q.demo === "1");
    res.json({ ...report, demo: q.demo === "1" && DEMO_ALLOWED, demoAllowed: DEMO_ALLOWED, periods: previousPayPeriods(londonDateString(), 6), current: payPeriodFor(londonDateString()) });
  } catch (err) {
    console.error("[payroll] report failed:", err);
    res.status(502).json({ error: "Couldn't build the payroll report from Planday — try again" });
  }
});

router.get("/pdf", validateQuery(periodQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof periodQuery>;
  const { from, to } = periodOf(q);
  try {
    const r = await buildReport(from, to, q.demo === "1");
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

const leaverBody = z.object({
  from: DATE,
  name: z.string().trim().min(1).max(120),
  lastDay: DATE,
  note: z.string().trim().max(500).nullish(),
});

router.post("/leavers", validate(leaverBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof leaverBody>;
  const by = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId ?? 0}`);
  const row = await db.execute<{ id: number }>(sql`
    INSERT INTO payroll_leavers (period_from, name, last_day, note, added_by, added_by_name)
    VALUES (${b.from}, ${b.name}, ${b.lastDay}, ${b.note || null}, ${req.session.userId ?? null}, ${by.rows[0]?.name ?? null})
    RETURNING id
  `);
  res.json({ ok: true, id: row.rows[0]?.id });
});

router.delete("/leavers/:id", async (req: Request, res: Response) => {
  const id = z.coerce.number().int().positive().safeParse(req.params["id"]);
  if (!id.success) { res.status(400).json({ error: "Bad leaver id" }); return; }
  await db.execute(sql`DELETE FROM payroll_leavers WHERE id = ${id.data}`);
  res.json({ ok: true });
});

export default router;
