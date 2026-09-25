import { describe, it, expect } from "vitest";
import {
  parseRateOfPay, parseWeeklyHours, parseUkDate, namesMatch,
  normaliseContractExtraction, prefillFromExtraction, CONTRACT_EXTRACTION_TOOL,
} from "./contract-extraction";

describe("parseRateOfPay", () => {
  it("reads an hourly rate as the template wants it", () => {
    expect(parseRateOfPay("£12.21 per hour")).toMatchObject({ amount: 12.21, period: "hour", display: "£12.21", warning: null });
    expect(parseRateOfPay("£10.42/hr").display).toBe("£10.42");
    expect(parseRateOfPay("£11 an hour").display).toBe("£11.00");
    expect(parseRateOfPay("£9·50 per hour").display).toBe("£9.50");
  });
  it("reads pence", () => {
    expect(parseRateOfPay("950p per hour").display).toBe("£9.50");
  });
  it("flags a figure with no period, but keeps it", () => {
    const r = parseRateOfPay("£12.50");
    expect(r.display).toBe("£12.50");
    expect(r.warning).toMatch(/per hour/);
  });
  it("won't pretend an annual salary is an hourly rate", () => {
    const r = parseRateOfPay("£24,000 per annum");
    expect(r).toMatchObject({ amount: 24000, period: "year", display: null });
    expect(r.warning).toMatch(/per year/);
  });
  it("flags an implausible hourly figure", () => {
    expect(parseRateOfPay("£24000 per hour").warning).toMatch(/doesn't look like an hourly rate/);
  });
  it("explains minimum-wage wording with no figure", () => {
    const r = parseRateOfPay("The National Living Wage");
    expect(r.display).toBeNull();
    expect(r.warning).toMatch(/Minimum\/Living Wage/);
  });
  it("blank in, blank out", () => {
    expect(parseRateOfPay(null)).toEqual({ amount: null, period: null, display: null, warning: null });
    expect(parseRateOfPay("  ").display).toBeNull();
  });
});

describe("parseWeeklyHours", () => {
  it("reads plain and decimal hours", () => {
    expect(parseWeeklyHours("37.5 hours")).toMatchObject({ hours: 37.5, display: "37.5", warning: null });
    expect(parseWeeklyHours("40 hours per week").display).toBe("40");
    expect(parseWeeklyHours("41.25").display).toBe("41.25");
  });
  it("reads fractions and hours-and-minutes", () => {
    expect(parseWeeklyHours("37½ hours per week").display).toBe("37.5");
    expect(parseWeeklyHours("37 1/2 hours").display).toBe("37.5");
    expect(parseWeeklyHours("37 hours 30 minutes").display).toBe("37.5");
  });
  it("won't pick one end of a range", () => {
    const r = parseWeeklyHours("between 30 and 40 hours");
    expect(r.display).toBeNull();
    expect(r.warning).toMatch(/range/);
    expect(parseWeeklyHours("30-40 hours").display).toBeNull();
  });
  it("flags minimums and zero-hours", () => {
    expect(parseWeeklyHours("a minimum of 30 hours").warning).toMatch(/minimum/);
    expect(parseWeeklyHours("This is a zero hours contract").display).toBeNull();
  });
  it("flags silly numbers", () => {
    expect(parseWeeklyHours("375 hours").warning).toMatch(/doesn't look right/);
  });
});

describe("parseUkDate", () => {
  it("reads numeric dates day-first", () => {
    expect(parseUkDate("01/03/2023")).toBe("2023-03-01");
    expect(parseUkDate("1.3.23")).toBe("2023-03-01");
    expect(parseUkDate("15-08-2022")).toBe("2022-08-15");
  });
  it("reads written dates", () => {
    expect(parseUkDate("1st March 2023")).toBe("2023-03-01");
    expect(parseUkDate("22nd Sept 2021")).toBe("2021-09-22");
    expect(parseUkDate("the 3rd day of January 2024")).toBe("2024-01-03");
    expect(parseUkDate("March 1st, 2023")).toBe("2023-03-01");
    expect(parseUkDate("Monday, 4 September 2023")).toBe("2023-09-04");
  });
  it("passes ISO through", () => {
    expect(parseUkDate("2023-03-01")).toBe("2023-03-01");
  });
  it("refuses impossible or vague dates", () => {
    expect(parseUkDate("31/02/2023")).toBeNull();
    expect(parseUkDate("13/13/2023")).toBeNull();
    expect(parseUkDate("March 2023")).toBeNull();
    expect(parseUkDate("on your first day")).toBeNull();
    expect(parseUkDate(null)).toBeNull();
  });
});

describe("namesMatch", () => {
  it("matches the same person with or without a middle name or title", () => {
    expect(namesMatch("Jane Elizabeth Smith", "Jane Smith")).toBe("match");
    expect(namesMatch("Mrs J. Smith", "J Smith")).toBe("match");
    expect(namesMatch("ZOË BROWN", "Zoe Brown")).toBe("match");
  });
  it("spots a different person", () => {
    expect(namesMatch("John Brown", "Jane Smith")).toBe("mismatch");
  });
  it("is unknown when either side is missing", () => {
    expect(namesMatch(null, "Jane Smith")).toBe("unknown");
    expect(namesMatch("Jane Smith", "")).toBe("unknown");
  });
});

describe("normaliseContractExtraction", () => {
  const answer = {
    readable: true,
    problem: null,
    employee_name: { value: "Jane Smith", source_text: "Name: Jane Smith" },
    job_title: { value: "Food Production Operative", source_text: "You are employed as a Food Production Operative" },
    rate_of_pay: { value: "£10.42 per hour", source_text: "Your rate of pay is £10.42 per hour" },
    weekly_hours: { value: "37.5 hours per week", source_text: "Your normal hours are 37.5 hours per week" },
    start_date: { value: "1st March 2023", source_text: "Your employment began on 1st March 2023" },
    issue_date: { value: "20/02/2023", source_text: "Dated 20/02/2023" },
  };

  it("normalises every field and keeps the source words", () => {
    const x = normaliseContractExtraction(answer, "Jane Smith");
    expect(x.fields.rateOfPay).toEqual({ value: "£10.42", raw: "£10.42 per hour", snippet: "Your rate of pay is £10.42 per hour", warning: null });
    expect(x.fields.weeklyHours.value).toBe("37.5");
    expect(x.fields.startDate.value).toBe("2023-03-01");
    expect(x.fields.issueDate.value).toBe("2023-02-20");
    expect(x.fields.jobTitle.value).toBe("Food Production Operative");
    expect(x.nameCheck).toBe("match");
    expect(x.problem).toBeNull();
    expect(prefillFromExtraction(x)).toEqual({
      jobTitle: "Food Production Operative", rateOfPay: "£10.42", weeklyHours: "37.5", startDate: "2023-03-01",
    });
  });

  it("warns when the name on the contract is someone else", () => {
    const x = normaliseContractExtraction(answer, "Tom Jones");
    expect(x.nameCheck).toBe("mismatch");
    expect(x.fields.employeeName.warning).toMatch(/Tom Jones/);
  });

  it("leaves fields blank when the document doesn't state them", () => {
    const x = normaliseContractExtraction({ ...answer, rate_of_pay: { value: null, source_text: null } }, "Jane Smith");
    expect(x.fields.rateOfPay).toEqual({ value: null, raw: null, snippet: null, warning: null });
  });

  it("never throws on a wrong-shaped answer — just blanks", () => {
    for (const junk of [null, undefined, "nonsense", 42, [], { job_title: 7 }]) {
      const x = normaliseContractExtraction(junk, "Jane Smith");
      expect(x.fields.jobTitle.value).toBeNull();
      expect(x.fields.startDate.value).toBeNull();
    }
  });

  it("carries Claude's reason when it couldn't read the document", () => {
    const x = normaliseContractExtraction({ readable: false, problem: "This is a shopping receipt, not a contract." }, "Jane Smith");
    expect(x.problem).toBe("This is a shopping receipt, not a contract.");
    const y = normaliseContractExtraction({ readable: false }, "Jane Smith");
    expect(y.problem).toMatch(/Couldn't read/);
  });

  it("caps long snippets", () => {
    const x = normaliseContractExtraction({ ...answer, job_title: { value: "Chef", source_text: "word ".repeat(200) } }, "Jane Smith");
    expect(x.fields.jobTitle.snippet!.length).toBeLessThanOrEqual(300);
  });

  it("asks for every field the issuer needs", () => {
    const required = CONTRACT_EXTRACTION_TOOL.input_schema.required;
    for (const f of ["job_title", "rate_of_pay", "weekly_hours", "start_date", "employee_name"]) expect(required).toContain(f);
  });
});
