import { shouldSkipSideEffect, logSkippedSideEffect } from "./app-env";

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  /** Optional MIME type — Resend auto-detects from filename if omitted. */
  contentType?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional file attachments. Only honoured via Resend — if only
   *  Klaviyo is configured the call falls through to Resend instead.
   *  If neither provider is configured, the email is logged. */
  attachments?: EmailAttachment[];
}

const APP_NAME = "TCK Production Planner";
const FROM_EMAIL = process.env["FROM_EMAIL"] ?? "noreply@thecalzonekitchen.co.uk";

export async function sendEmail(payload: EmailPayload): Promise<void> {
  // Staging: never actually send mail. Log it instead so the invite/reset
  // flow can still be smoke-tested (the URL ends up in the server logs).
  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("sendEmail", { to: payload.to, subject: payload.subject });
    console.log(`[staging email body]\n${payload.text}`);
    return;
  }

  const klaviyoKey = process.env["KLAVIYO_API_KEY"];
  const resendKey = process.env["RESEND_API_KEY"];
  const hasAttachments = (payload.attachments?.length ?? 0) > 0;

  // Attachments only flow through Resend — skip Klaviyo when present.
  if (klaviyoKey && !hasAttachments) {
    const res = await fetch("https://a.klaviyo.com/api/emails/", {
      method: "POST",
      headers: {
        "Authorization": `Klaviyo-API-Key ${klaviyoKey}`,
        "Content-Type": "application/json",
        "revision": "2024-10-15",
      },
      body: JSON.stringify({
        data: {
          type: "email",
          attributes: {
            from: { email: FROM_EMAIL, name: APP_NAME },
            to: [{ email: payload.to }],
            subject: payload.subject,
            html_body: payload.html,
            text_body: payload.text,
          },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Klaviyo email send failed: ${JSON.stringify(err)}`);
    }
    return;
  }

  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${APP_NAME} <${FROM_EMAIL}>`,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        ...(hasAttachments ? {
          attachments: payload.attachments!.map(a => ({
            filename: a.filename,
            content: a.content,
            ...(a.contentType ? { content_type: a.contentType } : {}),
          })),
        } : {}),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Resend email send failed: ${JSON.stringify(err)}`);
    }
    return;
  }

  console.log("[EMAIL - no email provider configured, logging instead]");
  console.log(`To: ${payload.to}`);
  console.log(`Subject: ${payload.subject}`);
  console.log(payload.text);
}

export function inviteEmailHtml(inviteUrl: string, invitedByName: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 560px; margin: 40px auto; color: #333;">
  <h2 style="color: #1a1a1a;">You've been invited to TCK Production Planner</h2>
  <p>${invitedByName} has invited you to join the TCK Production Planner.</p>
  <p>Click the button below to set up your account. This link expires in 48 hours.</p>
  <a href="${inviteUrl}" style="display:inline-block;background:#5a7a3a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
    Accept Invitation
  </a>
  <p style="color:#666;font-size:13px;">Or copy this link: ${inviteUrl}</p>
  <p style="color:#999;font-size:12px;">If you weren't expecting this, you can safely ignore it.</p>
</body>
</html>`;
}

export function inviteEmailText(inviteUrl: string, invitedByName: string): string {
  return `You've been invited to TCK Production Planner by ${invitedByName}.\n\nAccept your invitation here:\n${inviteUrl}\n\nThis link expires in 48 hours.`;
}

export function resetEmailHtml(resetUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; max-width: 560px; margin: 40px auto; color: #333;">
  <h2 style="color: #1a1a1a;">Reset your password</h2>
  <p>We received a request to reset your password for TCK Production Planner.</p>
  <p>Click the button below to choose a new password. This link expires in 1 hour.</p>
  <a href="${resetUrl}" style="display:inline-block;background:#5a7a3a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
    Reset Password
  </a>
  <p style="color:#666;font-size:13px;">Or copy this link: ${resetUrl}</p>
  <p style="color:#999;font-size:12px;">If you didn't request this, you can safely ignore it.</p>
</body>
</html>`;
}

export function resetEmailText(resetUrl: string): string {
  return `Reset your TCK Production Planner password here:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.`;
}
