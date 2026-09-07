/**
 * Starter forms (Graeme, 2026-09-07): HMRC starter checklist, payroll
 * details, health questionnaire — filled and signed in the app instead of on
 * paper. See lib/starter-forms.ts for the definitions.
 *
 * Access follows the contracts rules to the letter (these carry bank
 * details, NI numbers and health answers):
 *   - /mine takes NO user parameter — the session is the only selector.
 *   - By-id reads answer 404 whether the row is missing or just not yours.
 *   - Cross-user reads need HR-records access (middleware/hr-access.ts) —
 *     the founder's account today, the finance director when they join.
 *     Admin/manager roles do NOT qualify.
 *   - Drafts autosave; signing freezes answers + rendered body + archival
 *     PDF, and DB triggers make signed rows undeletable (migration 0086).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, starterFormSubmissionsTable, usersTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { hasHrRecordAccess, requireHrRecordAccess } from "../middleware/hr-access";
import {
  STARTER_FORMS, STARTER_FORM_TYPES, missingRequiredFields, renderStarterFormBody,
  type StarterFormAnswers,
} from "../lib/starter-forms";
import { maybeTickStarterPaperwork, grantAppAccess } from "../lib/starter-paperwork";
import { renderContractPdf } from "../pdf/contract-pdf";

const router: IRouter = Router();

function requireSession(req: Request, res: Response): number | null {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return userId;
}

// Answers are field-keyed strings (or string arrays for checkboxes). Size
// caps keep a hostile payload from becoming a stored blob.
const AnswersSchema = z.record(
  z.string().max(100),
  z.union([z.string().max(4000), z.array(z.string().max(200)).max(20)]),
);

const FormTypeSchema = z.enum(STARTER_FORM_TYPES as [string, ...string[]]);

// ── Definitions ────────────────────────────────────────────────────────────

router.get("/definitions", (req: Request, res: Response) => {
  if (requireSession(req, res) == null) return;
  res.json(Object.values(STARTER_FORMS));
});

// ── Mine ───────────────────────────────────────────────────────────────────

router.get("/mine", async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const rows = await db
    .select({
      id: starterFormSubmissionsTable.id,
      formType: starterFormSubmissionsTable.formType,
      answers: starterFormSubmissionsTable.answers,
      body: starterFormSubmissionsTable.body,
      signedAt: starterFormSubmissionsTable.signedAt,
      signedInitials: starterFormSubmissionsTable.signedInitials,
      updatedAt: starterFormSubmissionsTable.updatedAt,
    })
    .from(starterFormSubmissionsTable)
    .where(eq(starterFormSubmissionsTable.userId, userId));
  res.json(rows);
});

const DraftBody = z.object({ answers: AnswersSchema });

// Autosaved draft — refuses to touch a signed submission.
router.put("/mine/:formType", validate(DraftBody), async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const parsed = FormTypeSchema.safeParse(req.params.formType);
  if (!parsed.success) { res.status(400).json({ error: "Unknown form" }); return; }
  const formType = parsed.data;
  const { answers } = req.body as z.infer<typeof DraftBody>;

  const [existing] = await db.select({ id: starterFormSubmissionsTable.id, signedAt: starterFormSubmissionsTable.signedAt })
    .from(starterFormSubmissionsTable)
    .where(and(eq(starterFormSubmissionsTable.userId, userId), eq(starterFormSubmissionsTable.formType, formType)));
  if (existing?.signedAt) { res.status(400).json({ error: "This form is signed — it can't be changed" }); return; }

  const [row] = existing
    ? await db.update(starterFormSubmissionsTable)
        .set({ answers, updatedAt: new Date() })
        .where(eq(starterFormSubmissionsTable.id, existing.id))
        .returning({ id: starterFormSubmissionsTable.id, updatedAt: starterFormSubmissionsTable.updatedAt })
    : await db.insert(starterFormSubmissionsTable)
        .values({ userId, formType, answers })
        .returning({ id: starterFormSubmissionsTable.id, updatedAt: starterFormSubmissionsTable.updatedAt });
  res.json(row);
});

const SignBody = z.object({
  initials: z.string().trim().min(2, "At least two characters").max(12),
  answers: AnswersSchema,
});

router.post("/mine/:formType/sign", validate(SignBody), async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const parsed = FormTypeSchema.safeParse(req.params.formType);
  if (!parsed.success) { res.status(400).json({ error: "Unknown form" }); return; }
  const formType = parsed.data;
  const def = STARTER_FORMS[formType];
  const { initials, answers } = req.body as z.infer<typeof SignBody>;

  const missing = missingRequiredFields(def, answers as StarterFormAnswers);
  if (missing.length > 0) {
    res.status(400).json({ error: `Still needed before signing: ${missing.slice(0, 4).join("; ")}${missing.length > 4 ? ` — and ${missing.length - 4} more` : ""}` });
    return;
  }

  const [existing] = await db.select({ id: starterFormSubmissionsTable.id, signedAt: starterFormSubmissionsTable.signedAt })
    .from(starterFormSubmissionsTable)
    .where(and(eq(starterFormSubmissionsTable.userId, userId), eq(starterFormSubmissionsTable.formType, formType)));
  if (existing?.signedAt) { res.status(400).json({ error: "This form is already signed" }); return; }

  const [person] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  const signedAt = new Date();
  const signedOn = signedAt.toLocaleString("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  });
  const body = renderStarterFormBody(def, answers as StarterFormAnswers, {
    employeeName: person?.name ?? "Unknown", initials: initials.trim(), signedOn,
  });

  // Archival hard copy — deterministic from the frozen body, so a render
  // failure never blocks the signature (the download backfills it).
  let signedPdf: Buffer | null = null;
  try {
    signedPdf = await renderContractPdf(body);
  } catch (err) {
    console.error("[StarterForms] signed-PDF render failed (will backfill on download):", err);
  }

  const values = {
    answers, body, signedInitials: initials.trim(), signedAt,
    ...(signedPdf ? { signedPdf } : {}), updatedAt: signedAt,
  };
  const [row] = existing
    ? await db.update(starterFormSubmissionsTable).set(values)
        .where(eq(starterFormSubmissionsTable.id, existing.id))
        .returning({ id: starterFormSubmissionsTable.id, signedAt: starterFormSubmissionsTable.signedAt })
    : await db.insert(starterFormSubmissionsTable)
        .values({ userId, formType, ...values })
        .returning({ id: starterFormSubmissionsTable.id, signedAt: starterFormSubmissionsTable.signedAt });

  // The last signature may complete the starter paperwork — tick the
  // onboarding matrix. The app stays gated until the founder grants access
  // on their first day; never let the tick fail the signing.
  maybeTickStarterPaperwork(userId).catch(err =>
    console.warn("[StarterForms] starter-paperwork tick failed:", err instanceof Error ? err.message : err));

  res.json(row);
});

// ── Reads by id (owner or HR access) ───────────────────────────────────────

router.get("/submission/:id", async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db
    .select({
      id: starterFormSubmissionsTable.id,
      userId: starterFormSubmissionsTable.userId,
      formType: starterFormSubmissionsTable.formType,
      body: starterFormSubmissionsTable.body,
      signedAt: starterFormSubmissionsTable.signedAt,
      signedInitials: starterFormSubmissionsTable.signedInitials,
    })
    .from(starterFormSubmissionsTable)
    .where(eq(starterFormSubmissionsTable.id, id));
  if (!row || (row.userId !== userId && !(await hasHrRecordAccess(req)))) {
    res.status(404).json({ error: "No such form" });
    return;
  }
  res.json(row);
});

router.get("/submission/:id/signed.pdf", async (req: Request, res: Response) => {
  const userId = requireSession(req, res);
  if (userId == null) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(starterFormSubmissionsTable).where(eq(starterFormSubmissionsTable.id, id));
  if (!row || (row.userId !== userId && !(await hasHrRecordAccess(req)))) {
    res.status(404).json({ error: "No such form" });
    return;
  }
  if (!row.signedAt || !row.body) { res.status(400).json({ error: "This form hasn't been signed yet" }); return; }

  let pdf = row.signedPdf;
  if (!pdf) {
    pdf = await renderContractPdf(row.body);
    await db.update(starterFormSubmissionsTable).set({ signedPdf: pdf }).where(eq(starterFormSubmissionsTable.id, id));
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="TCK-${row.formType}-${row.userId}.pdf"`);
  res.send(pdf);
});

// ── HR overview (founder / finance director) ───────────────────────────────

router.get("/overview", requireHrRecordAccess, async (_req: Request, res: Response) => {
  const [people, submissions] = await Promise.all([
    db.select({
      id: usersTable.id,
      name: usersTable.name,
      isActive: usersTable.isActive,
      onboardingRequired: usersTable.onboardingRequired,
      onboardingCompletedAt: usersTable.onboardingCompletedAt,
    }).from(usersTable).orderBy(usersTable.name),
    db.select({
      id: starterFormSubmissionsTable.id,
      userId: starterFormSubmissionsTable.userId,
      formType: starterFormSubmissionsTable.formType,
      signedAt: starterFormSubmissionsTable.signedAt,
      updatedAt: starterFormSubmissionsTable.updatedAt,
    }).from(starterFormSubmissionsTable).orderBy(desc(starterFormSubmissionsTable.updatedAt)),
  ]);
  res.json({
    formTypes: STARTER_FORM_TYPES.map(t => ({ type: t, title: STARTER_FORMS[t].title })),
    people: people.filter(p => p.isActive).map(p => ({
      id: p.id,
      name: p.name,
      // Still inside the first-login gate — the founder opens the app for
      // them on their first day with the Grant access button.
      gated: p.onboardingRequired === true && p.onboardingCompletedAt == null,
      forms: submissions.filter(s => s.userId === p.id).map(({ userId: _u, ...s }) => s),
    })),
  });
});

// POST /grant-access — the founder's first-day handshake: opens the rest of
// the app for a gated new starter. Deliberately manual (Graeme, 2026-09-07):
// finishing the paperwork never opens the app by itself.
const GrantBody = z.object({ userId: z.number().int() });

router.post("/grant-access", requireHrRecordAccess, validate(GrantBody), async (req: Request, res: Response) => {
  const { userId } = req.body as z.infer<typeof GrantBody>;
  const granted = await grantAppAccess(userId);
  if (!granted) { res.status(400).json({ error: "That person isn't waiting on the onboarding gate" }); return; }
  res.json({ ok: true });
});

export default router;
