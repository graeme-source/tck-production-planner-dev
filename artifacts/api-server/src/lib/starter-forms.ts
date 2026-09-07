/**
 * Starter form definitions — the single source of truth for what each form
 * asks (Graeme, 2026-09-07). The client renders whatever this serves, so a
 * question changed here changes everywhere: the hub, the onboarding flow,
 * the rendered document and the archival PDF.
 *
 * Three forms, digitised from the paper set in HR/Onboarding "2025 Files to
 * Send", with the HMRC starter checklist brought up to the April 2026
 * version: student loan Plan 5 (England, courses from 1 Aug 2023; deductions
 * from 6 April 2026) joins Plans 1, 2, 4 and postgraduate. Statements A/B/C
 * are unchanged. Sources: gov.uk starter-checklist guidance (updated
 * 2 March 2026); CIPP "New Starter Checklist updated ready for April 2026".
 *
 * The paper health questionnaire's typos are fixed here ("Ant arthritis",
 * "carpel tunnel", "respective strain"); the questions themselves are
 * unchanged.
 */

export type StarterFormField =
  | { kind: "text"; key: string; label: string; required?: boolean; help?: string; inputMode?: "numeric" }
  | { kind: "date"; key: string; label: string; required?: boolean; help?: string }
  | { kind: "textarea"; key: string; label: string; required?: boolean; help?: string }
  | { kind: "radio"; key: string; label: string; required?: boolean; help?: string; options: { value: string; label: string; help?: string }[] }
  | { kind: "checkboxes"; key: string; label: string; help?: string; options: { value: string; label: string; help?: string }[] }
  | { kind: "yesno_detail"; key: string; label: string; required?: boolean; detailLabel?: string }
  | { kind: "info"; key: string; text: string };

export interface StarterFormSection {
  title: string;
  description?: string;
  fields: StarterFormField[];
  /** Only shown/required when the named field has one of these values. */
  showWhen?: { key: string; equals: string[] };
}

export interface StarterFormDefinition {
  type: string;
  title: string;
  description: string;
  sections: StarterFormSection[];
}

export const HMRC_STARTER: StarterFormDefinition = {
  type: "hmrc_starter",
  title: "HMRC Starter Checklist",
  description:
    "Tells us your tax circumstances so you don't pay too much or too little tax. " +
    "We keep this for payroll — it is never sent to HMRC. If you have a P45 from your last job, please also hand that in.",
  sections: [
    {
      title: "Your personal details",
      fields: [
        { kind: "text", key: "last_name", label: "Last name", required: true },
        { kind: "text", key: "first_names", label: "First names", required: true, help: "Full names — not initials or shortened names (James, not Jim)." },
        { kind: "radio", key: "sex", label: "What is your sex? (required for payroll/HMRC reporting)", required: true, help: "Asked only because HMRC requires it for payroll. Answer as shown on your birth certificate or gender recognition certificate.", options: [
          { value: "male", label: "Male" }, { value: "female", label: "Female" },
        ] },
        { kind: "date", key: "date_of_birth", label: "Date of birth", required: true },
        { kind: "textarea", key: "home_address", label: "Home address (including postcode)", required: true },
        { kind: "text", key: "country", label: "Country", required: true },
        { kind: "text", key: "ni_number", label: "National Insurance number (if known)", help: "For example QQ 12 34 56 C — it's on payslips, P60s and HMRC letters." },
        { kind: "date", key: "start_date", label: "Employment start date", required: true },
      ],
    },
    {
      title: "Employee statement",
      description:
        "Pick the one statement that matches your circumstances — it decides your starting tax code. " +
        "Only Jobseeker's Allowance, Employment and Support Allowance and Incapacity Benefit count as taxable benefits here.",
      fields: [
        { kind: "radio", key: "employee_statement", label: "Which statement applies to you?", required: true, options: [
          { value: "A", label: "Statement A — this is my first job since 6 April, and since then I have not received Jobseeker's Allowance, Employment and Support Allowance or Incapacity Benefit", help: "Tax code: current personal allowance." },
          { value: "B", label: "Statement B — since 6 April I have had another job (but no P45), and/or I have received Jobseeker's Allowance, Employment and Support Allowance or Incapacity Benefit", help: "Tax code: current personal allowance on a week 1/month 1 basis." },
          { value: "C", label: "Statement C — I have another job, and/or I receive a State, workplace or private pension", help: "Tax code: BR." },
        ] },
      ],
    },
    {
      title: "Student loans",
      fields: [
        { kind: "radio", key: "has_student_loan", label: "Do you have a student or postgraduate loan?", required: true, options: [
          { value: "yes", label: "Yes" }, { value: "no", label: "No" },
        ] },
      ],
    },
    {
      title: "Student loan details",
      showWhen: { key: "has_student_loan", equals: ["yes"] },
      fields: [
        { kind: "radio", key: "loan_exemption", label: "Do any of these apply to you?", required: true, help:
          "You're still studying on the course the loan relates to; you completed or left the course after this tax year started (6 April); you've already repaid the loan in full; or you repay the Student Loans Company by Direct Debit to manage your end-of-loan repayments.", options: [
          { value: "yes", label: "Yes — one of those applies (no deductions through payroll)" },
          { value: "no", label: "No — none of those apply" },
        ] },
        { kind: "checkboxes", key: "loan_plans", label: "Which loan or loans do you have? Tick all that apply.", help:
          "Plan 1: you lived in Northern Ireland, or in England/Wales and started before 1 September 2012. " +
          "Plan 2: England/Wales, started 1 September 2012 to 31 July 2023. " +
          "Plan 4: Scotland (applied through SAAS). " +
          "Plan 5: England, course started on or after 1 August 2023. " +
          "Postgraduate loan: England master's from 1 August 2016, Wales master's from 1 August 2017, or doctoral from 1 August 2018. " +
          "Check yours at gov.uk/sign-in-to-manage-your-student-loan-balance.", options: [
          { value: "plan1", label: "Plan 1" },
          { value: "plan2", label: "Plan 2" },
          { value: "plan4", label: "Plan 4" },
          { value: "plan5", label: "Plan 5" },
          { value: "postgraduate", label: "Postgraduate loan (England and Wales only)" },
        ] },
      ],
    },
    {
      title: "Declaration",
      fields: [
        { kind: "info", key: "declaration", text: "I confirm that the information I've given on this form is correct. Signing below records your full name, initials and the date." },
      ],
    },
  ],
};

export const PAYROLL_DETAILS: StarterFormDefinition = {
  type: "payroll_details",
  title: "Personnel Payroll Details",
  description:
    "Strictly private and confidential — how we pay you. Seen only by Graeme and the payroll accountant. " +
    "If you have a P45 from your last job, upload it with your onboarding documents or hand it in.",
  sections: [
    {
      title: "Your details",
      fields: [
        { kind: "text", key: "full_name", label: "Full name", required: true },
        { kind: "textarea", key: "address", label: "Address (including postcode)", required: true },
        { kind: "text", key: "marital_status", label: "Marital status", required: true },
        { kind: "date", key: "date_of_birth", label: "Date of birth", required: true },
        { kind: "text", key: "ni_number", label: "National Insurance number", required: true },
      ],
    },
    {
      title: "Bank details",
      description: "Where your pay goes each month.",
      fields: [
        { kind: "text", key: "bank_name", label: "Bank name", required: true },
        { kind: "textarea", key: "bank_address", label: "Bank address" },
        { kind: "text", key: "sort_code", label: "Sort code", required: true, inputMode: "numeric", help: "Six digits, e.g. 12-34-56." },
        { kind: "text", key: "account_name", label: "Account name", required: true },
        { kind: "text", key: "account_number", label: "Account number", required: true, inputMode: "numeric", help: "Eight digits." },
      ],
    },
    {
      title: "Declaration",
      fields: [
        { kind: "info", key: "declaration", text: "I confirm these details are correct. Signing below records your full name, initials and the date." },
      ],
    },
  ],
};

const HEALTH_QUESTIONS: { key: string; label: string }[] = [
  { key: "q1_lungs", label: "Tuberculosis, pleurisy, asthma, bronchitis or any lung, throat or ear complaint" },
  { key: "q2_heart", label: "Any disorder of the heart, circulatory system, high blood pressure, varicose veins or piles" },
  { key: "q3_digestive", label: "Persistent indigestion, gastric or duodenal ulcer, intestinal complaints or rupture" },
  { key: "q4_neuro", label: "Paralysis, epilepsy, blackouts, fits or migraine" },
  { key: "q5_mental_health", label: "Any psychological or nervous complaint (depression, stress, anxiety, mental health issues etc.)" },
  { key: "q6_diabetes", label: "Diabetes, gout or any kidney or bladder complaint" },
  { key: "q7_musculoskeletal", label: "Any arthritis, slipped disc, rheumatism or any back trouble" },
  { key: "q8_skin", label: "Any dermatitis, eczema, skin rash or other skin complaint" },
  { key: "q9_hearing", label: "Any deafness or issues with ears or hearing" },
  { key: "q10_rsi", label: "Any repetitive strain injury, carpal tunnel syndrome, severe cramp, vibration white finger etc." },
  { key: "q11_eyes", label: "Any eye complaint including recurrent headaches, blurred vision or eye disorder" },
  { key: "q12_allergies", label: "Do you have any allergies? E.g. hay fever, food, medication, animals" },
  { key: "q13_other", label: "Any other significant medical problem, excluding coughs/colds/flu" },
];

export const HEALTH_QUESTIONNAIRE: StarterFormDefinition = {
  type: "health_questionnaire",
  title: "TCK Health Questionnaire",
  description:
    "Part of our health and safety management programme — so all due care and attention is given to your health in the work " +
    "we ask you to do. Kept confidential by the business and its professional advisors. If you have any concerns, talk to a manager first.",
  sections: [
    {
      title: "Personal details",
      fields: [
        { kind: "text", key: "first_names", label: "First names", required: true },
        { kind: "text", key: "surname", label: "Surname", required: true },
        { kind: "textarea", key: "address", label: "Address (including postcode)", required: true },
        { kind: "text", key: "telephone", label: "Telephone", required: true },
        { kind: "date", key: "date_of_birth", label: "Date of birth", required: true },
        // The paper form asked for sex here; dropped 2026-09-07 — a health
        // screen doesn't need it, and where it IS needed (payroll) the HMRC
        // form already asks with the reason stated.
      ],
    },
    {
      title: "Medical history",
      description: "Have you ever suffered any of the following? Answer every question; give details for any 'Yes'.",
      fields: HEALTH_QUESTIONS.map(q => ({ kind: "yesno_detail" as const, key: q.key, label: q.label, required: true })),
    },
    {
      title: "Declaration",
      fields: [
        { kind: "info", key: "declaration", text: "I hereby declare that all the foregoing statements are true and correct to the best of my knowledge and belief. Signing below records your full name, initials and the date." },
      ],
    },
  ],
};

export const STARTER_FORMS: Record<string, StarterFormDefinition> = {
  [HMRC_STARTER.type]: HMRC_STARTER,
  [PAYROLL_DETAILS.type]: PAYROLL_DETAILS,
  [HEALTH_QUESTIONNAIRE.type]: HEALTH_QUESTIONNAIRE,
};

export const STARTER_FORM_TYPES = Object.keys(STARTER_FORMS);

export type StarterFormAnswers = Record<string, string | string[]>;

function sectionActive(section: StarterFormSection, answers: StarterFormAnswers): boolean {
  if (!section.showWhen) return true;
  const v = answers[section.showWhen.key];
  return typeof v === "string" && section.showWhen.equals.includes(v);
}

/** Blank-check for signing. Drafts may be as partial as they like; a
 *  SIGNATURE requires every required field of every active section. */
export function missingRequiredFields(def: StarterFormDefinition, answers: StarterFormAnswers): string[] {
  const missing: string[] = [];
  for (const section of def.sections) {
    if (!sectionActive(section, answers)) continue;
    for (const field of section.fields) {
      if (field.kind === "info" || field.kind === "checkboxes") continue;
      if (!("required" in field) || !field.required) continue;
      const v = answers[field.key];
      if (field.kind === "yesno_detail") {
        if (v !== "yes" && v !== "no") missing.push(field.label);
        continue;
      }
      if (typeof v !== "string" || v.trim() === "") missing.push(field.label);
    }
  }
  return missing;
}

function answerText(field: StarterFormField, answers: StarterFormAnswers): string {
  const v = answers[field.key];
  if (field.kind === "yesno_detail") {
    if (v === "yes") {
      const detail = answers[`${field.key}_detail`];
      const d = typeof detail === "string" && detail.trim() !== "" ? ` — ${detail.trim()}` : "";
      return `Yes${d}`;
    }
    return v === "no" ? "No" : "—";
  }
  if (field.kind === "checkboxes") {
    if (!Array.isArray(v) || v.length === 0) return "None ticked";
    const byValue = new Map(field.options.map(o => [o.value, o.label]));
    return v.map(x => byValue.get(x) ?? x).join(", ");
  }
  if (field.kind === "radio") {
    const opt = field.options.find(o => o.value === v);
    return opt ? opt.label : "—";
  }
  return typeof v === "string" && v.trim() !== "" ? v.trim() : "—";
}

/** The rendered plain-text document, in the house contract style — this is
 *  what gets frozen (and PDF'd) at signing. */
export function renderStarterFormBody(
  def: StarterFormDefinition,
  answers: StarterFormAnswers,
  sig: { employeeName: string; initials: string; signedOn: string },
): string {
  const lines: string[] = [];
  lines.push(def.title.toUpperCase(), "", def.description, "");
  for (const section of def.sections) {
    if (!sectionActive(section, answers)) continue;
    lines.push(section.title.toUpperCase());
    if (section.description) lines.push(section.description);
    for (const field of section.fields) {
      if (field.kind === "info") { lines.push(field.text); continue; }
      lines.push(`${field.label}: ${answerText(field, answers)}`);
    }
    lines.push("");
  }
  lines.push(
    "--------------------------------------------------------",
    "ELECTRONIC SIGNATURE RECORD",
    `Signed by: ${sig.employeeName}`,
    `Initials entered: ${sig.initials}`,
    `Signed on: ${sig.signedOn}`,
    "Recorded in the TCK Production Planner from the employee's own signed-in account.",
  );
  return lines.join("\n");
}
