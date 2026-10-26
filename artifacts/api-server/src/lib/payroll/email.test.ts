import { describe, expect, it } from "vitest";
import { buildPayrollEmail, payrollPdfFilename } from "./email";

const base = {
  to: ["bureau@example.com", "founder@example.com", "bureau@example.com"],
  periodLabel: "October 2026",
  pdf: Buffer.from("%PDF-1.4 test"),
  attachments: [{ filename: "starter-checklist.pdf", content: Buffer.from("abc"), contentType: "application/pdf" }],
  sentByName: "Graeme",
};

describe("buildPayrollEmail", () => {
  it("builds subject, recipients and attachments", () => {
    const e = buildPayrollEmail(base);
    expect(e.subject).toBe("TCK payroll report — October 2026");
    expect(e.to).toBe("bureau@example.com");
    expect(e.cc).toEqual(["founder@example.com"]);
    expect(e.attachments?.map(a => a.filename)).toEqual(["tck-payroll-october-2026.pdf", "starter-checklist.pdf"]);
    expect(e.attachments?.[0]?.content).toBe(Buffer.from("%PDF-1.4 test").toString("base64"));
    expect(e.attachments?.[1]?.contentType).toBe("application/pdf");
    expect(e.text).toContain("plus 1 starter form.");
    expect(e.text).toContain("Graeme");
  });

  it("includes the note, escaped in HTML", () => {
    const e = buildPayrollEmail({ ...base, note: "Sam's <b>overtime</b> is included" });
    expect(e.text).toContain("Sam's <b>overtime</b> is included");
    expect(e.html).toContain("&lt;b&gt;overtime&lt;/b&gt;");
  });

  it("single recipient has no cc and no starter-form line", () => {
    const e = buildPayrollEmail({ ...base, to: ["a@example.com"], attachments: [] });
    expect(e.cc).toBeUndefined();
    expect(e.attachments).toHaveLength(1);
    expect(e.text).not.toContain("starter form");
  });

  it("rejects an empty recipient list", () => {
    expect(() => buildPayrollEmail({ ...base, to: [" "] })).toThrow(/No recipients/);
  });

  it("slugs the PDF filename", () => {
    expect(payrollPdfFilename("1–31 Oct 2026")).toBe("tck-payroll-1-31-oct-2026.pdf");
  });
});
