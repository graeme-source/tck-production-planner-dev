/**
 * Pull supplier contact details and an order reference out of an attached
 * email or document, so the accounts team can chase a VAT invoice without
 * reading the whole thing (Graeme, 2026-09-10 — the Aluxo case: order
 * confirmation in hand, no idea how to contact them).
 *
 * Pure text heuristics, deliberately conservative: a wrong order number on
 * a chase email wastes everyone's time, so anything ambiguous returns
 * nothing and the human fills the field in. Extracted values only ever
 * SUGGEST — they land in editable fields, never fire emails on their own.
 */

export interface SupplierInfoInput {
  /** Plain text of the email/document (HTML should be pre-stripped). */
  text: string;
  fromAddress?: string | null;
  fromName?: string | null;
  subject?: string | null;
}

export interface SupplierInfo {
  orderReference: string | null;
  supplierEmail: string | null;
  supplierWebsite: string | null;
  supplierName: string | null;
}

/** Domains that are ours or that no supplier should ever be "contacted" at. */
const OWN_DOMAINS = ["thecalzonekitchen.co.uk"];
const NOREPLY_LOCALPARTS = /^(no-?reply|donotreply|do-not-reply|notifications?|mailer|bounce)/i;

/** Free-mail and infrastructure domains that make bad "website" guesses. */
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com",
  "icloud.com", "amazonses.com", "sendgrid.net", "mailchimp.com", "mailgun.org",
]);

function domainOf(email: string): string | null {
  const m = email.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? m[1] : null;
}

function isOwn(domain: string | null): boolean {
  return domain != null && OWN_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`));
}

/** "orders.aluxo.co.uk" → "aluxo.co.uk" (strip one leading service label). */
function rootDomain(domain: string): string {
  const parts = domain.split(".");
  // Keep co.uk/com.au style suffixes intact: root is the last 3 labels when
  // the penultimate label is a short registry word, else the last 2.
  const registry2 = new Set(["co", "com", "org", "net", "ac", "gov"]);
  const take = parts.length > 2 && registry2.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-take).join(".");
}

export function extractOrderReference(text: string, subject?: string | null): string | null {
  const hay = `${subject ?? ""}\n${text}`;
  // "Order #12345", "Order number: AB-123", "Confirmation no. 9-887",
  // "Your reference: XYZ123". Requires the keyword — bare numbers are dates,
  // amounts and phone numbers far more often than order ids.
  // Three accepted shapes: keyword + number-word ("order number 123",
  // "confirmation no. 9-887"), keyword + colon ("ref: X1"), keyword + hash
  // ("order #A1"). A bare "order 123" (no number-word, no separator) stays
  // unmatched — too often prose.
  const re = /\b(?:order|confirmation|invoice|purchase|reference|ref)\s*(?:number|no\.?|id)\s*[:#]?\s*#?([A-Za-z0-9][A-Za-z0-9\/_-]{1,24})\b|\b(?:order|confirmation|invoice|purchase|reference|ref)\s*[:#]\s*#?([A-Za-z0-9][A-Za-z0-9\/_-]{1,24})\b|\b(?:order|confirmation|invoice)\s+#([A-Za-z0-9][A-Za-z0-9\/_-]{1,24})\b/gi;
  const found = new Set<string>();
  for (const m of hay.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw) continue;
    // A pure-alpha "reference" is almost always prose ("order confirmation").
    if (!/\d/.test(raw)) continue;
    found.add(raw);
  }
  // One unambiguous candidate or nothing.
  return found.size === 1 ? [...found][0] : null;
}

export function extractSupplierInfo(input: SupplierInfoInput): SupplierInfo {
  const text = input.text ?? "";

  // ── contact email: prefer a human-looking address in the body, fall back
  // to the sender (minus obvious no-reply machinery).
  const emails = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)]
    .map(m => m[0].toLowerCase())
    .filter(e => !isOwn(domainOf(e)));
  const bodyHuman = emails.find(e => !NOREPLY_LOCALPARTS.test(e.split("@")[0]));
  const from = (input.fromAddress ?? "").toLowerCase() || null;
  const fromUsable = from && !isOwn(domainOf(from)) ? from : null;
  const fromHuman = fromUsable && !NOREPLY_LOCALPARTS.test(fromUsable.split("@")[0]) ? fromUsable : null;
  const supplierEmail = bodyHuman ?? fromHuman ?? emails[0] ?? fromUsable ?? null;

  // ── website: from the best available supplier domain.
  const domainSource = supplierEmail ?? fromUsable;
  let supplierWebsite: string | null = null;
  if (domainSource) {
    const d = domainOf(domainSource);
    if (d && !GENERIC_DOMAINS.has(d)) supplierWebsite = `https://${rootDomain(d)}`;
  }

  // ── name: the sender's display name beats a domain guess.
  let supplierName: string | null = input.fromName?.trim() || null;
  if (!supplierName && supplierWebsite) {
    const label = rootDomain(domainOf(domainSource!) ?? "").split(".")[0];
    if (label && label.length > 2) supplierName = label[0].toUpperCase() + label.slice(1);
  }

  return {
    orderReference: extractOrderReference(text, input.subject),
    supplierEmail,
    supplierWebsite,
    supplierName,
  };
}
