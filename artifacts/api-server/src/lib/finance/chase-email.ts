import type { EmailPayload } from "../email";
import { ACCOUNTS_MAILBOX } from "../accounts-email";

/** The "chase supplier for a VAT invoice" email. Sends from the accounts
 *  identity (via the verified notify. subdomain — the apex isn't verified in
 *  Resend) with replies going to the accounts mailbox. No copy to accounts@:
 *  Graeme asked for the hard-coded copy to go (2026-11-03) — the chase is
 *  already recorded on the line, and replies still land in accounts@. */
export function buildChaseEmail(input: { toEmail: string; subject: string; message: string }): EmailPayload {
  const html = `<div style="font-family:sans-serif;max-width:560px;color:#333">${input.message
    .split(/\n{2,}/)
    .map(pa => `<p>${pa.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")}</p>`)
    .join("")}</div>`;
  return {
    to: input.toEmail,
    subject: input.subject,
    html,
    text: input.message,
    fromName: "The Calzone Kitchen — Accounts",
    fromEmail: "accounts@notify.thecalzonekitchen.co.uk",
    replyTo: ACCOUNTS_MAILBOX,
  };
}
