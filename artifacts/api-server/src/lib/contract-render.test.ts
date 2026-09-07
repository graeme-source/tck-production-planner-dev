import { describe, it, expect } from "vitest";
import {
  renderContract, templatePlaceholders, contractDate, applySignature, isContractHeading,
  CONTRACT_FIELDS, FOUNDER_SIGNATURE_MARKER, type ContractField,
} from "./contract-render";

const ALL_FIELDS: Record<ContractField, string> = {
  employee_name: "Jane Smith",
  issue_date: "7 September 2026",
  start_date: "14 September 2026",
  rate_of_pay: "£12.50",
  job_title: "Food Production Operative",
  weekly_hours: "41.25",
};

describe("renderContract", () => {
  it("fills every placeholder, including repeats", () => {
    const body = "Between TCK and {{employee_name}}.\nPay: {{rate_of_pay}} per hour.\nSigned {{employee_name}} on {{issue_date}}.";
    const out = renderContract(body, ALL_FIELDS);
    expect(out).toBe("Between TCK and Jane Smith.\nPay: £12.50 per hour.\nSigned Jane Smith on 7 September 2026.");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderContract("Hi {{ employee_name }}!", ALL_FIELDS)).toBe("Hi Jane Smith!");
  });

  it("refuses to issue with a blank field", () => {
    expect(() => renderContract("{{employee_name}}", { ...ALL_FIELDS, rate_of_pay: "  " }))
      .toThrow(/rate_of_pay/);
  });

  it("refuses a template holding a placeholder it can't fill", () => {
    expect(() => renderContract("{{employee_name}} {{shoe_size}}", ALL_FIELDS))
      .toThrow(/shoe_size/);
  });

  it("never lets a placeholder-shaped token through", () => {
    // A field value that itself looks like a placeholder must not survive.
    expect(() => renderContract("{{employee_name}}", { ...ALL_FIELDS, employee_name: "{{oops}}" }))
      .toThrow(/unresolved|doesn't know/);
  });

  it("knows exactly the six agreed fields", () => {
    expect([...CONTRACT_FIELDS].sort()).toEqual([
      "employee_name", "issue_date", "job_title", "rate_of_pay", "start_date", "weekly_hours",
    ]);
  });
});

describe("founder signature marker", () => {
  it("passes through renderContract untouched", () => {
    const out = renderContract(`Director\n\n${FOUNDER_SIGNATURE_MARKER}\n\nDate: {{issue_date}}`, ALL_FIELDS);
    expect(out).toContain(FOUNDER_SIGNATURE_MARKER);
    expect(out).toContain("Date: 7 September 2026");
  });

  it("survives the employee signing", () => {
    const body = `${FOUNDER_SIGNATURE_MARKER}\n\nSigned by Jane Smith\n\n.......\n`;
    const out = applySignature(body, { employeeName: "Jane Smith", initials: "JS", signedOn: "7 September 2026" });
    expect(out).toContain(FOUNDER_SIGNATURE_MARKER);
  });
});

describe("isContractHeading", () => {
  it("bolds all-caps section lines", () => {
    for (const l of ["JOB TITLE", "HOURS OF WORK", "CAPABILITY/DISCIPLINARY APPEAL PROCEDURE", "THE CALZONE KITCHEN", "ELECTRONIC SIGNATURE RECORD"]) {
      expect(isContractHeading(l)).toBe(true);
    }
  });
  it("leaves addresses, clauses, dotted lines and postcodes plain", () => {
    for (const l of ["MK17 0EL", "3 Wood End", "Nash", "0-6 months service - SSP", "..............", "", "On: 7 September 2026"]) {
      expect(isContractHeading(l)).toBe(false);
    }
  });
});

describe("templatePlaceholders", () => {
  it("lists each distinct placeholder once", () => {
    expect(templatePlaceholders("{{a}} {{b}} {{a}}").sort()).toEqual(["a", "b"]);
  });
  it("finds nothing in plain text", () => {
    expect(templatePlaceholders("no tokens { here } {{ UPPER }}")).toEqual([]);
  });
});

describe("applySignature", () => {
  const bodyWithLines = [
    "…contract text…",
    "",
    "Signed by Jane Smith",
    "",
    ".......................................................",
    "",
    "Date: .......................................................",
  ].join("\n");

  it("puts the initials on the employee signature line and fills the date", () => {
    const out = applySignature(bodyWithLines, { employeeName: "Jane Smith", initials: "JS", signedOn: "7 September 2026" });
    expect(out).toContain("Signed by Jane Smith\n\nJS\n");
    expect(out).toContain("Date: 7 September 2026");
    expect(out).toContain("ELECTRONIC SIGNATURE RECORD");
    expect(out).toContain("Initials entered: JS");
  });

  it("does not touch the employer's signature line above", () => {
    const both = [
      "Signed by Graeme Carter,",
      "Managing Director (on behalf of The Calzone Kitchen)",
      "",
      ".......................................................",
      "",
      "Date: 7 September 2026",
      "",
      ...bodyWithLines.split("\n"),
    ].join("\n");
    const out = applySignature(both, { employeeName: "Jane Smith", initials: "JS", signedOn: "8 September 2026" });
    // Employer's dotted line (before "Signed by Jane Smith") survives.
    expect(out.split("Signed by Jane Smith")[0]).toContain(".......");
    expect(out).toContain("Signed by Jane Smith\n\nJS\n");
  });

  it("still appends the record when the template lost the dotted lines", () => {
    const out = applySignature("just text, no signature block", { employeeName: "Jane Smith", initials: "J.S.", signedOn: "7 September 2026" });
    expect(out).toContain("ELECTRONIC SIGNATURE RECORD");
    expect(out).toContain("Initials entered: J.S.");
  });

  it("refuses to sign twice", () => {
    const once = applySignature(bodyWithLines, { employeeName: "Jane Smith", initials: "JS", signedOn: "7 September 2026" });
    expect(() => applySignature(once, { employeeName: "Jane Smith", initials: "JS", signedOn: "8 September 2026" }))
      .toThrow(/already signed/);
  });

  it("refuses blank initials", () => {
    expect(() => applySignature(bodyWithLines, { employeeName: "Jane Smith", initials: "   ", signedOn: "7 September 2026" }))
      .toThrow(/Initials/);
  });
});

describe("contractDate", () => {
  it("formats YYYY-MM-DD the way the contract reads", () => {
    expect(contractDate("2026-09-07")).toBe("7 September 2026");
    expect(contractDate("2026-01-01")).toBe("1 January 2026");
  });
  it("rejects garbage", () => {
    expect(() => contractDate("07/09/2026")).toThrow();
    expect(() => contractDate("")).toThrow();
  });
});
