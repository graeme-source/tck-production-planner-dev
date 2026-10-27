/**
 * /api/starter-payroll — new-starter payroll paperwork to the accountant
 * (Graeme, 27 Oct 2026). Objectives B and I. Logic: lib/payroll/starter-send*.
 *
 *   GET  /accountant-email   { email, canEdit } — Finance (founder +
 *                            bookkeepers) or HR-records access may read
 *   PUT  /accountant-email   { email } — founder only ("" clears it)
 *   GET  /status             each starter's paperwork + send state — HR
 *                            records access (founder, Lorna)
 *   POST /send               { userId } — founder only: send now / again
 *
 * The automatic send itself is triggered from routes/starter-forms.ts
 * (signing) and routes/onboarding.ts (first details submit).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireFounder } from "../middleware/founder-access";
import { hasHrRecordAccess, requireHrRecordAccess } from "../middleware/hr-access";
import { isFounderEmail } from "../lib/founder-email";
import { resolveFinanceAccess } from "./finance";
import { getAccountantEmail, setAccountantEmail, sendStarterPayrollNow, starterPayrollStatuses } from "../lib/payroll/starter-send";

const router: IRouter = Router();

async function isFounder(req: Request): Promise<boolean> {
  if (!req.session.userId) return false;
  const r = await db.execute<{ email: string }>(sql`SELECT email FROM app_users WHERE id = ${req.session.userId}`);
  return isFounderEmail(r.rows[0]?.email ?? "");
}

router.get("/accountant-email", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!(await resolveFinanceAccess(req)) && !(await hasHrRecordAccess(req))) { res.status(403).json({ error: "Finance access required" }); return; }
  res.json({ email: await getAccountantEmail(), canEdit: await isFounder(req) });
});

const emailBody = z.object({ email: z.union([z.string().trim().email(), z.literal("")]) });

router.put("/accountant-email", requireFounder, validate(emailBody), async (req: Request, res: Response) => {
  const { email } = req.body as z.infer<typeof emailBody>;
  await setAccountantEmail(email.trim() || null);
  res.json({ email: await getAccountantEmail() });
});

router.get("/status", requireHrRecordAccess, async (req: Request, res: Response) => {
  try {
    // Anyone who has started a starter form or been sent before.
    const ids = await db.execute<{ user_id: number }>(sql`
      SELECT DISTINCT user_id FROM starter_form_submissions
      UNION SELECT DISTINCT user_id FROM starter_payroll_sends
    `);
    const [statuses, accountantEmail, canSend] = await Promise.all([
      starterPayrollStatuses(ids.rows.map(r => Number(r.user_id))),
      getAccountantEmail(),
      isFounder(req),
    ]);
    res.json({ statuses, accountantEmailSet: accountantEmail != null, canSend });
  } catch (err) {
    console.error("[starter-payroll] status failed:", err);
    res.status(500).json({ error: "Couldn't load the payroll paperwork status" });
  }
});

const sendBody = z.object({ userId: z.number().int().positive() });

router.post("/send", requireFounder, validate(sendBody), async (req: Request, res: Response) => {
  const { userId } = req.body as z.infer<typeof sendBody>;
  const by = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId ?? 0}`);
  try {
    const r = await sendStarterPayrollNow(userId, { id: req.session.userId ?? null, name: by.rows[0]?.name ?? null });
    if (!r.ok) { res.status(400).json({ error: r.error ?? "Couldn't send" }); return; }
    res.json({ ok: true, documents: r.documents });
  } catch (err) {
    console.error("[starter-payroll] manual send failed:", err);
    res.status(500).json({ error: "Couldn't send — try again" });
  }
});

export default router;
