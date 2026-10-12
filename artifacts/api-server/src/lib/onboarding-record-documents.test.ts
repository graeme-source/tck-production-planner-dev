import { describe, it, expect } from "vitest";
import {
  onboardingRecordDocs, onboardingRecordDocsFor, canSeeOnboardingRecordDoc, onboardingRecordVisibility,
  canStreamOwnOnboardingUpload, fromOnboardingLabel, fmtUkDay, londonYmd, onboardingUploadTitle, starterFormTitle,
  onboardingFormSummaryBody,
} from "./onboarding-record-documents";
import type { PersonDocViewer } from "./person-document-rules";

const SUBJECT = 7;
const HR: PersonDocViewer = { viewerId: 1, hasPeopleAccess: true, isHr: true };
const PEOPLE_MANAGER: PersonDocViewer = { viewerId: 3, hasPeopleAccess: true, isHr: false };
const MANAGER_NO_PEOPLE: PersonDocViewer = { viewerId: 4, hasPeopleAccess: false, isHr: false };
const HR_NO_PEOPLE: PersonDocViewer = { viewerId: 1, hasPeopleAccess: false, isHr: true };
const SIGNED_OUT: PersonDocViewer = { viewerId: null, hasPeopleAccess: true, isHr: true };

const at = (iso: string) => new Date(iso);

// A starter who uploaded nothing but signed all three starter forms and
// filled in the onboarding form — the case Graeme found ("Onboarding form
// only", 0 documents).
const FORMS_ONLY = {
  uploads: [],
  starterForms: [
    { id: 21, formType: "hmrc_starter", signedAt: at("2026-09-11T09:00:00Z"), pdfBytes: 4000 },
    { id: 22, formType: "payroll_details", signedAt: at("2026-09-11T09:05:00Z"), pdfBytes: 4100 },
    { id: 23, formType: "health_questionnaire", signedAt: at("2026-09-11T09:10:00Z"), pdfBytes: null },
  ],
  form: { id: 5, submittedAt: at("2026-09-10T18:00:00Z") },
};

describe("labels", () => {
  it("reads 'P45 — from onboarding, 11 Sept 2026'", () => {
    expect(fromOnboardingLabel("P45", "2026-09-11")).toBe("P45 — from onboarding, 11 Sept 2026");
    expect(fmtUkDay("2026-06-01")).toBe("1 June 2026");
    expect(fmtUkDay("nonsense")).toBe("nonsense");
  });
  it("uses the London day, not UTC", () => {
    // 23:30 UTC on 10 Sept is 00:30 on 11 Sept in London (BST).
    expect(londonYmd(at("2026-09-10T23:30:00Z"))).toBe("2026-09-11");
    expect(londonYmd(at("2026-12-10T23:30:00Z"))).toBe("2026-12-10");
  });
  it("names every upload kind and starter form", () => {
    expect(onboardingUploadTitle("p45")).toBe("P45");
    expect(onboardingUploadTitle("right_to_work")).toBe("Right to work / ID");
    expect(onboardingUploadTitle("food_hygiene")).toBe("Food hygiene certificate");
    expect(onboardingUploadTitle("mystery")).toBe("Document");
    expect(starterFormTitle("hmrc_starter")).toBe("HMRC Starter Checklist");
    expect(starterFormTitle("payroll_details")).toBe("Personnel Payroll Details");
    expect(starterFormTitle("health_questionnaire")).toBe("TCK Health Questionnaire");
  });
});

describe("mapping what they handed in", () => {
  it("maps signed starter forms and the onboarding form for someone who uploaded nothing", () => {
    const docs = onboardingRecordDocs(FORMS_ONLY);
    expect(docs.map(d => d.key)).toEqual(["of-5", "sf-21", "sf-22", "sf-23"]);
    expect(docs.map(d => d.label)).toEqual([
      "Onboarding form — from onboarding, 10 Sept 2026",
      "HMRC Starter Checklist — from onboarding, 11 Sept 2026",
      "Personnel Payroll Details — from onboarding, 11 Sept 2026",
      "TCK Health Questionnaire — from onboarding, 11 Sept 2026",
    ]);
    expect(docs.every(d => d.mime === "application/pdf")).toBe(true);
  });

  it("leaves out unsigned drafts, empty uploads and an unsubmitted form", () => {
    const docs = onboardingRecordDocs({
      uploads: [
        { id: 1, kind: "p45", fileName: "p45.pdf", mime: "application/pdf", byteSize: 10, uploadedAt: at("2026-09-09T10:00:00Z"), hasFile: true },
        { id: 2, kind: "other", fileName: null, mime: null, byteSize: null, uploadedAt: at("2026-09-09T10:00:00Z"), hasFile: false },
      ],
      starterForms: [{ id: 30, formType: "hmrc_starter", signedAt: null, pdfBytes: null }],
      form: { id: 9, submittedAt: null },
    });
    expect(docs.map(d => d.key)).toEqual(["od-1"]);
    expect(docs[0]).toMatchObject({ source: "upload", title: "P45", label: "P45 — from onboarding, 9 Sept 2026", fileName: "p45.pdf", visibility: "hr" });
  });

  it("never puts what's inside a form on the list — title, date, size only", () => {
    for (const d of onboardingRecordDocs(FORMS_ONLY)) {
      expect(Object.keys(d).sort()).toEqual(
        ["at", "byteSize", "date", "fileName", "id", "key", "kind", "label", "mime", "source", "title", "visibility"],
      );
    }
  });
});

describe("who sees them", () => {
  it("starter forms and the P45 are Graeme only; other uploads and the form are People", () => {
    expect(onboardingRecordVisibility("starter_form", "payroll_details")).toBe("hr");
    expect(onboardingRecordVisibility("starter_form", "health_questionnaire")).toBe("hr");
    expect(onboardingRecordVisibility("upload", "p45")).toBe("hr");
    expect(onboardingRecordVisibility("upload", "right_to_work")).toBe("people");
    expect(onboardingRecordVisibility("onboarding_form", "onboarding_form")).toBe("people");
  });

  it("Graeme (People access + HR) sees all four; a People-access manager only the form", () => {
    const docs = onboardingRecordDocs(FORMS_ONLY);
    expect(onboardingRecordDocsFor(HR, docs)).toHaveLength(4);
    expect(onboardingRecordDocsFor(PEOPLE_MANAGER, docs).map(d => d.key)).toEqual(["of-5"]);
  });

  // Regression (memory: "old onboarding file link still leaks P45 to
  // managers"): a manager or admin without People access gets nothing.
  it("a manager without People access sees nothing — not even with HR", () => {
    const docs = onboardingRecordDocs(FORMS_ONLY);
    expect(onboardingRecordDocsFor(MANAGER_NO_PEOPLE, docs)).toEqual([]);
    expect(onboardingRecordDocsFor(HR_NO_PEOPLE, docs)).toEqual([]);
    expect(onboardingRecordDocsFor(SIGNED_OUT, docs)).toEqual([]);
    expect(canSeeOnboardingRecordDoc(MANAGER_NO_PEOPLE, "upload", "right_to_work")).toBe(false);
    expect(canSeeOnboardingRecordDoc(MANAGER_NO_PEOPLE, "upload", "p45")).toBe(false);
    expect(canSeeOnboardingRecordDoc(PEOPLE_MANAGER, "upload", "p45")).toBe(false);
    expect(canSeeOnboardingRecordDoc(PEOPLE_MANAGER, "upload", "food_hygiene")).toBe(true);
    expect(canSeeOnboardingRecordDoc(HR, "upload", "p45")).toBe(true);
  });

  it("the starter's own file link opens only their own upload", () => {
    expect(canStreamOwnOnboardingUpload(SUBJECT, SUBJECT)).toBe(true);
    expect(canStreamOwnOnboardingUpload(3, SUBJECT)).toBe(false);
    expect(canStreamOwnOnboardingUpload(1, SUBJECT)).toBe(false); // not even the founder — People record for that
    expect(canStreamOwnOnboardingUpload(null, SUBJECT)).toBe(false);
    expect(canStreamOwnOnboardingUpload(undefined, SUBJECT)).toBe(false);
  });
});

describe("the onboarding form as a document", () => {
  const input = {
    personName: "Sam Starter",
    submittedAt: at("2026-09-10T18:00:00Z"),
    phone: "07000 000000",
    address: "1 Test Street\nTestville",
    shoeSize: "9",
    footwearChoice: "safety_shoes",
  };
  it("reads like the form, with what else they handed in", () => {
    const docs = onboardingRecordDocsFor(HR, onboardingRecordDocs(FORMS_ONLY));
    const body = onboardingFormSummaryBody({ ...input, alsoHandedIn: docs });
    expect(body).toContain("Filled in: 10 Sept 2026");
    expect(body).toContain("Mobile: 07000 000000");
    expect(body).toContain("Footwear: UK 9 · Safety shoes");
    expect(body).toContain("• Personnel Payroll Details — from onboarding, 11 Sept 2026");
    expect(body).not.toContain("• Onboarding form");
  });
  it("lists only what the viewer may see, and never repeats the emergency contact", () => {
    const docs = onboardingRecordDocsFor(PEOPLE_MANAGER, onboardingRecordDocs(FORMS_ONLY));
    const body = onboardingFormSummaryBody({ ...input, alsoHandedIn: docs });
    expect(body).not.toContain("ALSO HANDED IN");
    expect(body).not.toContain("Payroll");
    expect(body).toContain("Emergency contact panel");
  });
  it("shows a dash for anything blank", () => {
    const body = onboardingFormSummaryBody({ ...input, phone: null, address: "  ", shoeSize: null, footwearChoice: null, alsoHandedIn: [] });
    expect(body).toContain("Mobile: —");
    expect(body).toContain("Home address: —");
    expect(body).toContain("Footwear: —");
  });
});
