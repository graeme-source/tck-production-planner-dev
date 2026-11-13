/**
 * Local-delivery collections (Graeme, 13 Nov 2026): a wholesale order tagged
 * local-delivery leaves on the collecting supplier's van (The Best Butcher —
 * whichever supplier has "Their driver collects our local-delivery orders"
 * ticked). Processing the order books a collection on that supplier for the
 * chosen day, so it shows at the top of their delivery at goods-in and the
 * delivery can't be received until it's handed over.
 *
 * The collection day defaults to the delivery day and can move earlier — as
 * far back as the earliest production day (delivery − 3), never before today
 * and never after delivery. Pure; the processing route does the writing. The
 * dialog offers the same days (eight-pack-orders-banner.tsx
 * collectionDateOptions) — change both together.
 */

/** How far before delivery a collection may be — the same reach as Make. */
export const COLLECTION_MAX_DAYS_BEFORE_DELIVERY = 3;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every day a collection may be booked for, earliest first. */
export function collectionDateOptions(deliveryDate: string, today: string): string[] {
  const out: string[] = [];
  for (let back = COLLECTION_MAX_DAYS_BEFORE_DELIVERY; back >= 0; back--) {
    const d = addDays(deliveryDate, -back);
    if (d >= today) out.push(d);
  }
  return out;
}

export function collectionDateProblem(collectionDate: string, deliveryDate: string, today: string): string | null {
  if (collectionDate > deliveryDate) return "The collection can't be after the delivery day.";
  if (collectionDate < today) return "The collection day has already passed.";
  if (collectionDate < addDays(deliveryDate, -COLLECTION_MAX_DAYS_BEFORE_DELIVERY)) {
    return `The collection can be at most ${COLLECTION_MAX_DAYS_BEFORE_DELIVERY} days before delivery.`;
  }
  return null;
}

/** What goods-in sees: the order number on the card, one line to tick. */
export function localDeliveryCollection(order: { name: string; customerName: string }): {
  reference: string;
  line: { description: string; quantity: number; unit: string };
} {
  const who = order.customerName.trim();
  return {
    reference: `Local delivery ${order.name}${who ? ` · ${who}` : ""}`,
    line: {
      description: `Wholesale order ${order.name}${who ? ` for ${who}` : ""} — every box labelled ${order.name}`,
      quantity: 1,
      unit: "order",
    },
  };
}
