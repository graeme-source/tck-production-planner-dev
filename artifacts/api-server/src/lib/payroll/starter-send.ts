/**
 * New-starter payroll paperwork → the accountant (Graeme, 27 Oct 2026).
 * The rules are pure in starter-send-rules.ts; this is the DB + mailer side.
 *
 *   maybeAutoSendStarterPayroll(userId) — called after a payroll starter
 *     form is signed and after the pre-arrival details are first submitted.
 *     Sends ONCE per person, ever (migration 0341's unique index is the
 *     claim), and only when everything payroll needs is in.
 *   sendStarterPayrollNow(userId, by)   — the founder's "Send again".
 *   starterPayrollStatuses(userIds)     — what the starter view shows.
 *
 * The accountant's address is app_settings 'payroll_accountant_email', set
 * on Finance → Payroll. No address → nothing goes, and the attempt is
 * logged as not_sent so the screen can say why.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FROM_EMAIL, type EmailPayload } from "../email";
import { starterGateStatus } from "../starter-paperwork";
import { deliverWithAttachments } from "./email";
import { loadStarterDocs } from "./starter-docs";
import {
  ACCOUNTANT_EMAIL_KEY, buildStarterPayrollMessage, changedSinceSent, isValidEmail, payrollSafeAttachments,
  shouldAutoSend, starterDocTitle, starterPayrollReadiness, type StarterPayrollInput,
} from "./starter-send-rules";

export const NO_ACCOUNTANT_EMAIL = "Not sent: set the accountant's email on Finance → Payroll";

// ── The accountant's address ───────────────────────────────────────────────

export async function getAccountantEmail(): Promise<string | null> {
  const r = await db.execute<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = ${ACCOUNTANT_EMAIL_KEY}`);
  const v = r.rows[0]?.value?.trim() ?? "";
  return isValidEmail(v) ? v : null;
}

export async function setAccountantEmail(email: string | null): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${ACCOUNTANT_EMAIL_KEY}, ${email?.trim() ?? ""}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
}

// ── Loading one person's paperwork state ───────────────────────────────────

async function loadInput(userId: number): Promise<{ name: string; input: StarterPayrollInput } | null> {
  const person = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${userId}`);
  if (!person.rows[0]) return null;
  const [gate, forms, uploads] = await Promise.all([
    starterGateStatus(userId),
    db.execute<{ form_type: string; signed_at: Date | null; answers: Record<string, unknown> | null }>(sql`
      SELECT form_type, signed_at, answers FROM starter_form_submissions WHERE user_id = ${userId}
    `),
    db.execute<{ kind: string; uploaded_at: Date | null }>(sql`
      SELECT kind, uploaded_at FROM onboarding_documents WHERE user_id = ${userId}
    `),
  ]);
  return {
    name: person.rows[0].name,
    input: {
      detailsSubmitted: gate.detailsSubmitted,
      forms: forms.rows.map(f => ({ formType: f.form_type, signedAt: f.signed_at, answers: f.answers })),
      uploads: uploads.rows.map(u => ({ kind: u.kind, uploadedAt: u.uploaded_at })),
    },
  };
}

// ── Sending ────────────────────────────────────────────────────────────────

type Outcome = { status: "sent" | "failed" | "not_sent"; error?: string; documents: string[] };

/** Fill in an already-claimed send row: load the documents, send, record. */
async function deliver(sendId: number, userId: number, name: string, payslipEmail: string | null, resend: boolean): Promise<Outcome> {
  const finish = async (o: Outcome, to: string | null) => {
    await db.execute(sql`
      UPDATE starter_payroll_sends
         SET status = ${o.status}, error = ${o.error ?? null}, sent_to = ${to},
             documents = ${`{${o.documents.map(d => `"${d.replace(/["\\]/g, "")}"`).join(",")}}`}::text[],
             sent_at = ${o.status === "sent" ? sql`NOW()` : sql`NULL`}
       WHERE id = ${sendId}
    `);
    return o;
  };
  try {
    const to = await getAccountantEmail();
    if (!to) return finish({ status: "not_sent", error: NO_ACCOUNTANT_EMAIL, documents: [] }, null);

    // Same loader as the month-end report, then the payroll-only guard —
    // the health questionnaire never gets this far.
    const docs = payrollSafeAttachments(await loadStarterDocs([{ userId, name }]));
    const files = docs.map(d => d.filename);
    if (docs.length === 0) return finish({ status: "failed", error: "No payroll documents on file", documents: [] }, to);

    const msg = buildStarterPayrollMessage({ to, personName: name, payslipEmail, documentTitles: docs.map(d => d.title), resend });
    const payload: EmailPayload = {
      ...msg,
      fromName: "The Calzone Kitchen",
      fromEmail: FROM_EMAIL,
      attachments: docs.map(d => ({ filename: d.filename, content: d.content.toString("base64"), contentType: d.contentType })),
    };
    const sent = await deliverWithAttachments(payload, "sendStarterPayrollPaperwork", "the starter paperwork");
    return finish(sent.ok ? { status: "sent", documents: files } : { status: "failed", error: sent.error, documents: files }, to);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[starter-payroll-send] failed:", message);
    return finish({ status: "failed", error: message, documents: [] }, null).catch(() => ({ status: "failed" as const, error: message, documents: [] }));
  }
}

/** Fire-and-forget hook: never throws. Sends only when complete, and only
 *  if no automatic attempt was ever made for this person. */
export async function maybeAutoSendStarterPayroll(userId: number): Promise<void> {
  try {
    const loaded = await loadInput(userId);
    if (!loaded) return;
    const readiness = starterPayrollReadiness(loaded.input);
    if (!shouldAutoSend(readiness, false)) return;
    // The claim: one automatic row per person (partial unique index). Two
    // signatures landing together both get here; only one wins.
    const claim = await db.execute<{ id: number }>(sql`
      INSERT INTO starter_payroll_sends (user_id, trigger, status) VALUES (${userId}, 'auto', 'sending')
      ON CONFLICT (user_id) WHERE trigger = 'auto' DO NOTHING
      RETURNING id
    `);
    const sendId = claim.rows[0]?.id;
    if (sendId == null) return;
    const o = await deliver(Number(sendId), userId, loaded.name, readiness.payslipEmail, false);
    console.log(`[starter-payroll-send] auto for user ${userId}: ${o.status}${o.error ? ` (${o.error})` : ""}`);
  } catch (err) {
    console.error("[starter-payroll-send] auto send failed:", err instanceof Error ? err.message : err);
  }
}

/** The founder's manual send / "Send again". */
export async function sendStarterPayrollNow(userId: number, by: { id: number | null; name: string | null }): Promise<{ ok: boolean; error?: string; documents: string[] }> {
  const loaded = await loadInput(userId);
  if (!loaded) return { ok: false, error: "No such person", documents: [] };
  const readiness = starterPayrollReadiness(loaded.input);
  if (!readiness.complete) return { ok: false, error: `Still waiting for: ${readiness.missing.join(", ")}`, documents: [] };
  const hadSuccess = await db.execute(sql`SELECT 1 FROM starter_payroll_sends WHERE user_id = ${userId} AND status = 'sent' LIMIT 1`);
  const row = await db.execute<{ id: number }>(sql`
    INSERT INTO starter_payroll_sends (user_id, trigger, status, sent_by, sent_by_name)
    VALUES (${userId}, 'manual', 'sending', ${by.id}, ${by.name})
    RETURNING id
  `);
  const o = await deliver(Number(row.rows[0]!.id), userId, loaded.name, readiness.payslipEmail, hadSuccess.rows.length > 0);
  return { ok: o.status === "sent", error: o.error, documents: o.documents };
}

// ── Status for the starter view ────────────────────────────────────────────

export interface StarterPayrollStatus {
  userId: number;
  complete: boolean;
  missing: string[];
  /** Titles of what would go now. */
  documents: string[];
  lastSent: { at: string; to: string | null; documents: string[]; trigger: "auto" | "manual"; byName: string | null } | null;
  lastAttempt: { at: string; status: string; error: string | null; trigger: "auto" | "manual" } | null;
  changedSinceSent: boolean;
}

type SendRow = { user_id: number; trigger: "auto" | "manual"; status: string; sent_to: string | null; documents: string[]; error: string | null; sent_by_name: string | null; created_at: Date; sent_at: Date | null };

export async function starterPayrollStatuses(userIds: number[]): Promise<StarterPayrollStatus[]> {
  const ids = [...new Set(userIds.filter(Number.isInteger))];
  if (ids.length === 0) return [];
  const idList = sql.raw(ids.join(","));
  const sends = (await db.execute<SendRow>(sql`
    SELECT user_id, trigger, status, sent_to, documents, error, sent_by_name, created_at, sent_at
      FROM starter_payroll_sends WHERE user_id IN (${idList}) ORDER BY created_at DESC
  `)).rows;
  const out: StarterPayrollStatus[] = [];
  for (const userId of ids) {
    const loaded = await loadInput(userId);
    if (!loaded) continue;
    const r = starterPayrollReadiness(loaded.input);
    const mine = sends.filter(s => Number(s.user_id) === userId);
    const sent = mine.find(s => s.status === "sent") ?? null;
    const last = mine[0] ?? null;
    out.push({
      userId,
      complete: r.complete,
      missing: r.missing,
      documents: r.documents.map(starterDocTitle),
      lastSent: sent ? { at: new Date(sent.sent_at ?? sent.created_at).toISOString(), to: sent.sent_to, documents: sent.documents ?? [], trigger: sent.trigger, byName: sent.sent_by_name } : null,
      lastAttempt: last ? { at: new Date(last.created_at).toISOString(), status: last.status, error: last.error, trigger: last.trigger } : null,
      changedSinceSent: changedSinceSent(loaded.input, sent ? (sent.sent_at ?? sent.created_at) : null),
    });
  }
  return out;
}
