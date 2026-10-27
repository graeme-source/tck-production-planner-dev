/**
 * Lucky Order Number winner emails (Graeme, 27 Oct 2026) — transactional
 * "congratulations, you've won" emails sent through Resend to every winner,
 * whatever their marketing consent. Subject and body for each prize are
 * written on Sales & Marketing → Live offers; these are the defaults.
 * Pure: builds the email, doesn't send it. Objective I.
 *
 * Placeholders, filled per winner:
 *   {first_name} {order_number} {gift} {refund_amount} {code} {amount} {orders}
 */
import type { LuckyTier } from "./rules";

export interface WinnerEmailTemplate { subject: string; body: string }
export type WinnerEmailTemplates = Record<LuckyTier, WinnerEmailTemplate>;

export const DEFAULT_TEMPLATES: WinnerEmailTemplates = {
  gift: {
    subject: "🎉 You've WON! Order {order_number} is a Lucky Order",
    body: `Hi {first_name},

WINNER! Your order {order_number} ends in a 0, which makes it one of our Lucky Orders, and that means you've just won a FREE {gift}!

You don't need to do a thing. We've already added it to your order, and it's coming with the rest of your calzones.

Enjoy every single bite!
The Calzone Kitchen team`,
  },
  gift_refund: {
    subject: "🎉 JACKPOT! Order {order_number} is on us, plus a free gift",
    body: `Hi {first_name},

You're not going to believe this... Your order {order_number} ends in 00, which makes it one of our rarest Lucky Orders. You've won a FULL REFUND of your order AND a FREE {gift}!

Your refund of {refund_amount} is on its way back to the card you paid with. It usually shows within 5 working days.

And the best bit? Your order is still coming, with your free {gift} added. You don't need to do a thing.

Congratulations, and enjoy your free calzones!
The Calzone Kitchen team`,
  },
  subscription: {
    subject: "🏆 You've won a YEAR of free calzones!",
    body: `Hi {first_name},

This is the big one. Your order {order_number} ends in 000, making it a one-in-a-thousand Lucky Order. You've won a FREE YEAR of calzones!

Here's your personal code:

{code}

Use it on a TCK subscription for up to £{amount} off each of your next {orders} deliveries. That's one every 8 weeks, a whole year of calzones on us. Just enter the code when you start or update your subscription.

Huge congratulations from all of us!
The Calzone Kitchen team`,
  },
};

export const DEFAULT_TERMS = "Lucky Order Number: website orders and TCK subscription renewals placed during the promotion; wholesale and staff-created orders excluded. Order numbers ending in 0 win a free gift added to the order; ending in 00 also win a full refund of that order; ending in 000 instead win up to £75 off each of the next 6 subscription deliveries (single-use code). Prizes are applied automatically, have no cash alternative and are void if the order is cancelled. Full terms: thecalzonekitchen.co.uk/pages/lucky-order-terms";

export interface WinnerEmailValues {
  firstName: string | null;
  orderName: string;
  gift: string | null;
  refundAmount: number | null;
  code: string | null;
  amount: number;
  orders: number;
}

/** Fill the placeholders. Unknown ones are left as typed so a typo shows up in the test. */
export function fillPlaceholders(text: string, v: WinnerEmailValues): string {
  const map: Record<string, string> = {
    first_name: v.firstName?.trim() || "there",
    order_number: v.orderName,
    gift: v.gift ?? "gift",
    refund_amount: v.refundAmount != null ? `£${v.refundAmount.toFixed(2)}` : "your full order total",
    code: v.code ?? "",
    amount: String(v.amount),
    orders: String(v.orders),
  };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? map[k] : m));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Build the email. Blank lines make paragraphs; a paragraph that is exactly
 * the code is shown big, in a box, so it's easy to copy.
 */
export function buildWinnerEmail(tpl: WinnerEmailTemplate, v: WinnerEmailValues, terms: string): { subject: string; text: string; html: string } {
  const subject = fillPlaceholders(tpl.subject, v).replace(/\s+/g, " ").trim();
  const body = fillPlaceholders(tpl.body, v).replace(/\r\n/g, "\n").trim();
  const paras = body.split(/\n\s*\n/);
  const htmlParas = paras.map(p => {
    if (v.code && p.trim() === v.code) {
      return `<p style="margin:22px 0;text-align:center"><span style="display:inline-block;padding:14px 22px;border:2px dashed #919b5f;border-radius:10px;font:700 22px/1.2 'Courier New',monospace;letter-spacing:2px;color:#2e2e2e">${escapeHtml(p.trim())}</span></p>`;
    }
    return `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
  const html = `<!DOCTYPE html>
<html><body style="margin:0;background:#f5f3ea;font-family:Helvetica,Arial,sans-serif;color:#2e2e2e">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#919b5f;color:#fff;border-radius:14px 14px 0 0;padding:22px 24px;text-align:center;font:800 22px/1.2 Helvetica,Arial,sans-serif;letter-spacing:.5px">THE CALZONE KITCHEN · LUCKY ORDER</div>
  <div style="background:#fff;border-radius:0 0 14px 14px;padding:26px 24px;font-size:16px;line-height:1.55">
${htmlParas}
  </div>
  ${terms.trim() ? `<p style="font-size:11px;line-height:1.5;color:#7a7a7a;margin:16px 4px 0">${escapeHtml(terms.trim())}</p>` : ""}
</div>
</body></html>`;
  const text = `${body}${terms.trim() ? `\n\n---\n${terms.trim()}` : ""}`;
  return { subject, text, html };
}
