import { describe, it, expect } from "vitest";
import {
  defaultVisibility, kindLabel, onboardingKindLabel, documentEntries, documentFileProblem, mimeForFile,
  titleFromFileName, isFiledFounderOnly, PERSON_DOCUMENT_KINDS, type PersonDocumentRow, type OnboardingDocumentRow,
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
