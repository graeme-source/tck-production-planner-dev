/**
 * What a person handed in at onboarding, as documents on their People record
 * (Graeme, 2026-10-12: "Can you map them to the ones he did on onboarding and
 * make sure that happens with everyone else going forward").
 *
 * A READ-TIME mapping — nothing is copied into person_documents. The
 * onboarding tables stay the single source; every list of a person's
 * documents (routes/person-documents.ts GET /person/:userId) joins them in
 * here, so it works for everyone already onboarded and everyone after, with
 * no backfill and no second copy of a P45 or a bank form to keep in step.
 *
 * Three sources:
 *   • 'upload'          onboarding_documents — files they uploaded (right to
 *                       work / ID, food hygiene certificate, P45, other);
 *   • 'starter_form'    starter_form_submissions — the HMRC starter
 *                       checklist, payroll details (bank, NI) and health
 *                       questionnaire, once SIGNED (drafts aren't documents);
 *   • 'onboarding_form' onboarding_submissions — the pre-arrival form itself
 *                       (contact, footwear), opened as a summary PDF.
 *
 * Who sees each (same rule as filed documents — lib/person-document-rules.ts
 * canSeeVisibility, behind People access + the private People PIN):
 *   • the P45 and every starter form are 'hr' (Graeme only): pay and tax to
 *     date, bank details, NI number, health answers — the same people who
 *     could read them on /founder/contracts;
 *   • the other uploads and the onboarding form are 'people'.
 * A list only ever carries a title and a date — never bank details or an NI
 * number; those are only inside the (gated) document.
 */
import { canSeeVisibility, type PersonDocViewer, type PersonDocumentVisibility } from "./person-document-rules";
import { STARTER_FORMS } from "./starter-forms";

export type OnboardingRecordSource = "upload" | "starter_form" | "onboarding_form";

export interface OnboardingRecordDoc {
  /** Unique across sources — "od-3", "sf-12", "of-5". */
  key: string;
  source: OnboardingRecordSource;
  /** The row's id in its own table. */
  id: number;
  /** Upload kind ('p45'…), the starter form type, or 'onboarding_form'. */
  kind: string;
  /** "P45", "HMRC Starter Checklist", "Onboarding form". */
  title: string;
  /** "P45 — from onboarding, 11 Sept 2026". */
  label: string;
  /** When it was handed in — London day, YYYY-MM-DD. */
  date: string;
  /** When it was handed in — the instant (sorting ties). */
  at: string;
  fileName: string | null;
  mime: string;
  /** Unknown (null) for a document rendered on demand. */
  byteSize: number | null;
  visibility: PersonDocumentVisibility;
}

const UPLOAD_TITLES: Record<string, string> = {
  right_to_work: "Right to work / ID",
  food_hygiene: "Food hygiene certificate",
  p45: "P45",
  other: "Document",
};

export function onboardingUploadTitle(kind: string): string {
  return UPLOAD_TITLES[kind] ?? "Document";
}

export function starterFormTitle(formType: string): string {
  return STARTER_FORMS[formType]?.title ?? "Starter form";
}

export const ONBOARDING_FORM_TITLE = "Onboarding form";

/** The P45 carries pay and tax to date; the starter forms carry bank
 *  details, NI number and health answers. Everything else is People. */
export function onboardingRecordVisibility(source: OnboardingRecordSource, kind: string): PersonDocumentVisibility {
  if (source === "starter_form") return "hr";
  if (source === "upload" && kind === "p45") return "hr";
  return "people";
}

const LONDON_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});

/** The London day of an instant, YYYY-MM-DD. */
export function londonYmd(at: Date): string {
  return LONDON_YMD.format(at);
}

// Spelt out here rather than left to the runtime's ICU, which says "Sep" on
// some versions and "Sept" on others.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

/** "2026-09-11" → "11 Sept 2026". */
export function fmtUkDay(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return ymd;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "P45 — from onboarding, 11 Sept 2026". */
export function fromOnboardingLabel(title: string, ymd: string): string {
  return `${title} — from onboarding, ${fmtUkDay(ymd)}`;
}

export interface OnboardingUploadFacts {
  id: number; kind: string; fileName: string | null; mime: string | null; byteSize: number | null;
  uploadedAt: Date; hasFile: boolean;
}
export interface StarterFormFacts {
  id: number; formType: string; signedAt: Date | null; pdfBytes: number | null;
}
export interface OnboardingFormFacts {
  id: number; submittedAt: Date | null;
}

function doc(
  source: OnboardingRecordSource, prefix: string, id: number, kind: string, title: string, at: Date,
  file: { fileName: string | null; mime: string; byteSize: number | null },
): OnboardingRecordDoc {
  const date = londonYmd(at);
  return {
    key: `${prefix}-${id}`, source, id, kind, title, label: fromOnboardingLabel(title, date), date,
    at: at.toISOString(), ...file, visibility: onboardingRecordVisibility(source, kind),
  };
}

/** Everything a person handed in at onboarding, as record documents, oldest
 *  first. Only what can actually be opened: an upload with a file, a SIGNED
 *  starter form, a SUBMITTED onboarding form. Not filtered by viewer — see
 *  onboardingRecordDocsFor. */
export function onboardingRecordDocs(input: {
  uploads: readonly OnboardingUploadFacts[];
  starterForms: readonly StarterFormFacts[];
  form: OnboardingFormFacts | null;
}): OnboardingRecordDoc[] {
  const out: OnboardingRecordDoc[] = [];
  for (const u of input.uploads) {
    if (!u.hasFile) continue;
    out.push(doc("upload", "od", u.id, u.kind, onboardingUploadTitle(u.kind), u.uploadedAt, {
      fileName: u.fileName, mime: u.mime || "application/octet-stream", byteSize: u.byteSize,
    }));
  }
  for (const f of input.starterForms) {
    if (!f.signedAt) continue;
    out.push(doc("starter_form", "sf", f.id, f.formType, starterFormTitle(f.formType), f.signedAt, {
      fileName: null, mime: "application/pdf", byteSize: f.pdfBytes,
    }));
  }
  if (input.form?.submittedAt) {
    out.push(doc("onboarding_form", "of", input.form.id, "onboarding_form", ONBOARDING_FORM_TITLE, input.form.submittedAt, {
      fileName: null, mime: "application/pdf", byteSize: null,
    }));
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}

/** Can this viewer open an onboarding document of this source/kind from the
 *  People side? People access is required even for HR (the founder has
 *  both) — HR alone is never a way around the People gate. */
export function canSeeOnboardingRecordDoc(viewer: PersonDocViewer, source: OnboardingRecordSource, kind: string): boolean {
  return viewer.viewerId != null && viewer.hasPeopleAccess && canSeeVisibility(viewer, onboardingRecordVisibility(source, kind));
}

/** The list as this viewer may see it; everything else is simply left out. */
export function onboardingRecordDocsFor(viewer: PersonDocViewer, docs: readonly OnboardingRecordDoc[]): OnboardingRecordDoc[] {
  return docs.filter(d => canSeeOnboardingRecordDoc(viewer, d.source, d.kind));
}

/** The person themself streaming one of their OWN onboarding uploads
 *  (/api/onboarding/documents/:id/file). Nobody else, whatever their role —
 *  a colleague's files are read only from the People record. Regression:
 *  this route used to hand any manager or admin anyone's P45 (closed
 *  2026-09-28, test added 2026-10-12). */
export function canStreamOwnOnboardingUpload(sessionUserId: number | null | undefined, ownerUserId: number): boolean {
  return sessionUserId != null && sessionUserId === ownerUserId;
}

// ── The onboarding form as a readable document ─────────────────────────────

export interface OnboardingFormSummaryInput {
  personName: string;
  submittedAt: Date | null;
  phone: string | null;
  address: string | null;
  shoeSize: string | null;
  footwearChoice: string | null;
  /** What else they handed in, already filtered to what the viewer may see. */
  alsoHandedIn: readonly Pick<OnboardingRecordDoc, "label" | "source">[];
}

function footwearText(choice: string | null, size: string | null): string {
  const kind = choice === "safety_shoes" ? "Safety shoes" : choice === "crocs" ? "Crocs" : null;
  return [size ? `UK ${size}` : null, kind].filter(Boolean).join(" · ") || "—";
}

/** Plain text, rendered to PDF on the house letterhead. The emergency
 *  contact is deliberately NOT repeated: the current one is revealed on the
 *  record's Emergency contact panel, where every look is logged. */
export function onboardingFormSummaryBody(input: OnboardingFormSummaryInput): string {
  const v = (s: string | null) => (s && s.trim() ? s.trim() : "—");
  const lines = [
    "ONBOARDING FORM",
    "",
    `Name: ${input.personName}`,
    `Filled in: ${input.submittedAt ? fmtUkDay(londonYmd(input.submittedAt)) : "—"}`,
    "",
    "CONTACT DETAILS",
    `Mobile: ${v(input.phone)}`,
    `Home address: ${v(input.address)}`,
    "",
    "FOOTWEAR",
    `Footwear: ${footwearText(input.footwearChoice, input.shoeSize)}`,
    "",
    "EMERGENCY CONTACT",
    "Kept current on the Emergency contact panel of the People record (every look is logged).",
  ];
  const others = input.alsoHandedIn.filter(d => d.source !== "onboarding_form");
  if (others.length > 0) {
    lines.push("", "ALSO HANDED IN AT ONBOARDING", ...others.map(d => `• ${d.label}`));
  }
  lines.push("", "Submitted by the starter from their own signed-in account in the TCK Production Planner.");
  return lines.join("\n");
}
