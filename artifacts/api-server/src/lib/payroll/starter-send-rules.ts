/**
 * New-starter payroll paperwork → the accountant, the moment it's complete
 * (Graeme, 27 Oct 2026: "As soon as we've got all of someone's onboarding
 * details, payroll details, HMRC starter checklist, anything that we need
 * for payroll, we should actually send that automatically"). Pure — the
 * DB and mailer side is starter-send.ts.
 *
 * Complete for payroll =
 *   • the pre-arrival onboarding details submitted (that step is also where
 *     the P45 is uploaded, so waiting for it gives the P45 its chance), and
 *   • the HMRC starter checklist signed, and
 *   • the payroll details form signed WITH a valid payslip email (forms
 *     signed before that question existed don't count — the accountant
 *     needs it to set the person up on Workforce).
 * A P45 is optional ("don't worry if you don't have one"): it goes if it's
 * there, and its absence never holds the send up.
 *
 * What goes: exactly the month-end report's set (starter-docs-rules.ts) —
 * HMRC starter checklist, payroll details, P45. NEVER the health
 * questionnaire: medical, special category data, never emailed out.
 */
import * as z from "zod";
import { isPayrollStarterForm, isPayrollUpload, starterDocTitle } from "./starter-docs-rules";

export const ACCOUNTANT_EMAIL_KEY = "payroll_accountant_email";

const emailSchema = z.string().trim().email();
export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && emailSchema.safeParse(v).success;
}

export interface StarterPayrollInput {
  detailsSubmitted: boolean;
  forms: ReadonlyArray<{ formType: string; signedAt: Date | string | null; answers: Record<string, unknown> | null }>;
  uploads: ReadonlyArray<{ kind: string; uploadedAt: Date | string | null }>;
}

export interface StarterPayrollReadiness {
  complete: boolean;
  /** Plain-English list of what's still outstanding. */
  missing: string[];
  /** Document kinds that would go now, in order. */
  documents: string[];
  payslipEmail: string | null;
}

export function starterPayrollReadiness(input: StarterPayrollInput): StarterPayrollReadiness {
  const signed = (t: string) => input.forms.find(f => f.formType === t && f.signedAt != null) ?? null;
  const hmrc = signed("hmrc_starter");
  const details = signed("payroll_details");
  const rawPayslip = details?.answers?.["payslip_email"];
  const payslipEmail = isValidEmail(rawPayslip) ? rawPayslip.trim() : null;

  const missing: string[] = [];
  if (!input.detailsSubmitted) missing.push("contact & emergency details");
  if (!hmrc) missing.push("HMRC starter checklist (signed)");
  if (!details) missing.push("payroll details (signed)");
  else if (!payslipEmail) missing.push("a payslip email on the payroll details form");

  return { complete: missing.length === 0, missing, documents: documentsToSend(input), payslipEmail };
}

/** The kinds that go, from what's on file — never anything outside the
 *  payroll set, whatever else the person has filled in or uploaded. */
export function documentsToSend(input: Pick<StarterPayrollInput, "forms" | "uploads">): string[] {
  const out: string[] = [];
  for (const t of ["hmrc_starter", "payroll_details"]) {
    if (input.forms.some(f => f.formType === t && f.signedAt != null) && isPayrollStarterForm(t)) out.push(t);
  }
  if (input.uploads.some(u => isPayrollUpload(u.kind))) out.push("p45");
  return out;
}

/** Last line of defence before anything is attached: only payroll kinds
 *  survive. The health questionnaire can't get through even if a caller
 *  hands it in. */
export function payrollSafeAttachments<T extends { kind: string }>(atts: ReadonlyArray<T>): T[] {
  return atts.filter(a => isPayrollStarterForm(a.kind) || isPayrollUpload(a.kind));
}

/** The automatic send fires once per person, ever, and only when complete.
 *  Anything after that (a P45 uploaded later, details edited) is a manual
 *  "Send again". */
export function shouldAutoSend(r: StarterPayrollReadiness, alreadyAutoAttempted: boolean): boolean {
  return r.complete && !alreadyAutoAttempted;
}

/** Something payroll-relevant landed after the last successful send — the
 *  screen says so beside the "Send again" button. */
export function changedSinceSent(input: Pick<StarterPayrollInput, "forms" | "uploads">, lastSentAt: Date | string | null): boolean {
  if (!lastSentAt) return false;
  const sent = new Date(lastSentAt).getTime();
  const later = (d: Date | string | null) => d != null && new Date(d).getTime() > sent;
  return input.forms.some(f => isPayrollStarterForm(f.formType) && later(f.signedAt))
    || input.uploads.some(u => isPayrollUpload(u.kind) && later(u.uploadedAt));
}

const escapeHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface StarterPayrollEmailInput {
  to: string;
  personName: string;
  payslipEmail: string | null;
  /** Titles of the attached documents, e.g. "HMRC starter checklist". */
  documentTitles: string[];
  /** A manual resend, not the first automatic one. */
  resend: boolean;
}

/** Subject + body; attachments are added by the sender. */
export function buildStarterPayrollMessage(input: StarterPayrollEmailInput): { to: string; subject: string; text: string; html: string } {
  const to = input.to.trim();
  if (!isValidEmail(to)) throw new Error("The accountant's email address isn't valid");
  const name = input.personName.trim() || "New starter";
  const subject = `${input.resend ? "Updated: " : ""}New starter payroll paperwork — ${name}`;
  const lines = [
    "Hello,",
    "",
    input.resend
      ? `Here is ${name}'s payroll paperwork again, updated since we last sent it.`
      : `${name} has just finished their new-starter paperwork, so here it is for payroll.`,
    "",
    "Attached:",
    ...input.documentTitles.map(t => `• ${t}`),
    "",
    ...(input.payslipEmail ? [`Please send ${name}'s payslips to: ${input.payslipEmail}`, ""] : []),
    "It will also come with the payroll report at the end of their first pay period, so you can check it against the month.",
    "",
    "Thanks,",
    "The Calzone Kitchen",
  ];
  return {
    to,
    subject,
    text: lines.join("\n"),
    html: lines.map(l => (l === "" ? "<br>" : `<p style="margin:0">${escapeHtml(l)}</p>`)).join("\n"),
  };
}

export { starterDocTitle };
