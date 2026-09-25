/**
 * A person's contract history as one list — contracts issued in the app
 * plus old ones uploaded as a PDF or photo (Graeme, 2026-09-25). Shapes of
 * /api/contracts/uploaded/* (artifacts/api-server/src/routes/uploaded-
 * contracts.ts) and the pure merge/label rules, tested.
 */

export interface IssuedContractRow {
  id: number;
  jobTitle: string;
  rateOfPay: string;
  weeklyHours: string;
  startDate: string;
  issueDate: string;
  issuedAt: string;
  acknowledgedAt: string | null;
  signedInitials: string | null;
}

export interface ExtractedField {
  value: string | null;
  raw: string | null;
  snippet: string | null;
  warning: string | null;
}

export interface ContractExtraction {
  fields: {
    employeeName: ExtractedField;
    jobTitle: ExtractedField;
    rateOfPay: ExtractedField;
    weeklyHours: ExtractedField;
    startDate: ExtractedField;
    issueDate: ExtractedField;
  };
  nameCheck: "match" | "mismatch" | "unknown";
  problem: string | null;
}

export interface ContractPrefill {
  jobTitle: string | null;
  rateOfPay: string | null;
  weeklyHours: string | null;
  startDate: string | null;
}

/** The employee's own view has only the first block; the founder/HR view
 *  has everything. */
export interface UploadedContractRow {
  id: number;
  userId: number;
  fileName: string | null;
  mime: string;
  byteSize: number;
  originalIssueDate: string | null;
  uploadedAt: string;
  notes?: string | null;
  uploadedByName?: string | null;
  extractedAt?: string | null;
  extraction?: ContractExtraction | null;
  prefill?: ContractPrefill | null;
}

export interface ContractHistoryResponse {
  person: { id: number; name: string; jobTitle: string | null };
  issued: IssuedContractRow[];
  uploaded: UploadedContractRow[];
}

export type ContractHistoryEntry =
  | { key: string; date: string; source: "issued"; label: string; issued: IssuedContractRow }
  | { key: string; date: string; source: "uploaded"; label: string; uploaded: UploadedContractRow };

export function isPdf(mime: string): boolean {
  return mime === "application/pdf";
}

/** How an uploaded contract is labelled everywhere it appears. */
export function uploadedContractLabel(mime: string): string {
  return isPdf(mime) ? "Previous contract (uploaded PDF)" : "Previous contract (uploaded photo)";
}

/** The day an uploaded contract belongs on: the date written on it when
 *  known, else the day it was filed. */
export function uploadedContractDate(u: Pick<UploadedContractRow, "originalIssueDate" | "uploadedAt">): string {
  return (u.originalIssueDate ?? u.uploadedAt).slice(0, 10);
}

/** Issued + uploaded, newest first. On the same day an issued contract sits
 *  above an uploaded one (the in-app one supersedes the paper copy). */
export function contractHistory(issued: readonly IssuedContractRow[], uploaded: readonly UploadedContractRow[]): ContractHistoryEntry[] {
  const out: ContractHistoryEntry[] = [
    ...issued.map(c => ({
      key: `ic-${c.id}`, date: c.issueDate.slice(0, 10), source: "issued" as const,
      label: c.acknowledgedAt ? "Contract — signed in the app" : "Contract — awaiting signature",
      issued: c,
    })),
    ...uploaded.map(u => ({
      key: `uc-${u.id}`, date: uploadedContractDate(u), source: "uploaded" as const,
      label: uploadedContractLabel(u.mime), uploaded: u,
    })),
  ];
  return out.sort((a, b) =>
    b.date.localeCompare(a.date)
    || (a.source === b.source ? 0 : a.source === "issued" ? -1 : 1)
    || b.key.localeCompare(a.key));
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The contract issuer's "?fromUploaded=5" → 5, anything else → null. */
export function fromUploadedParam(search: string): number | null {
  const raw = new URLSearchParams(search).get("fromUploaded");
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

export const CONTRACT_UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

/** Same list the server enforces (lib/uploaded-contract-access.ts). */
export function contractFileProblem(file: { type: string; size: number }, maxMb = 15): string | null {
  if (!CONTRACT_UPLOAD_ACCEPT.split(",").includes(file.type)) {
    return "Use a PDF, or a JPEG/PNG photo of the paper contract.";
  }
  if (file.size > maxMb * 1024 * 1024) return `That file is over ${maxMb} MB — scan it at a lower quality or photograph it instead.`;
  return null;
}
