import { describe, it, expect } from "vitest";
import {
  checkPhone, emergencyContactBody, viewBody, viewRight, mayEdit, mayListTeam, isTeamMember, promptNeeded,
  revealContact, saveContact, NOT_YOURS,
  type EmergencyContactStore, type StoredContact, type ViewLogRow, type EmergencyContactInput,
} from "./staff-emergency-contacts";

// Made-up people only.
const STAFF = { id: 10, role: "viewer", name: "Sam Test" };
const OTHER_STAFF = 11;
const MANAGER = { id: 20, role: "manager", name: "Morgan Test" };
const ADMIN = { id: 30, role: "admin", name: "Alex Test" };

function fakeStore(seed: Record<number, StoredContact | null> = {}) {
  const contacts = new Map<number, StoredContact | null>(Object.entries(seed).map(([k, v]) => [Number(k), v]));
  const log: ViewLogRow[] = [];
  const saves: Array<{ userId: number; source: string }> = [];
  const store: EmergencyContactStore = {
    async person(id) { return [10, 11, 20, 30].includes(id) ? { id, name: `Person ${id}` } : null; },
    async contact(id) { return contacts.get(id) ?? null; },
    async save(userId, input, by) {
      const row: StoredContact = { userId, ...input, source: by.source, updatedByName: by.name, updatedAt: new Date("2026-10-02T09:00:00Z") };
      contacts.set(userId, row);
      saves.push({ userId, source: by.source });
      return row;
    },
    async logView(row) { log.push(row); },
  };
  return { store, log, saves };
}
const ON_FILE: StoredContact = {
  userId: OTHER_STAFF, name: "Pat Example", phone: "07700 900123", relationship: "Partner",
  secondName: null, secondPhone: null, secondRelationship: null,
  source: "self", updatedByName: "Person 11", updatedAt: "2026-09-01T10:00:00.000Z",
};
const INPUT: EmergencyContactInput = {
  name: "Jo Example", phone: "07700 900456", relationship: "Mum",
  secondName: null, secondPhone: null, secondRelationship: null,
};

describe("checkPhone", () => {
  it("accepts UK mobiles and landlines, tidying spaces", () => {
    expect(checkPhone(" 07700  900123 ")).toEqual({ ok: true, value: "07700 900123" });
    expect(checkPhone("01908 915940")).toEqual({ ok: true, value: "01908 915940" });
    expect(checkPhone("(01908) 915-940").ok).toBe(true);
  });
  it("accepts international numbers with + or 00", () => {
    expect(checkPhone("+44 7700 900123").ok).toBe(true);
    expect(checkPhone("+48 600 700 800").ok).toBe(true);
    expect(checkPhone("0048600700800").ok).toBe(true);
  });
  it("refuses blanks, letters, and numbers with the wrong length", () => {
    expect(checkPhone("")).toEqual({ ok: false, error: "A phone number is needed" });
    expect(checkPhone("call mum").ok).toBe(false);
    expect(checkPhone("0770090").ok).toBe(false);
    expect(checkPhone("077009001234").ok).toBe(false);
    expect(checkPhone("7700900123").ok).toBe(false); // no leading 0 or +
  });
});

describe("emergencyContactBody", () => {
  it("needs name, a real phone number and the relationship", () => {
    expect(emergencyContactBody.safeParse({ name: "Jo", phone: "07700 900456", relationship: "Mum" }).success).toBe(true);
    expect(emergencyContactBody.safeParse({ name: "", phone: "07700 900456", relationship: "Mum" }).success).toBe(false);
    expect(emergencyContactBody.safeParse({ name: "Jo", phone: "12", relationship: "Mum" }).success).toBe(false);
    expect(emergencyContactBody.safeParse({ name: "Jo", phone: "07700 900456", relationship: " " }).success).toBe(false);
  });
  it("second contact is optional, but never half of one", () => {
    const blank = emergencyContactBody.parse({ name: "Jo", phone: "07700 900456", relationship: "Mum", secondName: "", secondPhone: "" });
    expect(blank.secondName).toBeNull();
    expect(blank.secondPhone).toBeNull();
    expect(emergencyContactBody.safeParse({ name: "Jo", phone: "07700 900456", relationship: "Mum", secondName: "Chris" }).success).toBe(false);
    expect(emergencyContactBody.safeParse({ name: "Jo", phone: "07700 900456", relationship: "Mum", secondPhone: "07700 900789" }).success).toBe(false);
    const both = emergencyContactBody.parse({ name: "Jo", phone: "07700 900456", relationship: "Mum", secondName: "Chris", secondPhone: "07700  900789" });
    expect(both.secondPhone).toBe("07700 900789");
  });
  it("view source must be one we know", () => {
    expect(viewBody.safeParse({ source: "station" }).success).toBe(true);
    expect(viewBody.safeParse({ source: "anywhere" }).success).toBe(false);
  });
});

describe("who sees whose", () => {
  it("everyone sees their own; only managers/admins see a colleague's from the team list", () => {
    expect(viewRight(STAFF, STAFF.id, "team")).toBe("own");
    expect(viewRight(STAFF, OTHER_STAFF, "team")).toBeNull();
    expect(viewRight(MANAGER, OTHER_STAFF, "team")).toBe("manager");
    expect(viewRight(ADMIN, OTHER_STAFF, "team")).toBe("manager");
  });
  it("the People record route has already checked People access, so it is its own right", () => {
    expect(viewRight(STAFF, OTHER_STAFF, "people")).toBe("people");
  });
  it("only managers/admins list the team or correct a colleague's", () => {
    expect(mayListTeam(STAFF)).toBe(false);
    expect(mayListTeam(MANAGER)).toBe(true);
    expect(mayEdit(STAFF, STAFF.id)).toBe(true);
    expect(mayEdit(STAFF, OTHER_STAFF)).toBe(false);
    expect(mayEdit(ADMIN, OTHER_STAFF)).toBe(true);
  });
});

describe("revealContact", () => {
  it("staff asking for someone else's get 403 — and nothing is read or logged", async () => {
    const { store, log } = fakeStore({ [OTHER_STAFF]: ON_FILE });
    const out = await revealContact(store, STAFF, OTHER_STAFF, "team", "contacts_page");
    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: NOT_YOURS });
    expect(log).toHaveLength(0);
  });
  it("every manager view writes a log row (who, whose, where), even when nothing is on file", async () => {
    const { store, log } = fakeStore({ [OTHER_STAFF]: ON_FILE });
    const first = await revealContact(store, MANAGER, OTHER_STAFF, "team", "station");
    expect(first.status).toBe(200);
    if (first.status === 200) expect(first.body.contact?.phone).toBe("07700 900123");
    await revealContact(store, MANAGER, OTHER_STAFF, "team", "contacts_page");
    await revealContact(store, ADMIN, STAFF.id, "team", "contacts_page"); // none on file
    expect(log).toEqual([
      { viewerId: 20, viewerName: "Morgan Test", subjectUserId: 11, subjectName: "Person 11", action: "view", source: "station" },
      { viewerId: 20, viewerName: "Morgan Test", subjectUserId: 11, subjectName: "Person 11", action: "view", source: "contacts_page" },
      { viewerId: 30, viewerName: "Alex Test", subjectUserId: 10, subjectName: "Person 10", action: "view", source: "contacts_page" },
    ]);
  });
  it("People-record reads are logged too", async () => {
    const { store, log } = fakeStore({ [OTHER_STAFF]: ON_FILE });
    await revealContact(store, STAFF, OTHER_STAFF, "people", "people_record");
    expect(log.map(l => l.source)).toEqual(["people_record"]);
  });
  it("reading your own isn't logged", async () => {
    const { store, log } = fakeStore({ [STAFF.id]: { ...ON_FILE, userId: STAFF.id } });
    const out = await revealContact(store, STAFF, STAFF.id, "team", "contacts_page");
    expect(out.status).toBe(200);
    expect(log).toHaveLength(0);
  });
  it("a missing log write means nothing is shown", async () => {
    const { store } = fakeStore({ [OTHER_STAFF]: ON_FILE });
    store.logView = async () => { throw new Error("db down"); };
    await expect(revealContact(store, MANAGER, OTHER_STAFF, "team", "contacts_page")).rejects.toThrow("db down");
  });
  it("unknown person → 404", async () => {
    const { store } = fakeStore();
    expect((await revealContact(store, MANAGER, 999, "team", "contacts_page")).status).toBe(404);
  });
});

describe("saveContact", () => {
  it("staff can save their own, not a colleague's", async () => {
    const { store, saves, log } = fakeStore();
    expect((await saveContact(store, STAFF, STAFF.id, INPUT, "contacts_page")).status).toBe(200);
    expect((await saveContact(store, STAFF, OTHER_STAFF, INPUT, "contacts_page")).status).toBe(403);
    expect(saves).toEqual([{ userId: STAFF.id, source: "self" }]);
    expect(log).toHaveLength(0);
  });
  it("a manager's correction is saved as 'manager' and logged as an edit", async () => {
    const { store, saves, log } = fakeStore({ [OTHER_STAFF]: ON_FILE });
    const out = await saveContact(store, MANAGER, OTHER_STAFF, INPUT, "station");
    expect(out.status).toBe(200);
    expect(saves).toEqual([{ userId: OTHER_STAFF, source: "manager" }]);
    expect(log).toEqual([{ viewerId: 20, viewerName: "Morgan Test", subjectUserId: 11, subjectName: "Person 11", action: "edit", source: "station" }]);
  });
});

describe("who is asked", () => {
  const person = { id: 1, isActive: true, isBookkeeper: false };
  it("asks active team members with nothing usable on file", () => {
    expect(promptNeeded(person, null)).toBe(true);
    expect(promptNeeded(person, { name: "Jo", phone: "" })).toBe(true);
    expect(promptNeeded(person, { name: " ", phone: "07700 900456" })).toBe(true);
  });
  it("doesn't ask once one is on file", () => {
    expect(promptNeeded(person, { name: "Jo", phone: "07700 900456" })).toBe(false);
  });
  it("doesn't ask inactive accounts or the external bookkeeper", () => {
    expect(promptNeeded({ ...person, isActive: false }, null)).toBe(false);
    expect(promptNeeded({ ...person, isBookkeeper: true }, null)).toBe(false);
    expect(isTeamMember({ ...person, isBookkeeper: true })).toBe(false);
  });
});
