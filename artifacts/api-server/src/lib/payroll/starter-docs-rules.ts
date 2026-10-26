/**
 * Which of a joiner's documents go with the payroll report (Graeme,
 * 2026-10-26: "for any joiners ... attach all of the starter forms"). Pure.
 *
 * Payroll paperwork only: the signed HMRC starter checklist and payroll
 * details forms, and an uploaded P45. NOT the health questionnaire (medical
 * — special category data, never emailed out), right to work or food
 * hygiene certificates: the accountant doesn't run payroll from them.
 */
export const PAYROLL_STARTER_FORMS = ["hmrc_starter", "payroll_details"] as const;
export const PAYROLL_UPLOAD_KINDS = ["p45"] as const;

export function isPayrollStarterForm(formType: string): boolean {
  return (PAYROLL_STARTER_FORMS as readonly string[]).includes(formType);
}
export function isPayrollUpload(kind: string): boolean {
  return (PAYROLL_UPLOAD_KINDS as readonly string[]).includes(kind.toLowerCase());
}

const TITLES: Record<string, string> = { hmrc_starter: "HMRC starter checklist", payroll_details: "Payroll details", p45: "P45" };

/** "Jane Miles – HMRC starter checklist.pdf" */
export function starterDocFileName(personName: string, kind: string, ext = "pdf"): string {
  const safe = personName.replace(/[^\p{L}\p{N} '-]/gu, "").replace(/\s+/g, " ").trim() || "Starter";
  return `${safe} – ${TITLES[kind] ?? kind}.${ext}`;
}
export function starterDocTitle(kind: string): string { return TITLES[kind] ?? kind; }
