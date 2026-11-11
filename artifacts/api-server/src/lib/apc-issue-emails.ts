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
 * And one sent BEFORE the day, from the Friday dispatch check
 * (lib/friday-dispatch-check.ts): noSaturdayThisWeekEmail.
 *
 * Nothing here sends anything. Sending is always a person's confirmed
 * button press (routes/apc-booking-issues.ts, routes/fulfilment.ts).
 */
import { friendlyDate, plainEmailHtml, rescheduleEmailText } from "./order-reschedule";
import type { RescheduleEmailVariant } from "./apc-booking-issues";
import type { FridayDates } from "./friday-dispatch-check";

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

/** (d) Sent days ahead from the Friday dispatch check (Graeme, 11 Nov 2026):
 *  APC won't deliver to this postcode this Saturday. Offers Thursday's
 *  dispatch (Friday delivery) when there's still time to reply, otherwise
 *  it goes out on Tuesday for Wednesday delivery. Nothing is moved by the
 *  email itself — the order is moved by hand once the customer has replied
 *  (or hasn't). */
export function noSaturdayThisWeekEmail(opts: {
  customerFirstName: string;
  senderFirstName: string;
  orderName: string;
  dates: FridayDates;
  offerThursday: boolean;
}): CustomerEmail {
  const d = opts.dates;
  const offer = opts.offerThursday
    ? `If you'd like it a day early instead, just reply to this email by the end of ${friendlyDate(d.replyBy)} and we'll send it out on Thursday for delivery on ${friendlyDate(d.thursdayDelivery)}.

Otherwise, we'll send it out on Tuesday for delivery on ${friendlyDate(d.tuesdayDelivery)}.`
    : `We'll send it out on Tuesday instead, for delivery on ${friendlyDate(d.tuesdayDelivery)}. If another weekday suits you better, just reply to this email.`;
  const body = `Hi ${opts.customerFirstName}

I'm sorry to let you know that our courier can't deliver to your postcode this Saturday (${friendlyDate(d.deliveryDate)}), so your order ${opts.orderName} can't arrive that day.

${offer}

Sorry for the change, and thank you for choosing The Calzone Kitchen.

Kind regards
${opts.senderFirstName}`;
  return {
    subject: `Your Calzone Kitchen order ${opts.orderName} — we can't deliver this Saturday`,
    body,
    html: plainEmailHtml(body),
  };
}

/** (e) Sent from the Friday dispatch check's "Reschedule & email" (Graeme,
 *  11 Nov 2026): the order HAS been moved to the Wednesday after, and the
 *  customer can pick a sooner day themselves from the link (the website
 *  assistant; no code needed — the link proves it's them). Without a link
 *  (the assistant couldn't make one) it asks them to reply instead. */
export function rescheduledWithLinkEmail(opts: {
  customerFirstName: string;
  senderFirstName: string;
  orderName: string;
  saturdayDelivery: string;
  newDelivery: string;
  link: string | null;
}): CustomerEmail {
  const choose = opts.link
    ? `Would you like it sooner? Choose a different delivery day here — it takes a minute, and if you choose before 1:45pm it can even go out that same afternoon:

${opts.link}`
    : `Would you like it sooner? Just reply to this email with the day you'd like and we'll move it for you.`;
  const body = `Hi ${opts.customerFirstName}

I'm sorry to let you know that our courier can't deliver to your postcode this Saturday (${friendlyDate(opts.saturdayDelivery)}), so we've moved your order ${opts.orderName} to ${friendlyDate(opts.newDelivery)}.

If ${friendlyDate(opts.newDelivery)} suits you, you don't need to do anything.

${choose}

Sorry for the change, and thank you for choosing The Calzone Kitchen.

Kind regards
${opts.senderFirstName}`;
  let html = plainEmailHtml(body);
  if (opts.link) {
    const escaped = opts.link.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const button = `<p style="margin:0 0 16px"><a href="${escaped}" style="display:inline-block;background:#7cb342;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">Choose a delivery day</a></p>`;
    html = html.replace(`<p style="margin:0 0 16px">${escaped}</p>`, button);
  }
  return {
    subject: `Your Calzone Kitchen order ${opts.orderName} — moved to ${friendlyDate(opts.newDelivery)}`,
    body,
    html,
  };
}
