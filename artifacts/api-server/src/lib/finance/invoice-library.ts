import { unzipSync } from "fflate";
import { createHash } from "crypto";

// Finance → Invoices library: the pure half (Graeme, 3 Nov 2026) — unpack
// a dropped zip into the PDFs and photos in it, the financial-year and
// period maths for the search, and normalising what Claude reads off an
// invoice. No database here, so it's unit-tested on its own.

export interface InvoiceFile {
  /** Path inside the zip ("Aluxo/2026/INV-1.pdf"), or the plain file name. */
  path: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

/** The stored mime type for an invoice file, or null if it isn't one. */
export function invoiceMimeFor(name: string): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? MIME_BY_EXT[ext] ?? null : null;
}

/** macOS/Windows clutter that rides along in zips — never an invoice. */
function isJunkPath(path: string): boolean {
  const parts = path.split("/");
  const base = parts[parts.length - 1];
  return parts.includes("__MACOSX") || base.startsWith(".") || base === "Thumbs.db" || base === "desktop.ini";
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Every PDF and image in a zip, including zips inside it (one level — a
 * folder of monthly zips). Anything else is listed in `skipped` so the
 * upload summary can say what was left out and why.
 */
export function extractInvoiceFiles(zip: Uint8Array, prefix = "", depth = 0): { files: InvoiceFile[]; skipped: string[] } {
  const files: InvoiceFile[] = [];
  const skipped: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    return { files, skipped: [`${prefix || "zip"} (couldn't be opened — is it a real .zip?)`] };
  }
  for (const [rawPath, bytes] of Object.entries(entries)) {
    if (rawPath.endsWith("/")) continue; // folder entry
    const path = prefix + rawPath;
    if (isJunkPath(path)) continue;
    const name = path.split("/").pop()!;
    if (/\.zip$/i.test(name)) {
      if (depth >= 1) { skipped.push(`${path} (zip inside a zip inside a zip)`); continue; }
      const inner = extractInvoiceFiles(bytes, `${path}/`, depth + 1);
      files.push(...inner.files);
      skipped.push(...inner.skipped);
      continue;
    }
    const mime = invoiceMimeFor(name);
    if (!mime) { skipped.push(`${path} (not a PDF or photo)`); continue; }
    if (bytes.length === 0) { skipped.push(`${path} (empty file)`); continue; }
    files.push({ path, name, mime, bytes, sha256: sha256Of(bytes) });
  }
  return { files, skipped };
}

/** A supplier guess from the folder a file sits in ("Aluxo/INV-1.pdf" →
 *  "Aluxo"), for before Claude has read it. Generic folder names don't count. */
export function supplierHintFromPath(path: string): string | null {
  const folders = path.split("/").slice(0, -1).filter((f) => !/\.zip$/i.test(f));
  for (let i = folders.length - 1; i >= 0; i--) {
    const f = folders[i].trim();
    if (!f) continue;
    if (/^(invoices?|receipts?|documents?|docs|scans?|files?|downloads?|new folder|misc|other|\d{4}([-_ ]\d{2})?|q[1-4]|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)$/i.test(f)) continue;
    if (/^\d{4}[-_/ ]?\d{2}$/.test(f) || /^(19|20)\d{2}[-_ /]?(19|20)?\d{2}$/.test(f)) continue;
    return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Financial year (TCK's runs April → March, as in payroll: "2025/26") and
// periods (calendar months, P1 = April).

export function financialYearOfDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(iso);
  if (!m) throw new Error(`Not a date: "${iso}"`);
  const y = Number(m[1]), month = Number(m[2]);
  const start = month >= 4 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "2025/26" → 1 Apr 2025 … 31 Mar 2026. */
export function financialYearRange(fy: string): { from: string; to: string } {
  const m = /^(\d{4})\/(\d{2})$/.exec(fy);
  if (!m) throw new Error(`Not a financial year: "${fy}"`);
  const start = Number(m[1]);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** Accounting period number in the financial year: April = P1 … March = P12. */
export function periodOf(iso: string): number {
  const month = Number(iso.slice(5, 7));
  return ((month + 8) % 12) + 1;
}

/** "2025/26" + P3 → June 2025 (from/to dates). */
export function periodRange(fy: string, period: number): { from: string; to: string } {
  if (!Number.isInteger(period) || period < 1 || period > 12) throw new Error(`Not a period: ${period}`);
  const start = Number(fy.slice(0, 4));
  const month = ((period + 2) % 12) + 1;
  const year = month >= 4 ? start : start + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

// ---------------------------------------------------------------------------
// Reading an invoice with Claude: the forced tool, and cleaning its answer.

export const INVOICE_READ_PROMPT =
  "This is a document from The Calzone Kitchen's accounts — usually a supplier invoice or receipt. " +
  "Read it and call the tool. supplier_name is the business that ISSUED it (not The Calzone Kitchen). " +
  "invoice_date is the invoice/tax point date as YYYY-MM-DD. total_amount is the grand total payable including VAT; " +
  "vat_amount is the VAT on it (0 if it shows none). Leave anything you can't read with confidence as null rather than guessing.";

export const INVOICE_READ_TOOL = {
  name: "record_invoice",
  description: "Record the key fields of the invoice or receipt.",
  input_schema: {
    type: "object",
    properties: {
      supplier_name: { type: ["string", "null"] },
      invoice_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      invoice_number: { type: ["string", "null"] },
      total_amount: { type: ["number", "null"] },
      vat_amount: { type: ["number", "null"] },
      currency: { type: ["string", "null"], description: "ISO code, e.g. GBP" },
      doc_kind: { type: "string", enum: ["invoice", "receipt", "credit_note", "statement", "other"] },
    },
    required: ["supplier_name", "invoice_date", "invoice_number", "total_amount", "vat_amount", "currency", "doc_kind"],
  },
} as const;

export interface InvoiceReading {
  supplierName: string | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  totalAmount: string | null;
  vatAmount: string | null;
  currency: string;
  docKind: "invoice" | "receipt" | "credit_note" | "statement" | "other";
}

const KINDS = new Set(["invoice", "receipt", "credit_note", "statement", "other"]);

function money(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[£$€,\s]/g, "")) : NaN;
  return Number.isFinite(n) && Math.abs(n) < 10_000_000 ? n.toFixed(2) : null;
}

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/** Validate Claude's answer: bad dates and amounts become null, never junk. */
export function normaliseInvoiceReading(raw: unknown): InvoiceReading {
  const r = (raw ?? {}) as Record<string, unknown>;
  const date = text(r.invoice_date, 10);
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    && date >= "2000-01-01" && date <= "2099-12-31" ? date : null;
  const currency = text(r.currency, 10)?.toUpperCase();
  return {
    supplierName: text(r.supplier_name, 200),
    invoiceDate: validDate,
    invoiceNumber: text(r.invoice_number, 100),
    totalAmount: money(r.total_amount),
    vatAmount: money(r.vat_amount),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : "GBP",
    docKind: typeof r.doc_kind === "string" && KINDS.has(r.doc_kind) ? r.doc_kind as InvoiceReading["docKind"] : "invoice",
  };
}

// ---------------------------------------------------------------------------
// The same invoice as a different file (migration 0350).

/** Supplier name for comparing: case, punctuation and company suffixes
 *  don't matter ("Aluxo Ltd." = "ALUXO LIMITED"). */
export function normaliseSupplierForMatch(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(ltd|limited|plc|llp|llc|inc|uk|co|company|the)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return s || null;
}

/** Two invoices are the same invoice when this key matches: supplier +
 *  invoice number, or — with no number — supplier + date + total. Null =
 *  not enough read off it to say. */
export function invoiceDuplicateKey(i: { supplierName: string | null; invoiceNumber: string | null; invoiceDate: string | null; totalAmount: string | null }): string | null {
  const supplier = normaliseSupplierForMatch(i.supplierName);
  if (!supplier) return null;
  const number = i.invoiceNumber?.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(^|[A-Z])0+(?=\d)/g, "$1");
  if (number) return `${supplier}|#${number}`;
  if (i.invoiceDate && i.totalAmount != null) return `${supplier}|${i.invoiceDate}|${Number(i.totalAmount).toFixed(2)}`;
  return null;
}
