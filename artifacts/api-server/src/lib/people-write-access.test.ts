import { describe, expect, it } from "vitest";
import {
  canWriteEmploymentRecord, employmentRecordRight, isOwnRecord, mayWriteEmploymentRecord, recordWriteView,
  EMPLOYMENT_RECORD_WRITE_REFUSAL, OWN_RECORD_READ_ONLY_NOTE, SELF_SERVICE_KINDS,
  type RecordActor, type RecordSubject,
} from "./people-write-access";
import { FOUNDER_EMAIL } from "./founder-email";

// The cast, as live on 2026-10-12: the founder (admin, People access), Lorna
// (manager, People access), an admin and a manager without the grant, and an
// ordinary colleague. Ids are made up — the rule never looks at them except
// to tell "own record" apart.
const founder: RecordActor = { id: 2, email: FOUNDER_EMAIL, plandayEmployeeId: 100, hasPeopleAccess: true };
const lorna: RecordActor = { id: 6, email: "lorna@example.co.uk", plandayEmployeeId: 106, hasPeopleAccess: true };
const admin: RecordActor = { id: 24, email: "admin@example.co.uk", plandayEmployeeId: null, hasPeopleAccess: false };
const manager: RecordActor = { id: 30, email: "manager@example.co.uk", plandayEmployeeId: 130, hasPeopleAccess: false };
const colleague: RecordActor = { id: 40, email: "sam@example.co.uk", plandayEmployeeId: 140, hasPeopleAccess: false };

const recordOf = (a: RecordActor): RecordSubject => ({ id: a.id, email: a.email, plandayEmployeeId: a.plandayEmployeeId });

describe("canWriteEmploymentRecord — Graeme's rule (2026-10-12)", () => {
  it("the founder can change anyone's record, his own included", () => {
    for (const subject of [founder, lorna, admin, manager, colleague].map(recordOf)) {
      expect(canWriteEmploymentRecord(founder, subject)).toBe(true);
    }
  });

  it("the founder is the founder by account even without a People grant", () => {
    expect(canWriteEmploymentRecord({ ...founder, hasPeopleAccess: false }, recordOf(colleague))).toBe(true);
  });

  it("Lorna (People access) can change other people's records", () => {
    for (const subject of [founder, admin, manager, colleague].map(recordOf)) {
      expect(canWriteEmploymentRecord(lorna, subject)).toBe(true);
    }
  });

  it("Lorna can NOT change her own record", () => {
    expect(canWriteEmploymentRecord(lorna, recordOf(lorna))).toBe(false);
  });

  it("an admin without the grant can change nobody's — not even their own", () => {
    for (const subject of [founder, lorna, admin, manager, colleague].map(recordOf)) {
      expect(canWriteEmploymentRecord(admin, subject)).toBe(false);
    }
  });

  it("a manager without the grant can change nobody's", () => {
    for (const subject of [founder, lorna, admin, manager, colleague].map(recordOf)) {
      expect(canWriteEmploymentRecord(manager, subject)).toBe(false);
    }
  });

  it("a colleague can't change their own record (outside the self-service writes)", () => {
    expect(canWriteEmploymentRecord(colleague, recordOf(colleague))).toBe(false);
  });

  it("a look-alike founder address is not the founder (exact match only)", () => {
    const fake = { ...admin, email: FOUNDER_EMAIL.toUpperCase() };
    expect(canWriteEmploymentRecord(fake, recordOf(colleague))).toBe(false);
  });
});

describe("isOwnRecord — a second account is still you", () => {
  it("same account id", () => {
    expect(isOwnRecord(lorna, recordOf(lorna))).toBe(true);
  });
  it("same email on another account (case and spaces ignored)", () => {
    expect(isOwnRecord(lorna, { id: 99, email: "  LORNA@example.co.uk ", plandayEmployeeId: null })).toBe(true);
  });
  it("same Planday employee on another account", () => {
    expect(isOwnRecord(lorna, { id: 99, email: "other@example.co.uk", plandayEmployeeId: 106 })).toBe(true);
  });
  it("blank emails and missing Planday links never match each other", () => {
    expect(isOwnRecord({ id: 1, email: "", plandayEmployeeId: null }, { id: 2, email: "", plandayEmployeeId: null })).toBe(false);
    expect(isOwnRecord({ id: 1, email: null }, { id: 2, email: null })).toBe(false);
  });
  it("Lorna can't edit her own record through a second account", () => {
    expect(canWriteEmploymentRecord(lorna, { id: 99, email: "lorna@example.co.uk", plandayEmployeeId: null })).toBe(false);
  });
});

describe("self-service — the employee's own writes, on their own record only", () => {
  it("lists exactly the self-service kinds Graeme is asked to confirm", () => {
    expect([...SELF_SERVICE_KINDS].sort()).toEqual([
      "own_emergency_contact", "own_letter_acknowledge", "own_onboarding_form", "own_rtw_form", "own_starter_forms",
      "sign_own_contract",
    ]);
  });

  it("a colleague may do a self-service write on their own record, as 'self'", () => {
    for (const kind of SELF_SERVICE_KINDS) {
      expect(mayWriteEmploymentRecord(colleague, recordOf(colleague), kind)).toEqual({ ok: true, right: "self" });
    }
  });

  it("Lorna on her own record is 'self' too — the employee's powers, not the manager's", () => {
    expect(employmentRecordRight(lorna, recordOf(lorna))).toBe("self");
    expect(mayWriteEmploymentRecord(lorna, recordOf(lorna), "own_rtw_form")).toEqual({ ok: true, right: "self" });
    expect(mayWriteEmploymentRecord(lorna, recordOf(lorna))).toEqual({ ok: false });
  });

  it("nobody can use a self-service route on someone else's record", () => {
    for (const actor of [admin, manager, colleague]) {
      for (const kind of SELF_SERVICE_KINDS) {
        expect(mayWriteEmploymentRecord(actor, recordOf(founder), kind)).toEqual({ ok: false });
      }
    }
  });

  it("an editor stays an editor on a self-service route", () => {
    expect(mayWriteEmploymentRecord(founder, recordOf(founder), "own_rtw_form")).toEqual({ ok: true, right: "editor" });
    expect(mayWriteEmploymentRecord(lorna, recordOf(colleague), "own_rtw_form")).toEqual({ ok: true, right: "editor" });
  });
});

describe("recordWriteView — what the record screen shows", () => {
  it("Lorna on her own record: read-only, with the note", () => {
    expect(recordWriteView(lorna, recordOf(lorna))).toEqual({ canWrite: false, readOnlyNote: OWN_RECORD_READ_ONLY_NOTE });
  });
  it("Lorna on someone else's: writable", () => {
    expect(recordWriteView(lorna, recordOf(colleague))).toEqual({ canWrite: true, readOnlyNote: null });
  });
  it("an admin without the grant: read-only, with the refusal", () => {
    expect(recordWriteView(admin, recordOf(colleague))).toEqual({ canWrite: false, readOnlyNote: EMPLOYMENT_RECORD_WRITE_REFUSAL });
  });
  it("the refusal says who can, in plain words", () => {
    expect(EMPLOYMENT_RECORD_WRITE_REFUSAL).toBe("Only Graeme and Lorna can change employment records — and not their own.");
  });
});
