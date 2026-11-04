/**
 * The wording of the order sent to a supplier (Graeme, 2026-11-04), edited on
 * Inventory -> Tools -> Order email template and shared by Email order,
 * WhatsApp and Copy order. Pure and tested. Objective C.
 *
 * Stored as JSON in app_settings. The default is the wording the Orders page
 * has always used, so nothing changes until someone edits it.
 */

export interface OrderEmailTemplate {
  subject: string;
  body: string;
  showPartNumber: boolean;
  showPackSize: boolean;
  showPrice: boolean;
}

export const ORDER_EMAIL_SETTING_KEY = "order_email_template";

export const DEFAULT_ORDER_EMAIL_TEMPLATE: OrderEmailTemplate = {
  subject: "Order from The Calzone Kitchen — delivery {deliveryDate}",
  body: [
    "Hi {supplier},",
    "",
    "Please could we order the following for delivery on {deliveryDate}:",
    "",
    "{items}",
    "",
    "Many thanks,",
    "The Calzone Kitchen",
  ].join("\n"),
  showPartNumber: true,
  showPackSize: false,
  showPrice: false,
};

/** What can be dropped into the wording. */
export const ORDER_EMAIL_FIELDS = [
  { key: "supplier", label: "Supplier name" },
  { key: "contact", label: "Contact name" },
  { key: "accountNumber", label: "Our account number" },
  { key: "deliveryDate", label: "Delivery date" },
  { key: "items", label: "The items" },
] as const;

export type OrderEmailValues = Partial<Record<(typeof ORDER_EMAIL_FIELDS)[number]["key"], string | null>>;

/** A saved value, or the default for anything missing or unreadable. */
export function parseOrderEmailTemplate(raw: string | null | undefined): OrderEmailTemplate {
  if (!raw) return DEFAULT_ORDER_EMAIL_TEMPLATE;
  try {
    const v = JSON.parse(raw) as Partial<OrderEmailTemplate>;
    const d = DEFAULT_ORDER_EMAIL_TEMPLATE;
    return {
      subject: typeof v.subject === "string" && v.subject.trim() ? v.subject : d.subject,
      body: typeof v.body === "string" && v.body.trim() ? v.body : d.body,
      showPartNumber: typeof v.showPartNumber === "boolean" ? v.showPartNumber : d.showPartNumber,
      showPackSize: typeof v.showPackSize === "boolean" ? v.showPackSize : d.showPackSize,
      showPrice: typeof v.showPrice === "boolean" ? v.showPrice : d.showPrice,
    };
  } catch {
    return DEFAULT_ORDER_EMAIL_TEMPLATE;
  }
}

const KNOWN = new Set<string>(ORDER_EMAIL_FIELDS.map((f) => f.key));

/** Fills in the fields, line by line. A line using a field we have nothing
 *  for is left out ("Account number: " with no number). */
export function fillOrderEmailText(text: string, values: OrderEmailValues): string {
  const kept = text.split("\n").flatMap((line) => {
    const fields = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((k) => KNOWN.has(k));
    const has = (k: string) => !!values[k as keyof OrderEmailValues]?.trim();
    if (fields.some((k) => !has(k))) return [];
    return [fields.reduce((out, k) => out.replaceAll(`{${k}}`, values[k as keyof OrderEmailValues]!), line)];
  });
  return kept.join("\n");
}

/** The order message. The items always go in: if someone took {items} out of
 *  the wording, they're added at the end, so an order is never sent empty. */
export function fillOrderEmailBody(template: OrderEmailTemplate, values: OrderEmailValues): string {
  const body = template.body.includes("{items}") ? template.body : `${template.body.trimEnd()}\n\n{items}`;
  return fillOrderEmailText(body, values);
}
