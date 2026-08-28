// Merchant-name normalisation for card descriptors (plan: the descriptor
// pipeline). Card descriptors are hostile: "SP SAUCE SHOP WSALE",
// "FACEBK *CXX8Z3N4K4", "SQ *CAKEHEAD LIMITED", "WWW.SCREWFIX.C".
// The token AFTER a processor prefix is the real merchant.

// Processor / platform prefixes, longest-first so "AMZNMKTPLACE" wins over "AMZN".
const PROCESSOR_PREFIXES = [
  "SUMUP *", "SUMUP*", "SQ *", "SQ*", "SQUARE *",
  "PAYPAL *", "PAYPAL*", "IZ *", "IZ*", "ZETTLE *",
  "STRIPE *", "GOCARDLESS *", "SP ", "FACEBK *", "SHOPIFY* ", "SHOPIFY*",
  "ANTHROPIC* ", "GOOGLE *",
];

// Descriptors that ARE the merchant identity, mapped to a canonical name.
// These are platforms whose suffix is an order/account id, not a merchant.
const CANONICAL: Array<[RegExp, string]> = [
  [/^AMZN\s*MKTPLACE/i, "Amazon Marketplace"],
  [/^AMZN\s*BUSINESS/i, "Amazon Business"],
  [/^AMAZON\.CO\.UK/i, "Amazon"],
  [/^AMAZON PRIME/i, "Amazon Prime"],
  [/^FACEBK/i, "Facebook Ads"],
  [/^GOOGLE\s*ADS/i, "Google Ads"],
  [/^GOOGLE ONE/i, "Google One"],
  [/^APPLE\.COM\/BILL/i, "Apple"],
  [/^SHOPIFY/i, "Shopify"],
  [/^ANTHROPIC/i, "Anthropic"],
  [/^ONE\.COM/i, "one.com"],
  [/^INDEED/i, "Indeed"],
];

const LEGAL_SUFFIXES = /\s+(LTD|LIMITED|PLC|LLP|INC\.?|CO\.?|UK|GB)\.?$/i;

/**
 * Normalise a raw descriptor (or CoT "Merchant Name") to a canonical
 * merchant key. Uppercased, prefix-stripped, suffix-trimmed. Deterministic
 * and pure — unit-tested.
 */
export function normaliseMerchant(raw: string): string {
  let s = raw.trim();
  if (!s) return "";

  for (const [re, name] of CANONICAL) {
    if (re.test(s)) return name.toUpperCase();
  }

  let upper = s.toUpperCase();

  // Strip processor prefixes (repeat once in case of stacked prefixes).
  for (let pass = 0; pass < 2; pass++) {
    for (const p of PROCESSOR_PREFIXES) {
      if (upper.startsWith(p)) {
        upper = upper.slice(p.length).trim();
        break;
      }
    }
  }

  // "WWW.SCREWFIX.C" / "WWW.CAKEHEAD.CO.UK" → domain core.
  const www = /^WWW\.([A-Z0-9-]+)/.exec(upper);
  if (www) upper = www[1];

  // Trailing store/terminal numbers and long digit runs.
  upper = upper.replace(/[\s-]+\d{3,}$/g, "").trim();
  // Trailing city fragments after " - ".
  upper = upper.split(" - ")[0].trim();
  // Legal suffixes.
  upper = upper.replace(LEGAL_SUFFIXES, "").trim();
  // Collapse whitespace.
  upper = upper.replace(/\s+/g, " ");

  return upper;
}

/**
 * Prefix-tolerant comparison: bank descriptors truncate (~22 chars), so
 * "SCREWFIX.C" should match "SCREWFIX.CO.UK" / "SCREWFIX".
 */
export function merchantsLooselyMatch(a: string, b: string): boolean {
  const na = normaliseMerchant(a);
  const nb = normaliseMerchant(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  return shorter.length >= 4 && longer.startsWith(shorter);
}
