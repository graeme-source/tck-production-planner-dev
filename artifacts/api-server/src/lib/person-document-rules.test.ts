import { describe, it, expect } from "vitest";
import {
  defaultVisibility, isPersonDocumentKind, personDocumentAccess, documentsForPeopleViewer, documentsForEmployee,
  shapeForEmployee, visibilityOnCreate, visibilityOnEdit, onboardingDocumentVisibility, canSeeOnboardingDocument,
  personDocumentFileProblem, contentMatchesMime, titleFromFileName, safeDownloadName, PERSON_DOCUMENT_KINDS,
  type PersonDocViewer,
} from "./person-document-rules";

const SUBJECT = 7;
const HR: PersonDocViewer = { viewerId: 1, hasPeopleAccess: true, isHr: true };
const PEOPLE_MANAGER: PersonDocViewer = { viewerId: 3, hasPeopleAccess: true, isHr: false };
const EMPLOYEE: PersonDocViewer = { viewerId: SUBJECT, hasPeopleAccess: false, isHr: false };
const OTHER_EMPLOYEE: PersonDocViewer = { viewerId: 9, hasPeopleAccess: false, isHr: false };

const doc = (over: Partial<{ id: number; userId: number; visibility: string; sharedWithEmployee: boolean; deletedAt: Date | null }> = {}) => ({
  id: 1, userId: SUBJECT, visibility: "people", sharedWithEmployee: false, deletedAt: null, ...over,
});

describe("default visibility per kind", () => {
  it("warnings and disciplinaries start founder-only; everything else People", () => {
    expect(defaultVisibility("warning")).toBe("hr");
    expect(defaultVisibility("disciplinary")).toBe("hr");
    for (const k of PERSON_DOCUMENT_KINDS.filter(k => k !== "warning" && k !== "disciplinary")) {
      expect(defaultVisibility(k)).toBe("people");
    }
  });
  it("knows its kinds", () => {
    expect(isPersonDocumentKind("letter")).toBe(true);
    expect(isPersonDocumentKind("p45")).toBe(false);
    expect(isPersonDocumentKind(undefined)).toBe(false);
  });
});

describe("who sees a document", () => {
  it("HR sees both kinds of visibility", () => {
    expect(personDocumentAccess(HR, doc())).toBe("manage");
    expect(personDocumentAccess(HR, doc({ visibility: "hr" }))).toBe("manage");
  });

  // Regression: People access opens personnel records, NOT founder-only ones.
  it("a People-access user who isn't HR never sees an 'hr' document — by id or in a list", () => {
    expect(personDocumentAccess(PEOPLE_MANAGER, doc({ visibility: "hr" }))).toBe("none");
    const list = [doc({ id: 1 }), doc({ id: 2, visibility: "hr" }), doc({ id: 3, visibility: "hr", sharedWithEmployee: true })];
    expect(documentsForPeopleViewer(PEOPLE_MANAGER, list).map(d => d.id)).toEqual([1]);
    expect(documentsForPeopleViewer(HR, list).map(d => d.id)).toEqual([1, 2, 3]);
  });

  it("a People-access user sees 'people' documents", () => {
    expect(personDocumentAccess(PEOPLE_MANAGER, doc())).toBe("manage");
  });

  it("HR on the list but WITHOUT People access doesn't get the People-side view", () => {
    expect(personDocumentAccess({ viewerId: 1, hasPeopleAccess: false, isHr: true }, doc())).toBe("none");
  });

  // Regression: the employee sees only what's been shared with them.
  it("the employee sees only their own shared documents, read-only", () => {
    expect(personDocumentAccess(EMPLOYEE, doc())).toBe("none");
    expect(personDocumentAccess(EMPLOYEE, doc({ sharedWithEmployee: true }))).toBe("own");
    expect(personDocumentAccess(EMPLOYEE, doc({ visibility: "hr", sharedWithEmployee: true }))).toBe("own");
    const list = [
      doc({ id: 1 }), doc({ id: 2, sharedWithEmployee: true }),
      doc({ id: 3, userId: 9, sharedWithEmployee: true }), doc({ id: 4, sharedWithEmployee: true, deletedAt: new Date() }),
    ];
    expect(documentsForEmployee(SUBJECT, list).map(d => d.id)).toEqual([2]);
    expect(documentsForEmployee(null, list)).toEqual([]);
  });

  // Regression: another employee gets 404 (none), shared or not.
  it("another employee sees nothing of someone else's", () => {
    expect(personDocumentAccess(OTHER_EMPLOYEE, doc())).toBe("none");
    expect(personDocumentAccess(OTHER_EMPLOYEE, doc({ sharedWithEmployee: true }))).toBe("none");
    expect(documentsForPeopleViewer(OTHER_EMPLOYEE, [doc({ sharedWithEmployee: true })])).toEqual([]);
  });

  it("a People-access user reading their OWN record sees their own 'hr' document only if shared", () => {
    const me: PersonDocViewer = { viewerId: SUBJECT, hasPeopleAccess: true, isHr: false };
    expect(personDocumentAccess(me, doc({ visibility: "hr" }))).toBe("none");
    expect(personDocumentAccess(me, doc({ visibility: "hr", sharedWithEmployee: true }))).toBe("own");
  });

  // Regression: removed documents vanish everywhere.
  it("a soft-deleted document vanishes for everybody", () => {
    const gone = doc({ deletedAt: new Date(), sharedWithEmployee: true });
    for (const v of [HR, PEOPLE_MANAGER, EMPLOYEE]) expect(personDocumentAccess(v, gone)).toBe("none");
    expect(documentsForPeopleViewer(HR, [gone])).toEqual([]);
    expect(documentsForEmployee(SUBJECT, [gone])).toEqual([]);
  });

  it("nobody signed in sees nothing, and an unknown visibility is nobody's", () => {
    expect(personDocumentAccess({ viewerId: null, hasPeopleAccess: true, isHr: true }, doc())).toBe("none");
    expect(personDocumentAccess(HR, doc({ visibility: "public" }))).toBe("none");
  });

  it("the employee's shape never carries notes or visibility", () => {
    const shaped = shapeForEmployee({
      id: 1, kind: "letter", title: "T", documentDate: "2026-09-25", fileName: "a.pdf", mime: "application/pdf",
      byteSize: 10, uploadedAt: "2026-09-25T10:00:00Z", notes: "private", visibility: "hr", uploadedByName: "G",
    });
    expect(shaped).not.toHaveProperty("notes");
    expect(shaped).not.toHaveProperty("visibility");
    expect(shaped.title).toBe("T");
  });
});

describe("choosing visibility", () => {
  it("only HR may choose on create; others get the kind's default", () => {
    expect(visibilityOnCreate({ kind: "letter", requested: "hr", viewerIsHr: true })).toBe("hr");
    expect(visibilityOnCreate({ kind: "warning", requested: "people", viewerIsHr: true })).toBe("people");
    expect(visibilityOnCreate({ kind: "warning", requested: "people", viewerIsHr: false })).toBe("hr");
    expect(visibilityOnCreate({ kind: "letter", requested: "hr", viewerIsHr: false })).toBe("people");
    expect(visibilityOnCreate({ kind: "warning", requested: null, viewerIsHr: true })).toBe("hr");
  });

  it("a non-HR edit can't change visibility", () => {
    const r = visibilityOnEdit({ current: "people", currentKind: "letter", newKind: undefined, requested: "hr", viewerIsHr: false });
    expect(r.ok).toBe(false);
    // Sending the same value back is harmless.
    expect(visibilityOnEdit({ current: "people", currentKind: "letter", newKind: undefined, requested: "people", viewerIsHr: false }))
      .toEqual({ ok: true, visibility: "people" });
  });

  it("changing the kind to a warning makes it founder-only; changing away never loosens it", () => {
    expect(visibilityOnEdit({ current: "people", currentKind: "letter", newKind: "warning", requested: undefined, viewerIsHr: false }))
      .toEqual({ ok: true, visibility: "hr" });
    expect(visibilityOnEdit({ current: "hr", currentKind: "warning", newKind: "letter", requested: undefined, viewerIsHr: true }))
      .toEqual({ ok: true, visibility: "hr" });
  });

  it("HR can set it explicitly alongside a kind change", () => {
    expect(visibilityOnEdit({ current: "people", currentKind: "letter", newKind: "warning", requested: "people", viewerIsHr: true }))
      .toEqual({ ok: true, visibility: "people" });
  });
});

describe("onboarding uploads on the record", () => {
  it("the P45 is founder-only; the rest follow People access", () => {
    expect(onboardingDocumentVisibility("p45")).toBe("hr");
    expect(onboardingDocumentVisibility("right_to_work")).toBe("people");
    expect(canSeeOnboardingDocument(PEOPLE_MANAGER, "p45")).toBe(false);
    expect(canSeeOnboardingDocument(PEOPLE_MANAGER, "food_hygiene")).toBe(true);
    expect(canSeeOnboardingDocument(HR, "p45")).toBe(true);
    expect(canSeeOnboardingDocument(OTHER_EMPLOYEE, "food_hygiene")).toBe(false);
  });
});

describe("file checks", () => {
  const bytes = (...xs: Array<number | string>) =>
    new Uint8Array(xs.flatMap(x => (typeof x === "string" ? Array.from(x).map(c => c.charCodeAt(0)) : [x])));
  const PDF = bytes("%PDF-1.7");
  const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
  const PNG = bytes(0x89, "PNG", 0x0d, 0x0a);
  const HEIC = bytes(0, 0, 0, 0x18, "ftypheic");

  it("recognises real PDFs and photos", () => {
    expect(contentMatchesMime("application/pdf", PDF)).toBe(true);
    expect(contentMatchesMime("image/jpeg", JPEG)).toBe(true);
    expect(contentMatchesMime("image/png", PNG)).toBe(true);
    expect(contentMatchesMime("image/heic", HEIC)).toBe(true);
  });

  it("refuses a file that isn't what it claims", () => {
    expect(contentMatchesMime("application/pdf", bytes("<html>"))).toBe(false);
    expect(personDocumentFileProblem({ mime: "application/pdf", bytes: 100, head: bytes("<html>") })).toMatch(/doesn't look like/);
  });

  it("allows PDF/JPEG/PNG/HEIC only, up to 15 MB", () => {
    expect(personDocumentFileProblem({ mime: "application/pdf", bytes: 100, head: PDF })).toBeNull();
    expect(personDocumentFileProblem({ mime: "image/heic", bytes: 100, head: HEIC })).toBeNull();
    expect(personDocumentFileProblem({ mime: "text/html", bytes: 100, head: PDF })).toMatch(/PDFs and photos only/);
    expect(personDocumentFileProblem({ mime: undefined, bytes: 100, head: PDF })).toMatch(/PDFs and photos only/);
    expect(personDocumentFileProblem({ mime: "application/pdf", bytes: 16 * 1024 * 1024, head: PDF })).toMatch(/over 15 MB/);
    expect(personDocumentFileProblem({ mime: "application/pdf", bytes: 0, head: PDF })).toMatch(/empty/);
  });

  it("makes a title from the file name", () => {
    expect(titleFromFileName("Right_to_work-scan.pdf")).toBe("Right to work scan");
    expect(titleFromFileName("IMG_0042.HEIC")).toBe("IMG 0042");
    expect(titleFromFileName(null)).toBe("");
  });

  it("makes a safe download name", () => {
    expect(safeDownloadName('bad"name;.pdf', "application/pdf")).toBe("bad_name_.pdf");
    expect(safeDownloadName(null, "image/jpeg")).toBe("document.jpeg");
  });
});
