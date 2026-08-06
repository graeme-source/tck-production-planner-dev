/**
 * The survey invite email, styled to match the house Klaviyo newsletters
 * (sampled from the real "Test Box Launch (VIP)" template): cream page,
 * white 600px card, TCK masthead, Jost headings, Verdana body, and the
 * signature olive button with the chunky black border. Button-first by
 * design (the reader is already on a device); the QR code stays on the box
 * insert. Klaviyo requires an unsubscribe link — same {% unsubscribe %}
 * footer sentence the newsletters use.
 *
 * NOTE the olive #919B5F is deliberate: emails follow the website/marketing
 * brand, which still uses the old olive — not the app's Fresh Basil green.
 */

// The masthead image the real newsletters lead with (Klaviyo-hosted).
const MASTHEAD_URL = "https://d3k81ch9hvuctc.cloudfront.net/company/SAef3g/images/dae1acab-67ef-447e-9c9b-bf9a7c41a314.png";
const OLIVE = "#919B5F";

export function buildSurveyInviteHtml(input: { title: string; intro: string | null; shareUrl: string }): string {
  const intro = input.intro
    ?? "Tell us what you thought — it takes about a minute and directly shapes what we launch next.";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#fffdf0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fffdf0;padding:40px 10px 20px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;">
        <tr><td>
          <img src="${MASTHEAD_URL}" alt="The Calzone Kitchen" width="600" style="display:block;width:100%;height:auto;outline:none;border:0;">
        </td></tr>
        <tr><td style="padding:30px 35px 0;">
          <h1 style="margin:0 0 16px;font-family:Jost,'Trebuchet MS',Helvetica,Arial,sans-serif;font-size:33px;font-weight:700;color:#2e2e2e;text-align:left;">
            ${escapeHtml(input.title.toUpperCase())}
          </h1>
          <p style="margin:0 0 10px;font-family:Verdana,Geneva,sans-serif;font-size:16px;line-height:1.4;color:#2e2e2e;text-align:left;">
            ${escapeHtml(intro)}
          </p>
        </td></tr>
        <tr><td style="padding:18px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;line-height:100%;">
            <tr>
              <td align="center" bgcolor="${OLIVE}" style="border:solid 5px #000000;border-radius:20px;background:${OLIVE};" valign="middle">
                <a href="${input.shareUrl}" target="_blank" style="color:#ffffff;text-decoration:none;display:inline-block;background:${OLIVE};font-family:Arial,sans-serif;font-size:22px;font-weight:700;line-height:100%;padding:30px 0;width:100%;border-radius:20px;">
                  GIVE YOUR FEEDBACK
                </a>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 35px 24px;">
          <p style="margin:0;font-family:Verdana,Geneva,sans-serif;font-size:12px;line-height:1.5;color:#5c5c5c;">
            If the button doesn't work, copy this link into your browser:<br>
            <a href="${input.shareUrl}" style="color:${OLIVE};word-break:break-all;">${input.shareUrl}</a>
          </p>
        </td></tr>
        <tr><td style="padding:9px 18px 18px;border-top:1px solid #cccccc;">
          <p style="margin:0;font-family:Verdana,Geneva,sans-serif;font-size:12px;color:#5c5c5c;text-align:left;">
            If you no longer wish to receive these emails, please {% unsubscribe %}
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
