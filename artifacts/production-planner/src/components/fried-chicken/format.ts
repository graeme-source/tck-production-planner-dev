/**
 * How quantities read on a pull sheet.
 *
 * Recipes store grams and millilitres because that is how they are written,
 * but nobody walks into a chill store looking for 74771 g of chicken. Over a
 * thousand, it reads in the bigger unit; under it, it stays as written.
 */
export function formatQuantity(qty: number, unit: string): string {
  const n = Number.isFinite(qty) ? qty : 0;
  const u = (unit ?? "").trim().toLowerCase();

  if (u === "g" && Math.abs(n) >= 1000) return `${trim(n / 1000)} kg`;
  if (u === "ml" && Math.abs(n) >= 1000) return `${trim(n / 1000)} L`;
  return `${trim(n)}${u ? ` ${unit}` : ""}`;
}

/** Two decimals at most, and no trailing zeros — "3 kg", not "3.00 kg". */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

const SENT_AT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * When the day's chicken went to Shopify, in London time — "12 Oct, 16:24".
 *
 * The send is stored as a UTC ISO string (…Z). Formatting it in the device's
 * own zone is only right when the device is set to London, so the zone is
 * pinned here. (Checked 12 Oct 2026: the live record for plan 192 is
 * 15:24Z — a real 16:24 BST send — so the old screen was showing it right.)
 * Empty or unreadable input gives "".
 */
export function formatSentAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    SENT_AT.formatToParts(d).find(p => p.type === type)?.value ?? "";
  return `${part("day")} ${part("month")}, ${part("hour")}:${part("minute")}`;
}

/** The greyed "already sent" line: "Sent to Shopify ✓ — 12 Oct, 16:24 · 155 bags". */
export function sentToShopifyLabel(sent: { at: string; bags: number }): string {
  const when = formatSentAt(sent.at);
  const bags = `${sent.bags} bag${sent.bags === 1 ? "" : "s"}`;
  return when ? `Sent to Shopify ✓ — ${when} · ${bags}` : `Sent to Shopify ✓ — ${bags}`;
}
