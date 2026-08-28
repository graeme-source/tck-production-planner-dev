import { createHash } from "crypto";

// Capital on Tap transaction-export parser. Built against the real export
// docs/vat-reconciliation/samples/capital-on-tap-2026-08.csv (27 Aug 2026):
//
//   Clearance Date,Authorisation Date,Description,Amount,Original Amount,
//   Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,
//   Transaction Type,Category,Has Receipts,Note
//
// Dates are DD/MM/YYYY. Repayments appear as negative "Payment made (...)"
// rows and are excluded — they're settlements, not spend. Parsing failures
// throw rather than importing garbage (plan: "alarms loudly").

export interface CotRow {
  clearanceDate: string; // ISO yyyy-mm-dd
  authDate: string | null;
  descriptor: string;
  merchant: string | null;
  amount: string; // decimal string, always > 0 for kept rows
  currency: string;
  originalAmount: string | null;
  originalCurrency: string | null;
  cardLast4: string | null;
  cardholder: string | null;
  dedupeHash: string;
}

export interface CotParseResult {
  rows: CotRow[];
  skippedRepayments: number;
}

const EXPECTED_HEADER_START = ["clearance date", "authorisation date", "description", "amount"];

/** Minimal CSV line splitter with quoted-field support. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** DD/MM/YYYY → yyyy-mm-dd. Throws on anything else. */
export function parseUkDate(s: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`Unrecognised date "${s}" (expected DD/MM/YYYY)`);
  const [, dd, mm, yyyy] = m;
  const day = Number(dd), month = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Out-of-range date "${s}"`);
  }
  return `${yyyy}-${mm}-${dd}`;
}

function cleanAmount(s: string): string {
  const t = s.replace(/[£,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) throw new Error(`Unrecognised amount "${s}"`);
  return t;
}

export function cotDedupeHash(parts: {
  source: string;
  clearanceDate: string;
  authDate: string | null;
  amount: string;
  descriptor: string;
  cardLast4: string | null;
}): string {
  const key = [
    parts.source,
    parts.clearanceDate,
    parts.authDate ?? "",
    parts.amount,
    parts.descriptor.trim().toUpperCase(),
    parts.cardLast4 ?? "",
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function parseCotCsv(text: string): CotParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("Empty file");

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  for (let i = 0; i < EXPECTED_HEADER_START.length; i++) {
    if (header[i] !== EXPECTED_HEADER_START[i]) {
      throw new Error(
        `Unexpected column ${i + 1}: got "${header[i] ?? ""}", expected "${EXPECTED_HEADER_START[i]}". ` +
          `Capital on Tap may have changed their export format — do not import.`
      );
    }
  }
  const col = (name: string) => header.indexOf(name);
  const cMerchant = col("merchant name");
  const cCard = col("card ending");
  const cHolder = col("cardholder name");
  const cOrigAmt = col("original amount");
  const cOrigCcy = col("original currency");

  const rows: CotRow[] = [];
  let skippedRepayments = 0;

  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    if (f.length < 4) throw new Error(`Row ${i + 1}: too few columns`);
    const descriptor = f[2].trim();
    const amount = cleanAmount(f[3]);

    // Repayments: negative "Payment made (...)" rows. Settlements, not spend.
    if (Number(amount) <= 0 || /^payment made/i.test(descriptor)) {
      skippedRepayments++;
      continue;
    }

    const clearanceDate = parseUkDate(f[0]);
    const authDateRaw = f[1]?.trim();
    const authDate = authDateRaw ? parseUkDate(authDateRaw) : null;
    const origCcy = cOrigCcy >= 0 ? f[cOrigCcy]?.trim() || null : null;
    const cardLast4 = cCard >= 0 ? f[cCard]?.trim() || null : null;

    rows.push({
      clearanceDate,
      authDate,
      descriptor,
      merchant: cMerchant >= 0 ? f[cMerchant]?.trim() || null : null,
      amount,
      currency: "GBP", // CoT settles the card in GBP; original currency kept separately
      originalAmount: cOrigAmt >= 0 && f[cOrigAmt]?.trim() ? cleanAmount(f[cOrigAmt]) : null,
      originalCurrency: origCcy,
      cardLast4,
      cardholder: cHolder >= 0 ? f[cHolder]?.trim() || null : null,
      dedupeHash: cotDedupeHash({
        source: "capital_on_tap",
        clearanceDate,
        authDate,
        amount,
        descriptor,
        cardLast4,
      }),
    });
  }

  return { rows, skippedRepayments };
}
