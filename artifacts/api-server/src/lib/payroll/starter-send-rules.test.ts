import { describe, it, expect } from "vitest";
import {
  starterPayrollReadiness, documentsToSend, payrollSafeAttachments, shouldAutoSend, changedSinceSent,
  buildStarterPayrollMessage, isValidEmail, type StarterPayrollInput,
} from "./starter-send-rules";

const SIGNED = "2026-10-20T10:00:00Z";
const complete: StarterPayrollInput = {
  detailsSubmitted: true,
  forms: [
    { formType: "hmrc_starter", signedAt: SIGNED, answers: {} },
    { formType: "payroll_details", signedAt: SIGNED, answers: { payslip_email: "jane@example.com" } },
    { formType: "health_questionnaire", signedAt: SIGNED, answers: { q1_lungs: "yes" } },
  ],
  uploads: [{ kind: "right_to_work", uploadedAt: SIGNED }],
};

describe("is this starter complete for payroll?", () => {
  it("complete: details in, HMRC checklist and payroll details signed with a payslip email", () => {
    const r = starterPayrollReadiness(complete);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.payslipEmail).toBe("jane@example.com");
  });

  it("a P45 is optional — its absence never holds the send up", () => {
    expect(starterPayrollReadiness({ ...complete, uploads: [] }).complete).toBe(true);
  });

  it("waits for the pre-arrival details", () => {
    const r = starterPayrollReadiness({ ...complete, detailsSubmitted: false });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(["contact & emergency details"]);
  });

  it("a draft (unsigned) form doesn't count", () => {
    const r = starterPayrollReadiness({ ...complete, forms: complete.forms.map(f => f.formType === "hmrc_starter" ? { ...f, signedAt: null } : f) });
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("HMRC starter checklist (signed)");
  });

  it("payroll details without a valid payslip email isn't complete (forms signed before the question existed)", () => {
    for (const payslip of [undefined, "", "jane at home"]) {
      const r = starterPayrollReadiness({ ...complete, forms: complete.forms.map(f => f.formType === "payroll_details" ? { ...f, answers: { payslip_email: payslip } } : f) });
      expect(r.complete).toBe(false);
      expect(r.missing).toEqual(["a payslip email on the payroll details form"]);
    }
  });

  it("the health questionnaire is never needed for payroll", () => {
    const r = starterPayrollReadiness({ ...complete, forms: complete.forms.filter(f => f.formType !== "health_questionnaire") });
    expect(r.complete).toBe(true);
  });
});

describe("which documents go", () => {
  it("HMRC checklist + payroll details, and the P45 when uploaded", () => {
    expect(documentsToSend(complete)).toEqual(["hmrc_starter", "payroll_details"]);
    expect(documentsToSend({ ...complete, uploads: [...complete.uploads, { kind: "P45", uploadedAt: SIGNED }] }))
      .toEqual(["hmrc_starter", "payroll_details", "p45"]);
  });

  // Regression guard (Graeme, 2026-10-27): medical answers are special
  // category data and must never be emailed to the accountant.
  it("NEVER the health questionnaire, nor right to work / food hygiene", () => {
    const docs = documentsToSend({
      forms: [{ formType: "health_questionnaire", signedAt: SIGNED, answers: {} }, ...complete.forms],
      uploads: [{ kind: "right_to_work", uploadedAt: SIGNED }, { kind: "food_hygiene", uploadedAt: SIGNED }, { kind: "other", uploadedAt: SIGNED }],
    });
    expect(docs).not.toContain("health_questionnaire");
    expect(docs).toEqual(["hmrc_starter", "payroll_details"]);
  });

  it("the attachment guard drops a health questionnaire even if a caller hands one in", () => {
    const safe = payrollSafeAttachments([
      { kind: "hmrc_starter" }, { kind: "health_questionnaire" }, { kind: "payroll_details" },
      { kind: "p45" }, { kind: "right_to_work" }, { kind: "other" },
    ]);
    expect(safe.map(a => a.kind)).toEqual(["hmrc_starter", "payroll_details", "p45"]);
  });
});

describe("sending once", () => {
  it("auto-sends only when complete and never twice", () => {
    const r = starterPayrollReadiness(complete);
    expect(shouldAutoSend(r, false)).toBe(true);
    expect(shouldAutoSend(r, true)).toBe(false);
    expect(shouldAutoSend(starterPayrollReadiness({ ...complete, detailsSubmitted: false }), false)).toBe(false);
  });

  it("flags a P45 uploaded after the last send (for 'Send again')", () => {
    const withLateP45 = { ...complete, uploads: [{ kind: "p45", uploadedAt: "2026-10-22T09:00:00Z" }] };
    expect(changedSinceSent(withLateP45, "2026-10-21T09:00:00Z")).toBe(true);
    expect(changedSinceSent(withLateP45, "2026-10-23T09:00:00Z")).toBe(false);
    expect(changedSinceSent(withLateP45, null)).toBe(false);
    // A later health questionnaire is not a payroll change.
    expect(changedSinceSent({ forms: [{ formType: "health_questionnaire", signedAt: "2026-10-25T09:00:00Z", answers: {} }], uploads: [] }, "2026-10-21T09:00:00Z")).toBe(false);
  });
});

describe("the email", () => {
  it("names the person, lists the documents and gives the payslip address", () => {
    const m = buildStarterPayrollMessage({ to: " accountant@example.com ", personName: "Jane Miles", payslipEmail: "jane@example.com", documentTitles: ["HMRC starter checklist", "Payroll details"], resend: false });
    expect(m.to).toBe("accountant@example.com");
    expect(m.subject).toBe("New starter payroll paperwork — Jane Miles");
    expect(m.text).toContain("• HMRC starter checklist");
    expect(m.text).toContain("Please send Jane Miles's payslips to: jane@example.com");
    expect(m.text).toContain("payroll report at the end of their first pay period");
  });

  it("a resend says it's updated, and HTML is escaped", () => {
    const m = buildStarterPayrollMessage({ to: "a@b.co", personName: "<b>Sam</b>", payslipEmail: null, documentTitles: ["P45"], resend: true });
    expect(m.subject.startsWith("Updated: ")).toBe(true);
    expect(m.html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
    expect(m.text).not.toContain("payslips to");
  });

  it("refuses a bad accountant address", () => {
    expect(() => buildStarterPayrollMessage({ to: "nope", personName: "X", payslipEmail: null, documentTitles: [], resend: false })).toThrow();
    expect(isValidEmail("accounts@firm.co.uk")).toBe(true);
  });
});
