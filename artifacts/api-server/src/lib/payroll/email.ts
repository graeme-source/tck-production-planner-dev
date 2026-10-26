// Sends the monthly payroll report (objective B) through the app's normal
// mailer (lib/email.ts sendEmail → Resend, which is the only provider that
// carries attachments). Message building is a pure helper so it can be
// tested without sending anything.

import { sendEmail, FROM_EMAIL, type EmailPayload } from "../email";
import { shouldSkipSideEffect, logSkippedSideEffect } from "../app-env";

export interface PayrollEmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface PayrollEmailInput {
  to: string[];
  periodLabel: string;
  pdf: Buffer;
  attachments: PayrollEmailAttachment[];
  note?: string;
  sentByName: string;
}

const escapeHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "October 2026" → "tck-payroll-october-2026.pdf" */
export function payrollPdfFilename(periodLabel: string): string {
  const slug = periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `tck-payroll-${slug || "report"}.pdf`;
}

/** Pure: the full message, ready for sendEmail. The first address is the
 *  main recipient, the rest are copied (sendEmail takes one `to`). */
export function buildPayrollEmail(input: PayrollEmailInput): EmailPayload {
  const recipients = [...new Set(input.to.map(a => a.trim()).filter(Boolean))];
  if (recipients.length === 0) throw new Error("No recipients for the payroll email");

  const subject = `TCK payroll report — ${input.periodLabel}`;
  const note = input.note?.trim();
  const extras = input.attachments.length;

  const lines = [
    "Hello,",
    "",
    `Attached is The Calzone Kitchen payroll report for ${input.periodLabel}` +
      (extras ? `, plus ${extras} starter form${extras === 1 ? "" : "s"}.` : "."),
    "Take-home figures in the report are estimates only.",
    ...(note ? ["", note] : []),
    "",
    "Thanks,",
    input.sentByName,
    "The Calzone Kitchen",
  ];
  const text = lines.join("\n");
  const html = lines.map(l => (l === "" ? "<br>" : `<p style="margin:0">${escapeHtml(l)}</p>`)).join("\n");

  return {
    to: recipients[0]!,
    ...(recipients.length > 1 ? { cc: recipients.slice(1) } : {}),
    fromName: "The Calzone Kitchen",
    fromEmail: FROM_EMAIL,
    subject,
    text,
    html,
    attachments: [
      { filename: payrollPdfFilename(input.periodLabel), content: input.pdf.toString("base64"), contentType: "application/pdf" },
      ...input.attachments.map(a => ({
        filename: a.filename,
        content: a.content.toString("base64"),
        contentType: a.contentType,
      })),
    ],
  };
}

export async function sendPayrollEmail(input: PayrollEmailInput): Promise<{ ok: boolean; error?: string }> {
  let payload: EmailPayload;
  try {
    payload = buildPayrollEmail(input);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("sendPayrollEmail", { to: payload.to, cc: payload.cc, subject: payload.subject });
    return { ok: false, error: "Outbound email is switched off in this environment — the payroll report was not sent." };
  }
  // Attachments only travel via Resend; without it sendEmail would just log.
  if (!process.env["RESEND_API_KEY"]) {
    return { ok: false, error: "No email provider configured (RESEND_API_KEY) — the payroll report was not sent." };
  }

  try {
    await sendEmail(payload);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payroll-email] send failed:", message);
    return { ok: false, error: message };
  }
}
