/**
 * Documents on a person's record (Graeme, 2026-09-25) — shapes of
 * /api/person-documents/* (artifacts/api-server/src/routes/person-documents.ts)
 * and the pure labelling / merging / file-check rules, tested. The server
 * holds the real visibility rules (lib/person-document-rules.ts); the
 * defaults here only drive what the add form shows before it's sent.
 */

export const PERSON_DOCUMENT_KINDS = [
  "letter", "certificate", "right_to_work", "training_certificate", "warning", "disciplinary", "other",
] as const;
export type PersonDocumentKind = (typeof PERSON_DOCUMENT_KINDS)[number];
export type PersonDocumentVisibility = "people" | "hr";

export const KIND_LABELS: Record<PersonDocumentKind, string> = {
  letter: "Letter",
  certificate: "Certificate",
  right_to_work: "Right to work",
  training_certificate: "Training certificate",
  warning: "Warning",
  disciplinary: "Disciplinary",
  other: "Other",
};

const ONBOARDING_KIND_LABELS: Record<string, string> = {
  right_to_work: "Right to work",
  food_hygiene: "Food hygiene certificate",
  p45: "P45",
  other: "Other",
};

export function kindLabel(kind: string): string {
  return (KIND_LABELS as Record<string, string>)[kind] ?? "Document";
}

export function onboardingKindLabel(kind: string): string {
  return ONBOARDING_KIND_LABELS[kind] ?? "Document";
}

/** Same rule the server applies: warnings and disciplinaries start
 *  founder-only; everything else starts visible to People access. */
export function isHrDefaultKind(kind: string): boolean {
  return kind === "warning" || kind === "disciplinary";
}

export function defaultVisibility(kind: string): PersonDocumentVisibility {
  return isHrDefaultKind(kind) ? "hr" : "people";
}

export function visibilityLabel(v: PersonDocumentVisibility): string {
  return v === "hr" ? "Graeme only" : "People access";
}

// ── Shapes ─────────────────────────────────────────────────────────────────

export interface PersonDocumentRow {
  id: number;
  userId: number;
  kind: string;
  title: string;
  documentDate: string;
  notes: string | null;
  fileName: string | null;
  mime: string;
  byteSize: number;
  visibility: PersonDocumentVisibility;
  sharedWithEmployee: boolean;
  uploadedByName: string | null;
  uploadedAt: string;
  updatedAt: string;
  canSetVisibility?: boolean;
}

export interface OnboardingDocumentRow {
  id: number;
  kind: string;
  fileName: string | null;
  mime: string;
  byteSize: number;
  uploadedAt: string;
  uploadedByName: string | null;
  visibility: PersonDocumentVisibility;
}

export interface PersonDocumentsResponse {
  person: { id: number; name: string };
  canSetVisibility: boolean;
  documents: PersonDocumentRow[];
  onboarding: OnboardingDocumentRow[];
}

/** What the person themself sees — no notes, no visibility. */
export interface MyDocumentRow {
  id: number;
  kind: string;
  title: string;
  documentDate: string;
  fileName: string | null;
  mime: string;
  byteSize: number;
  uploadedAt: string;
}

/** A save that made the document founder-only for a non-HR person. */
export interface FiledFounderOnly { id: number; filedFounderOnly: true }

export function isFiledFounderOnly(x: unknown): x is FiledFounderOnly {
  return typeof x === "object" && x != null && (x as { filedFounderOnly?: unknown }).filedFounderOnly === true;
}

export type DocumentEntry =
  | { key: string; date: string; source: "filed"; doc: PersonDocumentRow }
  | { key: string; date: string; source: "onboarding"; doc: OnboardingDocumentRow };

/** Filed documents and onboarding uploads as one list, newest first. A
 *  filed document sits on its own date; an onboarding upload on the day it
 *  was uploaded. */
export function documentEntries(filed: readonly PersonDocumentRow[], onboarding: readonly OnboardingDocumentRow[]): DocumentEntry[] {
  const out: DocumentEntry[] = [
    ...filed.map(doc => ({ key: `pd-${doc.id}`, date: doc.documentDate.slice(0, 10), source: "filed" as const, doc })),
    ...onboarding.map(doc => ({ key: `od-${doc.id}`, date: doc.uploadedAt.slice(0, 10), source: "onboarding" as const, doc })),
  ];
  const uploaded = (e: DocumentEntry) => e.doc.uploadedAt;
  return out.sort((a, b) => b.date.localeCompare(a.date) || uploaded(b).localeCompare(uploaded(a)) || b.key.localeCompare(a.key));
}

// ── Files ──────────────────────────────────────────────────────────────────

export const PERSON_DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif";
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]);
export const PERSON_DOCUMENT_MAX_MB = 15;

/** Some browsers hand over a .heic photo with no type at all — work it out
 *  from the name so the server gets a real one. */
export function mimeForFile(file: { type: string; name?: string }): string {
  if (file.type) return file.type;
  const name = (file.name ?? "").toLowerCase();
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (/\.jpe?g$/.test(name)) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  return "";
}

/** Same list and cap the server enforces. */
export function documentFileProblem(file: { type: string; size: number; name?: string }, maxMb = PERSON_DOCUMENT_MAX_MB): string | null {
  if (!ALLOWED.has(mimeForFile(file))) return "Use a PDF, or a photo (JPEG, PNG or HEIC).";
  if (file.size <= 0) return "That file is empty — choose it again.";
  if (file.size > maxMb * 1024 * 1024) return `That file is over ${maxMb} MB — scan it at a lower quality or photograph it instead.`;
  return null;
}

/** "Right_to_work-scan.pdf" → "Right to work scan" (same as the server). */
export function titleFromFileName(name: string | null | undefined, max = 200): string {
  const base = (name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base.slice(0, max);
}
