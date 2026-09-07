import { describe, it, expect } from "vitest";
import { renderContract, templatePlaceholders, contractDate, CONTRACT_FIELDS, type ContractField } from "./contract-render";

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

describe("templatePlaceholders", () => {
  it("lists each distinct placeholder once", () => {
    expect(templatePlaceholders("{{a}} {{b}} {{a}}").sort()).toEqual(["a", "b"]);
  });
  it("finds nothing in plain text", () => {
    expect(templatePlaceholders("no tokens { here } {{ UPPER }}")).toEqual([]);
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
