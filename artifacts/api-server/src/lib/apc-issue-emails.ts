/**
 * The customer emails for APC booking issues (Graeme, 2026-10-09) — one per
 * scenario in lib/apc-booking-issues.ts. The wording lives HERE, beside the
 * original reschedule email in lib/order-reschedule.ts; edit it in place.
 * Only names, the order number and the date are substituted.
 *
 *   cant_deliver        → cantDeliverEmail     (no reschedule; refund)
 *   saturday_permanent  → permanentSaturdayEmail (sent with the reschedule)
 *   saturday_temporary  → rescheduleEmailText  (the original wording,
 *                         lib/order-reschedule.ts — unchanged)
 *
 * Nothing here sends anything. Sending is always a person's confirmed
 * button press (routes/apc-booking-issues.ts, routes/fulfilment.ts).
 */
import { friendlyDate, plainEmailHtml, rescheduleEmailText } from "./order-reschedule";
import type { RescheduleEmailVariant } from "./apc-booking-issues";

/** Copied on every customer email sent from a booking issue or a
 *  reschedule, so a send that fails is noticed — a copy landing in a real
 *  inbox is the only proof it went. */
export const CUSTOMER_EMAIL_BCC = "graeme@thecalzonekitchen.co.uk";

export interface CustomerEmail {
  subject: string;
  body: string;
  html: string;
}

/** (a) We can't reach this postcode at all — the order will be refunded. */
export function cantDeliverEmail(opts: { customerFirstName: string; senderFirstName: string; orderName: string }): CustomerEmail {
  const body = `Hi ${opts.customerFirstName}

We're really sorry, but we're not able to service your postcode, so we can't deliver your order ${opts.orderName}. Our courier partner doesn't offer the next-day delivery we need to get your food to you fresh.

We'll refund your order in full, back to your original payment method.

Apologies for the disappointment, and thank you for choosing The Calzone Kitchen. If you have any questions, just reply to this email.

Kind regards
${opts.senderFirstName}`;
  return {
    subject: `Your Calzone Kitchen order ${opts.orderName} — we can't deliver to your postcode`,
    body,
    html: plainEmailHtml(body),
  };
}

/** (b) APC never deliver to this postcode on a Saturday — moved to a weekday. */
export function permanentSaturdayEmailText(opts: { customerFirstName: string; senderFirstName: string; newTagDate: string }): string {
  const when = friendlyDate(opts.newTagDate);
  return `Hi ${opts.customerFirstName}

I'm sorry to let you know that our courier partner can't deliver to you on a Saturday at all, so we weren't able to send your order today. The good news is that this was caught before dispatch, so no food has been wasted.

I've moved your order to our next available delivery date, which is ${when}. If that doesn't suit, please reply to this email with a weekday that does, before the end of the day tomorrow, and we'll change it for you.

Please don't use Saturday as a delivery date going forwards. If you have a subscription, please update your delivery date to a weekday to avoid this happening again.

Apologies for any inconvenience, and thanks for your understanding.

Kind regards
${opts.senderFirstName}`;
}

/** The reschedule email for a variant: (c) keeps the original wording. */
export function rescheduleEmailFor(variant: RescheduleEmailVariant, opts: {
  customerFirstName: string; senderFirstName: string; newTagDate: string; orderName: string;
}): CustomerEmail {
  const body = variant === "permanent_saturday"
    ? permanentSaturdayEmailText(opts)
    : rescheduleEmailText(opts);
  return {
    subject: `Your Calzone Kitchen order ${opts.orderName} — new delivery date`,
    body,
    html: plainEmailHtml(body),
  };
}
