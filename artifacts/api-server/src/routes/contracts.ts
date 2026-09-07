/**
 * Employment contracts (Graeme, 2026-09-07).
 *
 * One master template, kept and edited by the founder inside the app.
 * Generation takes the master, fills {{employee_name}} / {{issue_date}} /
 * {{start_date}} / {{rate_of_pay}} / {{job_title}} / {{weekly_hours}}, and
 * stores the result as an immutable snapshot addressed to exactly one
 * employee, who sees it in their Employee Hub.
 *
 * Privacy is enforced HERE, not in the UI (the lesson of the 2026-09-04
 * to-do leak): a contract crosses the wire only to its owner or the
 * founder. /mine takes NO user parameter — it reads the session and nothing
 * else — and the by-id read re-checks ownership on the server every time.
 * Pay is personal data: not even admins/managers get another person's
 * contract; the founder gate is the ACCOUNT (same rule as founder-focus),
 * not the role.
 */
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { db, contractTemplatesTable, employmentContractsTable, usersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { renderContract, contractDate, templatePlaceholders, applySignature, CONTRACT_FIELDS } from "../lib/contract-render";
import { renderContractPdf } from "../pdf/contract-pdf";

// Columns for reads that display a contract — everything except the
// archival PDF bytes, which only ever leave through /:id/signed.pdf.
const CONTRACT_COLUMNS = {
  id: employmentContractsTable.id,
  userId: employmentContractsTable.userId,
  templateId: employmentContractsTable.templateId,
  body: employmentContractsTable.body,
  employeeName: employmentContractsTable.employeeName,
  jobTitle: employmentContractsTable.jobTitle,
  rateOfPay: employmentContractsTable.rateOfPay,
  weeklyHours: employmentContractsTable.weeklyHours,
  startDate: employmentContractsTable.startDate,
  issueDate: employmentContractsTable.issueDate,
  issuedBy: employmentContractsTable.issuedBy,
  issuedAt: employmentContractsTable.issuedAt,
  acknowledgedAt: employmentContractsTable.acknowledgedAt,
  signedInitials: employmentContractsTable.signedInitials,
} as const;

const router: IRouter = Router();

// Same founder gate as founder-focus/founder-panels: contracts carry pay,
// so role checks aren't enough — the account itself must be the founder's.
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

async function isFounder(req: Request): Promise<boolean> {
  const userId = req.session.userId;
  if (!userId) return false;
  const rows = await db.execute<{ email: string }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  return rows.rows[0]?.email === FOUNDER_EMAIL;
}

async function requireFounder(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!(await isFounder(req))) { res.status(403).json({ error: "Founder only" }); return; }
  next();
}

function requireSession(req: Request, res: Response): number | null {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return userId;
}

/** Notify without ever letting a missed bell fail the action itself. */
async function notify(userId: number, message: string) {
  try {
    await db.execute(sql`
      INSERT INTO notifications (user_id, type, message, read)
      VALUES (${userId}, ${"contract"}, ${message.slice(0, 500)}, false)
    `);
  } catch (err) {
    console.warn("[Contracts] notification insert failed:", err instanceof Error ? err.message : err);
  }
}

// ── Founder: the master template ───────────────────────────────────────────

router.get("/template", requireFounder, async (_req: Request, res: Response) => {
  const [tpl] = await db.select().from(contractTemplatesTable).orderBy(contractTemplatesTable.id).limit(1);
  if (!tpl) { res.status(404).json({ error: "No master template — has migration 0082 run?" }); return; }
  res.json({ ...tpl, placeholders: templatePlaceholders(tpl.body), knownFields: CONTRACT_FIELDS });
});

const TemplateBody = z.object({
  body: z.string().min(100, "That doesn't look like a whole contract"),
  name: z.string().min(1).max(200).optional(),
  defaultJobTitle: z.string().min(1).max(200).optional(),
  defaultWeeklyHours: z.string().min(1).max(50).optional(),
});

router.put("/template", requireFounder, validate(TemplateBody), async (req: Request, res: Response) => {
  const { body, name, defaultJobTitle, defaultWeeklyHours } = req.body as z.infer<typeof TemplateBody>;

  // Refuse a master that generation could never fill — losing a
  // placeholder (or inventing one) should fail at save, in front of the
  // founder, not at generation time in front of a new starter.
  const unknown = templatePlaceholders(body).filter(p => !(CONTRACT_FIELDS as readonly string[]).includes(p));
  if (unknown.length > 0) {
    res.status(400).json({ error: `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map(p => `{{${p}}}`).join(", ")}. The generator can fill: ${CONTRACT_FIELDS.map(f => `{{${f}}}`).join(", ")}` });
    return;
  }

  const [tpl] = await db.select({ id: contractTemplatesTable.id }).from(contractTemplatesTable).orderBy(contractTemplatesTable.id).limit(1);
  if (!tpl) { res.status(404).json({ error: "No master template — has migration 0082 run?" }); return; }

  const [updated] = await db.update(contractTemplatesTable)
    .set({
      body,
      ...(name != null ? { name } : {}),
      ...(defaultJobTitle != null ? { defaultJobTitle } : {}),
      ...(defaultWeeklyHours != null ? { defaultWeeklyHours } : {}),
      updatedBy: req.session.userId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(contractTemplatesTable.id, tpl.id))
    .returning();
  res.json({ ...updated, placeholders: templatePlaceholders(updated.body), knownFields: CONTRACT_FIELDS });
});

// ── Founder: people picker + issued list ───────────────────────────────────

router.get("/people", requireFounder, async (_req: Request, res: Response) => {
  const people = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, isActive: usersTable.isActive })
    .from(usersTable)
    .orderBy(usersTable.name);
  res.json(people.filter(p => p.isActive));
});

router.get("/issued", requireFounder, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: employmentContractsTable.id,
      userId: employmentContractsTable.userId,
      employeeName: employmentContractsTable.employeeName,
      jobTitle: employmentContractsTable.jobTitle,
      rateOfPay: employmentContractsTable.rateOfPay,
      weeklyHours: employmentContractsTable.weeklyHours,
      startDate: employmentContractsTable.startDate,
      issueDate: employmentContractsTable.issueDate,
      issuedAt: employmentContractsTable.issuedAt,
      acknowledgedAt: employmentContractsTable.acknowledgedAt,
      signedInitials: employmentContractsTable.signedInitials,
    })
    .from(employmentContractsTable)
    .orderBy(desc(employmentContractsTable.issuedAt));
  res.json(rows);
});

// ── Founder: preview + generate ────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const GenerateBody = z.object({
  userId: z.number().int(),
  rateOfPay: z.string().min(1).max(50),
  jobTitle: z.string().min(1).max(200),
  weeklyHours: z.string().min(1).max(50),
  startDate: z.string().regex(DATE_RE, "startDate must be YYYY-MM-DD"),
  issueDate: z.string().regex(DATE_RE, "issueDate must be YYYY-MM-DD").optional(),
});

async function renderForUser(input: z.infer<typeof GenerateBody>): Promise<
  | { ok: true; body: string; employeeName: string; issueDate: string; templateId: number }
  | { ok: false; status: number; error: string }
> {
  const [tpl] = await db.select().from(contractTemplatesTable).orderBy(contractTemplatesTable.id).limit(1);
  if (!tpl) return { ok: false, status: 404, error: "No master template — has migration 0082 run?" };

  const [person] = await db
    .select({ id: usersTable.id, name: usersTable.name, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, input.userId));
  if (!person) return { ok: false, status: 400, error: "No such person" };
  if (!person.isActive) return { ok: false, status: 400, error: `${person.name} is deactivated — reactivate them before issuing a contract` };

  const issueDate = input.issueDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  let body: string;
  try {
    body = renderContract(tpl.body, {
      employee_name: person.name,
      issue_date: contractDate(issueDate),
      start_date: contractDate(input.startDate),
      rate_of_pay: input.rateOfPay.trim(),
      job_title: input.jobTitle.trim(),
      weekly_hours: input.weeklyHours.trim(),
    });
  } catch (err) {
    return { ok: false, status: 400, error: err instanceof Error ? err.message : "Could not render the contract" };
  }
  return { ok: true, body, employeeName: person.name, issueDate, templateId: tpl.id };
}

// Preview is generation without the write — the founder reads exactly what
// would be issued, filled with the real values, before committing.
router.post("/preview", requireFounder, validate(GenerateBody), async (req: Request, res: Response) => {
  const out = await renderForUser(req.body as z.infer<typeof GenerateBody>);
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
  res.json({ body: out.body, employeeName: out.employeeName, issueDate: out.issueDate });
});

router.post("/generate", requireFounder, validate(GenerateBody), async (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof GenerateBody>;
  const out = await renderForUser(input);
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }

  const [row] = await db.insert(employmentContractsTable).values({
    userId: input.userId,
    templateId: out.templateId,
    body: out.body,
    employeeName: out.employeeName,
    jobTitle: input.jobTitle.trim(),
    rateOfPay: input.rateOfPay.trim(),
    weeklyHours: input.weeklyHours.trim(),
    startDate: input.startDate,
    issueDate: out.issueDate,
    issuedBy: req.session.userId ?? null,
  }).returning();

  await notify(input.userId, "Your employment contract is ready in your Employee Hub — please read and sign it.");
  res.json(row);
});

// A mis-issued contract can be withdrawn — but never once the employee has
// acknowledged it: from that moment it is a record, not a draft.
router.delete("/:id", requireFounder, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid contract id" }); return; }
  const [row] = await db.select().from(employmentContractsTable).where(eq(employmentContractsTable.id, id));
  if (!row) { res.status(404).json({ error: "No such contract" }); return; }
  if (row.acknowledgedAt) {
    res.status(400).json({ error: "This contract has been signed by the employee — it is a record now and can't be withdrawn" });
    return;
  }
  await db.delete(employmentContractsTable).where(eq(employmentContractsTable.id, id));
  res.json({ ok: true });
});

// ── Employee: my contracts ─────────────────────────────────────────────────

// The founder's handwritten signature, rendered onto the employer signature
// line. Served to signed-in users only — deliberately NOT a public frontend
// asset, so the signature image can't be fetched anonymously. Read lazily
// and served from memory (res.sendFile's send() stack 404'd on this
// worktree path, and 19KB doesn't need streaming anyway).
const FOUNDER_SIGNATURE_FILE = path.resolve(import.meta.dirname, "../data/founder-signature.png");
let founderSignatureBytes: Buffer | null = null;

router.get("/founder-signature.png", async (req: Request, res: Response) => {
  if (requireSession(req, res) == null) return;
  try {
    if (!founderSignatureBytes) {
      const { readFile } = await import("node:fs/promises");
      founderSignatureBytes = await readFile(FOUNDER_SIGNATURE_FILE);
    }
  } catch (err) {
    console.error("[Contracts] founder signature image unreadable:", err);
    res.status(404).json({ error: "Signature image not available" });
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(founderSignatureBytes);
});

// Deliberately takes NO user parameter: the session is the only selector, so
// there is no request shape that can ask for someone else's contract.
router.get("/mine", async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const rows = await db
    .select(CONTRACT_COLUMNS)
    .from(employmentContractsTable)
    .where(eq(employmentContractsTable.userId, userId))
    .orderBy(desc(employmentContractsTable.issuedAt));
  res.json(rows);
});

// The archival hard copy. Owner or founder only; regenerated and backfilled
// from the frozen body if a signed row is somehow missing its PDF (the DB
// trigger allows exactly that one write).
router.get("/:id/signed.pdf", async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid contract id" }); return; }
  const [row] = await db.select().from(employmentContractsTable).where(eq(employmentContractsTable.id, id));
  if (!row || (row.userId !== userId && !(await isFounder(req)))) {
    res.status(404).json({ error: "No such contract" });
    return;
  }
  if (!row.acknowledgedAt) { res.status(400).json({ error: "This contract hasn't been signed yet" }); return; }

  let pdf = row.signedPdf;
  if (!pdf) {
    pdf = await renderContractPdf(row.body);
    await db.update(employmentContractsTable).set({ signedPdf: pdf }).where(eq(employmentContractsTable.id, id));
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="TCK-contract-${row.employeeName.replace(/[^A-Za-z0-9]+/g, "-")}-${row.issueDate}.pdf"`);
  res.send(pdf);
});

router.get("/:id", async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid contract id" }); return; }
  const [row] = await db.select(CONTRACT_COLUMNS).from(employmentContractsTable).where(eq(employmentContractsTable.id, id));
  // Same response whether the contract doesn't exist or isn't yours — a 403
  // here would confirm to a guesser that the id exists.
  if (!row || (row.userId !== userId && !(await isFounder(req)))) {
    res.status(404).json({ error: "No such contract" });
    return;
  }
  res.json(row);
});

// Only the person the contract belongs to can sign — not the founder, not
// an admin. Their typed initials are written INTO the stored body (employee
// signature line + an appended electronic-signature record), so the body is
// the signed document from that moment on.
const SignBody = z.object({
  initials: z.string().trim().min(2, "At least two characters").max(12),
});

router.post("/:id/sign", validate(SignBody), async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid contract id" }); return; }
  const { initials } = req.body as z.infer<typeof SignBody>;

  const [row] = await db.select().from(employmentContractsTable).where(eq(employmentContractsTable.id, id));
  if (!row || row.userId !== userId) { res.status(404).json({ error: "No such contract" }); return; }
  if (row.acknowledgedAt) { res.json(row); return; }

  const signedAt = new Date();
  const signedOn = signedAt.toLocaleString("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  });
  let signedBody: string;
  try {
    signedBody = applySignature(row.body, { employeeName: row.employeeName, initials, signedOn });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not sign" });
    return;
  }

  // The archival hard copy, frozen at the moment of signing. A PDF failure
  // must not lose the signature itself — the PDF is deterministic from the
  // signed body, and /:id/signed.pdf backfills it on first download.
  let signedPdf: Buffer | null = null;
  try {
    signedPdf = await renderContractPdf(signedBody);
  } catch (err) {
    console.error("[Contracts] signed-PDF render failed (will backfill on download):", err);
  }

  const [updated] = await db.update(employmentContractsTable)
    .set({ acknowledgedAt: signedAt, signedInitials: initials.trim(), body: signedBody, ...(signedPdf ? { signedPdf } : {}) })
    .where(eq(employmentContractsTable.id, id))
    .returning(CONTRACT_COLUMNS);
  res.json(updated);
});

export default router;
