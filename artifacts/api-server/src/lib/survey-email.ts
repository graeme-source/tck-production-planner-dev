/**
 * The survey invite email — a single branded HTML template. Button-first by
 * design (the reader is already on a device); the QR code stays on the box
 * insert. Klaviyo requires an unsubscribe link in campaign emails, hence the
 * {% unsubscribe_link %} tag in the footer.
 */

const BRAND_GREEN = "#7cb342";

export function buildSurveyInviteHtml(input: { title: string; intro: string | null; shareUrl: string }): string {
  const intro = input.intro
    ?? "Tell us what you thought — it takes about a minute and directly shapes what we launch next.";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f6f2;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f2;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${BRAND_GREEN};padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;">The Calzone Kitchen</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:22px;color:#222222;">${escapeHtml(input.title)}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444444;">${escapeHtml(intro)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr><td align="center">
              <a href="${input.shareUrl}" style="display:inline-block;background:${BRAND_GREEN};color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">
                Give your feedback
              </a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#999999;">
            If the button doesn't work, copy this link into your browser:<br>
            <a href="${input.shareUrl}" style="color:${BRAND_GREEN};word-break:break-all;">${input.shareUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #eeeeee;">
          <p style="margin:0;font-size:11px;color:#aaaaaa;">
            The Calzone Kitchen &middot; <a href="{% unsubscribe_link %}" style="color:#aaaaaa;">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
