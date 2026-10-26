import { describe, it, expect } from "vitest";
import { isPayrollStarterForm, isPayrollUpload, starterDocFileName } from "./starter-docs-rules";

describe("payroll starter documents", () => {
  it("HMRC checklist and payroll details go; the health questionnaire never does", () => {
    expect(isPayrollStarterForm("hmrc_starter")).toBe(true);
    expect(isPayrollStarterForm("payroll_details")).toBe(true);
    expect(isPayrollStarterForm("health_questionnaire")).toBe(false);
  });
  it("a P45 upload goes; right to work and food hygiene don't", () => {
    expect(isPayrollUpload("P45")).toBe(true);
    expect(isPayrollUpload("right_to_work")).toBe(false);
    expect(isPayrollUpload("food_hygiene")).toBe(false);
  });
  it("file names say whose and what", () => {
    expect(starterDocFileName("Jane Miles", "hmrc_starter")).toBe("Jane Miles – HMRC starter checklist.pdf");
    expect(starterDocFileName("O'Neil / test", "p45", "jpg")).toBe("O'Neil test – P45.jpg");
  });
});
