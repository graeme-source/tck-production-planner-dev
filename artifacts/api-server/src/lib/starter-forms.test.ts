import { describe, it, expect } from "vitest";
import {
  STARTER_FORMS, STARTER_FORM_TYPES, HMRC_STARTER, HEALTH_QUESTIONNAIRE, PAYROLL_DETAILS,
  missingRequiredFields, renderStarterFormBody, type StarterFormAnswers,
} from "./starter-forms";

const SIG = { employeeName: "Jane Smith", initials: "JS", signedOn: "7 September 2026" };

describe("starter form definitions", () => {
  it("serves exactly the three agreed forms", () => {
    expect(STARTER_FORM_TYPES.sort()).toEqual(["health_questionnaire", "hmrc_starter", "payroll_details"]);
  });

  it("HMRC form carries the April 2026 student loan plans, Plan 5 included", () => {
    const loans = HMRC_STARTER.sections.find(s => s.title === "Student loan details");
    const plans = loans?.fields.find(f => f.key === "loan_plans");
    expect(plans && plans.kind === "checkboxes" ? plans.options.map(o => o.value) : []).toEqual([
      "plan1", "plan2", "plan4", "plan5", "postgraduate",
    ]);
  });

  it("HMRC statements A, B and C are all present", () => {
    const st = HMRC_STARTER.sections.find(s => s.title === "Employee statement")!.fields[0];
    expect(st.kind === "radio" ? st.options.map(o => o.value) : []).toEqual(["A", "B", "C"]);
  });

  it("health questionnaire asks all 13 medical questions", () => {
    const med = HEALTH_QUESTIONNAIRE.sections.find(s => s.title === "Medical history")!;
    expect(med.fields).toHaveLength(13);
    expect(med.fields.every(f => f.kind === "yesno_detail")).toBe(true);
  });
});

describe("missingRequiredFields", () => {
  it("lists what's blank", () => {
    const missing = missingRequiredFields(PAYROLL_DETAILS, { full_name: "Jane Smith" });
    expect(missing).toContain("Sort code");
    expect(missing).not.toContain("Full name");
    expect(missing).not.toContain("Bank address"); // optional
  });

  it("skips inactive conditional sections — no loan means no plan questions", () => {
    const answers: StarterFormAnswers = { has_student_loan: "no" };
    const missing = missingRequiredFields(HMRC_STARTER, answers);
    expect(missing.join(" ")).not.toMatch(/apply to you/);
  });

  it("requires the loan-details answers once the loan answer is yes", () => {
    const missing = missingRequiredFields(HMRC_STARTER, { has_student_loan: "yes" });
    expect(missing.join(" ")).toMatch(/apply to you/);
  });

  it("treats an unanswered yes/no health question as missing", () => {
    const missing = missingRequiredFields(HEALTH_QUESTIONNAIRE, {});
    expect(missing.length).toBeGreaterThanOrEqual(13);
  });
});

describe("renderStarterFormBody", () => {
  it("renders answers, labels ticked plans, and appends the signature record", () => {
    const answers: StarterFormAnswers = {
      last_name: "Smith", first_names: "Jane", sex: "female", date_of_birth: "1999-01-02",
      home_address: "1 High St\nMK1 1AA", country: "United Kingdom", start_date: "2026-09-14",
      employee_statement: "A", has_student_loan: "yes", loan_exemption: "no", loan_plans: ["plan5"],
    };
    const body = renderStarterFormBody(HMRC_STARTER, answers, SIG);
    expect(body).toContain("HMRC STARTER CHECKLIST");
    expect(body).toContain("Statement A");
    expect(body).toContain("Plan 5");
    expect(body).toContain("ELECTRONIC SIGNATURE RECORD");
    expect(body).toContain("Initials entered: JS");
  });

  it("yes/no answers carry their details", () => {
    const answers: StarterFormAnswers = { q12_allergies: "yes", q12_allergies_detail: "Penicillin" };
    const body = renderStarterFormBody(HEALTH_QUESTIONNAIRE, answers, SIG);
    expect(body).toContain("Yes — Penicillin");
  });

  it("omits the loan-details section when there is no loan", () => {
    const body = renderStarterFormBody(HMRC_STARTER, { has_student_loan: "no" }, SIG);
    expect(body).not.toContain("STUDENT LOAN DETAILS");
  });
});
