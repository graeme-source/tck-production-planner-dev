/**
 * Where an invoice came from, in one line for the Inbox (Graeme, 10 Nov
 * 2026): "Uploaded by Gillian on the Finance page · 9 Nov, 13:18", so the
 * bookkeeper can see who put it there and how. Objective I. Pure.
 */

export interface InvoiceSourceFacts {
  /** fin_invoices.source: 'upload' | 'transaction'. */
  source: string;
  uploaderName: string | null;
  /** fin_events 'uploaded' detail.via, when the upload recorded one. */
  via: string | null;
  /** A batch upload on the Invoices page (fin_invoice_uploads). */
  uploadId: number | null;
  /** The zip (or file) the batch was, when known. */
  uploadFileName: string | null;
  createdAt: Date | string;
}

function londonStamp(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" });
  return `${day}, ${time}`;
}

export function invoiceSourceText(f: InvoiceSourceFacts): string {
  const who = f.uploaderName?.trim() || null;
  const by = who ? `by ${who}` : "by someone the app didn't record";
  let how: string;
  if (f.source === "transaction") {
    how = `Added ${by} to a card transaction`;
  } else if (f.via === "outstanding_find_transaction") {
    how = `Uploaded ${by} on the Finance page`;
  } else if (f.uploadId != null) {
    const zip = f.uploadFileName && /\.zip$/i.test(f.uploadFileName) ? ` (${f.uploadFileName})` : "";
    how = `Uploaded ${by} to the Invoices library${zip}`;
  } else {
    how = `Uploaded ${by}`;
  }
  const when = londonStamp(f.createdAt);
  return when ? `${how} · ${when}` : how;
}
