import { describe, it, expect } from "vitest";
import {
  contractHistory, uploadedContractLabel, uploadedContractDate, fromUploadedParam, contractFileProblem, fmtBytes,
  type IssuedContractRow, type UploadedContractRow,
} from "./contract-history";

const issued = (id: number, issueDate: string, signed = true): IssuedContractRow => ({
  id, jobTitle: "Production Operative", rateOfPay: "£12.21", weeklyHours: "41.25", startDate: "2026-01-05",
  issueDate, issuedAt: `${issueDate}T09:00:00Z`, acknowledgedAt: signed ? `${issueDate}T12:00:00Z` : null, signedInitials: signed ? "JS" : null,
});
const uploaded = (id: number, originalIssueDate: string | null, uploadedAt = "2026-09-25T10:00:00Z", mime = "application/pdf"): UploadedContractRow => ({
  id, userId: 7, fileName: "old.pdf", mime, byteSize: 1000, originalIssueDate, uploadedAt,
});

describe("contractHistory", () => {
  it("merges issued and uploaded contracts, newest first", () => {
    const h = contractHistory([issued(2, "2026-09-01")], [uploaded(5, "2022-02-14"), uploaded(6, null, "2026-09-25T10:00:00Z")]);
    expect(h.map(e => e.key)).toEqual(["uc-6", "ic-2", "uc-5"]);
  });
  it("puts the in-app contract above a paper copy from the same day", () => {
    const h = contractHistory([issued(2, "2023-03-01")], [uploaded(5, "2023-03-01")]);
    expect(h.map(e => e.key)).toEqual(["ic-2", "uc-5"]);
  });
  it("labels uploads plainly as previous contracts, never as signed", () => {
    const h = contractHistory([issued(2, "2026-09-01", false)], [uploaded(5, "2022-02-14")]);
    expect(h.find(e => e.key === "uc-5")!.label).toBe("Previous contract (uploaded PDF)");
    expect(h.find(e => e.key === "ic-2")!.label).toMatch(/awaiting signature/);
  });
});

describe("labels and dates", () => {
  it("says photo for an image upload", () => {
    expect(uploadedContractLabel("image/jpeg")).toBe("Previous contract (uploaded photo)");
  });
  it("dates an upload by the date on it, else when it was filed", () => {
    expect(uploadedContractDate({ originalIssueDate: "2022-02-14", uploadedAt: "2026-09-25T10:00:00Z" })).toBe("2022-02-14");
    expect(uploadedContractDate({ originalIssueDate: null, uploadedAt: "2026-09-25T10:00:00Z" })).toBe("2026-09-25");
  });
  it("formats sizes", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2 KB");
    expect(fmtBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("fromUploadedParam", () => {
  it("reads a positive id", () => {
    expect(fromUploadedParam("?fromUploaded=12")).toBe(12);
  });
  it("ignores anything else", () => {
    expect(fromUploadedParam("")).toBeNull();
    expect(fromUploadedParam("?fromUploaded=abc")).toBeNull();
    expect(fromUploadedParam("?fromUploaded=0")).toBeNull();
    expect(fromUploadedParam("?fromUploaded=-3")).toBeNull();
  });
});

describe("contractFileProblem", () => {
  it("accepts PDFs and photos", () => {
    expect(contractFileProblem({ type: "application/pdf", size: 1_000_000 })).toBeNull();
    expect(contractFileProblem({ type: "image/jpeg", size: 3_000_000 })).toBeNull();
  });
  it("explains a wrong type or a huge file", () => {
    expect(contractFileProblem({ type: "image/heic", size: 1000 })).toMatch(/PDF/);
    expect(contractFileProblem({ type: "application/pdf", size: 20 * 1024 * 1024 })).toMatch(/over 15 MB/);
  });
});
