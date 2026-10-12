import { describe, it, expect } from "vitest";
import {
  defaultVisibility, kindLabel, onboardingKindLabel, documentEntries, documentFileProblem, mimeForFile,
  titleFromFileName, isFiledFounderOnly, onboardingDocLabel, onboardingDocPath, PERSON_DOCUMENT_KINDS,
  type PersonDocumentRow, type OnboardingDocumentRow,
} from "./person-documents";

const filed = (id: number, documentDate: string, uploadedAt = `${documentDate}T09:00:00Z`): PersonDocumentRow => ({
  id, userId: 7, kind: "letter", title: `Doc ${id}`, documentDate, notes: null, fileName: null, mime: "application/pdf",
  byteSize: 10, visibility: "people", sharedWithEmployee: false, uploadedByName: "Graeme", uploadedAt, updatedAt: uploadedAt,
});
const onboarding = (id: number, uploadedAt: string): OnboardingDocumentRow => ({
  id, kind: "p45", fileName: "p45.pdf", mime: "application/pdf", byteSize: 10, uploadedAt, uploadedByName: "Sam", visibility: "hr",
});

describe("labels and defaults", () => {
  it("every kind has a label; warnings/disciplinaries default to Graeme only", () => {
    for (const k of PERSON_DOCUMENT_KINDS) expect(kindLabel(k)).not.toBe("Document");
    expect(defaultVisibility("warning")).toBe("hr");
    expect(defaultVisibility("disciplinary")).toBe("hr");
    expect(defaultVisibility("certificate")).toBe("people");
    expect(onboardingKindLabel("p45")).toBe("P45");
    expect(kindLabel("mystery")).toBe("Document");
  });
});

describe("one list, newest first", () => {
  it("merges filed documents and onboarding uploads by date", () => {
    const list = documentEntries(
      [filed(1, "2026-01-10"), filed(2, "2026-09-01")],
      [onboarding(5, "2025-06-03T12:00:00Z")],
    );
    expect(list.map(e => e.key)).toEqual(["pd-2", "pd-1", "od-5"]);
  });

  it("same day: the later upload first", () => {
    const list = documentEntries([filed(1, "2026-09-01", "2026-09-01T08:00:00Z"), filed(2, "2026-09-01", "2026-09-01T15:00:00Z")], []);
    expect(list.map(e => e.key)).toEqual(["pd-2", "pd-1"]);
  });

  it("places starter forms and the onboarding form by the day they were handed in", () => {
    const signed: OnboardingDocumentRow = {
      key: "sf-21", source: "starter_form", id: 21, kind: "payroll_details", title: "Personnel Payroll Details",
      label: "Personnel Payroll Details — from onboarding, 11 Sept 2026", date: "2026-09-11",
      fileName: null, mime: "application/pdf", byteSize: null, uploadedAt: "2026-09-10T23:30:00Z", uploadedByName: "Sam", visibility: "hr",
    };
    const list = documentEntries([filed(1, "2026-09-10")], [signed]);
    expect(list.map(e => [e.key, e.date])).toEqual([["sf-21", "2026-09-11"], ["pd-1", "2026-09-10"]]);
  });
});

describe("documents handed in at onboarding", () => {
  const row = (over: Partial<OnboardingDocumentRow>): OnboardingDocumentRow => ({
    id: 4, kind: "p45", fileName: null, mime: "application/pdf", byteSize: null, uploadedAt: "2026-09-11T09:00:00Z",
    uploadedByName: "Sam", visibility: "hr", ...over,
  });
  it("uses the server's label, else a plain one", () => {
    expect(onboardingDocLabel(row({ label: "P45 — from onboarding, 11 Sept 2026" }))).toBe("P45 — from onboarding, 11 Sept 2026");
    expect(onboardingDocLabel(row({}))).toBe("P45 — from onboarding");
  });
  it("opens every source through the gated People routes, never /api/onboarding", () => {
    expect(onboardingDocPath(row({}), 7)).toBe("/api/person-documents/onboarding/4/file");
    expect(onboardingDocPath(row({ source: "upload" }), 7, true)).toBe("/api/person-documents/onboarding/4/file?download=1");
    expect(onboardingDocPath(row({ source: "starter_form", id: 21 }), 7)).toBe("/api/person-documents/starter-forms/21/file");
    expect(onboardingDocPath(row({ source: "onboarding_form", id: 5 }), 7)).toBe("/api/person-documents/person/7/onboarding-form");
    for (const source of ["upload", "starter_form", "onboarding_form"] as const) {
      expect(onboardingDocPath(row({ source }), 7).startsWith("/api/person-documents/")).toBe(true);
    }
  });
});

describe("file checks", () => {
  it("accepts PDF / JPEG / PNG / HEIC up to 15 MB", () => {
    expect(documentFileProblem({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(documentFileProblem({ type: "image/heic", size: 1000 })).toBeNull();
    expect(documentFileProblem({ type: "", size: 1000, name: "IMG_1.HEIC" })).toBeNull();
    expect(documentFileProblem({ type: "text/html", size: 1000 })).toMatch(/PDF/);
    expect(documentFileProblem({ type: "application/pdf", size: 16 * 1024 * 1024 })).toMatch(/15 MB/);
    expect(documentFileProblem({ type: "application/pdf", size: 0 })).toMatch(/empty/);
  });

  it("works out a missing type from the name", () => {
    expect(mimeForFile({ type: "", name: "scan.heif" })).toBe("image/heif");
    expect(mimeForFile({ type: "image/png", name: "x.heic" })).toBe("image/png");
    expect(mimeForFile({ type: "", name: "notes.txt" })).toBe("");
  });

  it("prefills the title from the file name", () => {
    expect(titleFromFileName("Food_hygiene-level2.pdf")).toBe("Food hygiene level2");
  });

  it("spots a save that went founder-only", () => {
    expect(isFiledFounderOnly({ id: 3, filedFounderOnly: true })).toBe(true);
    expect(isFiledFounderOnly(filed(1, "2026-01-01"))).toBe(false);
  });
});
