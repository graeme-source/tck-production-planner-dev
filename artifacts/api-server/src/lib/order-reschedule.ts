/**
 * Moving an order to a later delivery date.
 *
 * Used when a consignment genuinely can't be booked — most often a Saturday
 * postcode restriction, occasionally weather closing a route mid-week. The
 * order isn't cancelled; it slides to the next date we can actually deliver.
 *
 * A delivery date lives in TWO places on a Shopify order and both have to move
 * together, or the planner and the customer end up believing different things:
 *
 *   1. A tag, `YYYY-MM-DD`  — what the planner groups dispatch waves by.
 *   2. Zapiet's note_attribute `Delivery-Date`, in `YYYY/MM/DD` — slashes, not
 *      dashes. This is the customer-facing date.
 *
 * There is usually a weekday-name tag too ("Saturday"), which has to follow or
 * the order reads as a Saturday delivery on a Tuesday.
 *
 * Everything here is pure so the date and tag arithmetic can be tested without
 * touching Shopify. The writes themselves live in the route.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** `YYYY-MM-DD` — the tag format, and how dates are passed around internally. */
export function toTagDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** `YYYY/MM/DD` — Zapiet's format. Slashes; getting this wrong silently
 *  orphans the attribute from whatever reads it. */
export function toZapietDate(tagDate: string): string {
  return tagDate.replace(/-/g, "/");
}

/** Weekday name for a `YYYY-MM-DD` date, as the day tags are written. */
export function dayNameFor(tagDate: string): string {
  const [y, m, d] = tagDate.split("-").map(Number);
  // Midday UTC keeps the date stable either side of a BST shift.
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

/**
 * The next date we can actually deliver after `failedTagDate`.
 *
 * Deliveries run Tuesday–Saturday: the courier is overnight, so a delivery day
 * needs a dispatch day before it, and we don't dispatch at the weekend. That
 * makes Sunday and Monday undeliverable, so a failed Saturday rolls to Tuesday
 * — the case this was built for.
 *
 * Deliberately a plain rule rather than a calendar lookup: it is only ever a
 * DEFAULT, and the operator can pick any date instead.
 */
export function nextAvailableDeliveryDate(failedTagDate: string): string {
  const [y, m, d] = failedTagDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d, 12));
  for (let i = 0; i < 14; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 1) {           // not Sunday, not Monday
      return cursor.toISOString().slice(0, 10);
    }
  }
  /* istanbul ignore next — unreachable: a deliverable day occurs within 14. */
  return failedTagDate;
}

export interface TagChange {
  before: string;
  after: string;
  removed: string[];
  added: string[];
}

/** The tag that marks an order as ready to go out. Removed on reschedule:
 *  the order returns to the backlog and gets re-tagged on the Monday by the
 *  normal morning process (Graeme, 2026-08-21). Leaving it on would put the
 *  order back in a dispatch wave it isn't part of any more. */
const DISPATCH_TAG = "dispatch";

/**
 * Swap the date tag and the weekday-name tag, drop the dispatch tag, and leave
 * every other tag alone.
 *
 * The weekday tag is only touched when it matches the OLD date's weekday — if
 * someone has tagged an order "Saturday" for an unrelated reason, or the tag
 * is missing entirely, we don't invent or clobber one.
 */
export function rescheduleTags(currentTags: string, fromTagDate: string, toTagDate: string): TagChange {
  const tags = currentTags.split(",").map(t => t.trim()).filter(Boolean);
  const oldDay = dayNameFor(fromTagDate);
  const newDay = dayNameFor(toTagDate);

  const removed: string[] = [];
  const added: string[] = [];
  const out: string[] = [];

  for (const tag of tags) {
    if (tag === fromTagDate) {
      removed.push(tag);
      continue;
    }
    if (tag.toLowerCase() === DISPATCH_TAG) {
      removed.push(tag);
      continue;
    }
    if (tag.toLowerCase() === oldDay.toLowerCase() && oldDay !== newDay) {
      removed.push(tag);
      continue;
    }
    out.push(tag);
  }

  if (!out.includes(toTagDate)) { out.push(toTagDate); added.push(toTagDate); }
  // Only restore a weekday tag if the order carried one to begin with.
  if (removed.some(t => t.toLowerCase() === oldDay.toLowerCase()) && !out.some(t => t.toLowerCase() === newDay.toLowerCase())) {
    out.push(newDay);
    added.push(newDay);
  }

  return { before: currentTags, after: out.join(", "), removed, added };
}

export interface NoteAttribute { name: string; value: string }

/**
 * Set Zapiet's `Delivery-Date`, preserving every other attribute.
 *
 * Shopify REPLACES note_attributes wholesale on update — it does not merge. A
 * write that sends only Delivery-Date would silently delete
 * Delivery-Location-Id, Checkout-Method and the vsly* keys another app owns.
 * So the whole array goes back, with one entry changed.
 */
export function withDeliveryDate(
  attrs: readonly NoteAttribute[] | null | undefined,
  toTagDate: string,
): { attributes: NoteAttribute[]; previous: string | null; changed: boolean } {
  const zapiet = toZapietDate(toTagDate);
  const list = (attrs ?? []).map(a => ({ name: a.name, value: a.value }));
  const idx = list.findIndex(a => a.name === "Delivery-Date");

  if (idx === -1) {
    // No Zapiet date on the order — add one rather than leave it inconsistent
    // with the tag we just changed.
    list.push({ name: "Delivery-Date", value: zapiet });
    return { attributes: list, previous: null, changed: true };
  }

  const previous = list[idx].value;
  list[idx] = { name: "Delivery-Date", value: zapiet };
  return { attributes: list, previous, changed: previous !== zapiet };
}

/** Human date for the customer email — "Tuesday 25 August". */
export function friendlyDate(tagDate: string): string {
  const [y, m, d] = tagDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/**
 * The customer email, exactly as Graeme wrote it (2026-08-21). Only the two
 * names and the date are substituted — the wording is his and shouldn't drift.
 */
export function rescheduleEmailText(opts: {
  customerFirstName: string;
  senderFirstName: string;
  newTagDate: string;
}): string {
  const when = friendlyDate(opts.newTagDate);
  return `Hi ${opts.customerFirstName}

My sincere apologies but we have been informed today of a restriction in dispatching orders to your postcode on a Saturday which has resulted in us not being able to dispatch your order today. The good news is that this was caught before dispatch and we're able to ensure no food has been wasted.

I will schedule your order for our next available delivery date which is ${when}.

If this isn't a suitable delivery date, please reply to this email with a new delivery date, before the end of the day tomorrow, and we will reschedule it for you.

Apologies for any inconvenience caused by this delay and thanks for your kind understanding. Please let us know if you have any questions.

Kind regards
${opts.senderFirstName}`;
}

/** HTML version of the same email — same words, nothing added. Derived from
 *  the text so the two can never drift apart. */
export function rescheduleEmailHtml(opts: {
  customerFirstName: string;
  senderFirstName: string;
  newTagDate: string;
}): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = rescheduleEmailText(opts)
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 16px">${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">${paragraphs}</div>`;
}

/** First name only — the email signs off with a first name, and the sign-off
 *  should read as a person, not a full record. */
export function firstNameOf(full: string | null | undefined, fallback: string): string {
  const first = (full ?? "").trim().split(/\s+/)[0];
  return first || fallback;
}
