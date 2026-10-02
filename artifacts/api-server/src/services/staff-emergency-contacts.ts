/**
 * Staff emergency contacts — the rules (Graeme, 2026-10-02). Staff safety.
 *
 * Who sees what:
 *   • everyone: their OWN contact, to read and update, any time;
 *   • managers and admins: everyone's, from Contacts or a station's
 *     Contacts pop-up — tap to reveal, and every reveal is logged;
 *   • People access (the founder's per-person grant + private PIN): the
 *     contact on that person's People record, also logged;
 *   • anyone else asking for someone else's: 403.
 * Managers and admins may correct someone's (logged as an edit).
 *
 * Pure: the route hands in the database calls (EmergencyContactStore), so
 * the access decisions and "every view writes a log row" are tested
 * without a database (staff-emergency-contacts.test.ts).
 */
import { z } from "zod";

export type Role = "admin" | "manager" | "viewer";
export type ViewSource = "contacts_page" | "station" | "people_record";
export const VIEW_SOURCES = ["contacts_page", "station", "people_record"] as const;

// ── Phone numbers ──────────────────────────────────────────────────────────

/**
 * A phone number someone could actually dial in an emergency: digits with
 * optional spaces, dashes, brackets and a leading +; 10–11 digits for a UK
 * number (07… / 01… / 02…), or an international one starting + / 00 with
 * 8–15 digits. Returns the tidied number (single spaces, trimmed) or a
 * plain-English reason it can't be used.
 */
export function checkPhone(raw: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  const value = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "A phone number is needed" };
  if (!/^\+?[\d\s()-]+$/.test(value)) return { ok: false, error: "A phone number can only have digits, spaces and a + at the start" };
  const digits = value.replace(/\D/g, "");
  const international = value.startsWith("+") || digits.startsWith("00");
  if (international) {
    if (digits.length < 8 || digits.length > 15) return { ok: false, error: "That number looks too short or too long" };
    return { ok: true, value };
  }
  if (!digits.startsWith("0")) return { ok: false, error: "Start a UK number with 0 (e.g. 07…), or give the country code with +" };
  if (digits.length < 10 || digits.length > 11) return { ok: false, error: "A UK number has 10 or 11 digits" };
  return { ok: true, value };
}

const phoneField = z.string().max(40).transform((v, ctx) => {
  const r = checkPhone(v);
  if (!r.ok) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error }); return z.NEVER; }
  return r.value;
});
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform(v => (v ? v : null));

/** What a save sends — the person's own, or a manager's correction. */
export const emergencyContactBody = z.object({
  name: z.string().trim().min(1, "Their name is needed").max(120),
  phone: phoneField,
  relationship: z.string().trim().min(1, "Say who they are to you (e.g. Mum, partner)").max(60),
  secondName: optionalText(120),
  secondPhone: z.string().max(40).nullable().optional(),
  secondRelationship: optionalText(60),
}).transform((b, ctx) => {
  // The second contact is optional, but half of one is no use: a name
  // needs a number and a number needs a name.
  const secondPhoneRaw = (b.secondPhone ?? "").trim();
  if (!b.secondName && !secondPhoneRaw) {
    return { ...b, secondName: null, secondPhone: null, secondRelationship: null };
  }
  if (!b.secondName) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["secondName"], message: "Add the second person's name, or clear their number" }); return z.NEVER; }
  const p = checkPhone(secondPhoneRaw);
  if (!p.ok) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["secondPhone"], message: `Second contact: ${p.error.toLowerCase()}` }); return z.NEVER; }
  return { ...b, secondPhone: p.value };
});
export type EmergencyContactInput = z.output<typeof emergencyContactBody>;

export const viewBody = z.object({ source: z.enum(VIEW_SOURCES) });

/** The first validation message, in plain English, for the client. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Please check the details";
}

// ── Who sees whose ─────────────────────────────────────────────────────────

export interface Viewer { id: number; role: Role | string | null; name: string | null }

export function isManagerOrAdmin(role: string | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

/** May this viewer list the team (names + who has one on file, no details)? */
export function mayListTeam(viewer: Pick<Viewer, "role">): boolean {
  return isManagerOrAdmin(viewer.role);
}

/**
 * May this viewer read the subject's contact, and by which right?
 *  "own"      — it's theirs (never logged: you're not reading anyone else's)
 *  "manager"  — a manager/admin reading a colleague's (logged)
 *  "people"   — through the People record, which has already checked People
 *               access + the private PIN (logged)
 *  null       — no (403)
 */
export function viewRight(
  viewer: Pick<Viewer, "id" | "role">,
  subjectUserId: number,
  via: "team" | "people",
): "own" | "manager" | "people" | null {
  if (viewer.id === subjectUserId) return "own";
  if (via === "people") return "people";
  return isManagerOrAdmin(viewer.role) ? "manager" : null;
}

/** May this viewer change the subject's contact? Their own, or anyone's for
 *  managers/admins (to correct it). */
export function mayEdit(viewer: Pick<Viewer, "id" | "role">, subjectUserId: number): boolean {
  return viewer.id === subjectUserId || isManagerOrAdmin(viewer.role);
}

// ── Who is "the team", and who gets asked ──────────────────────────────────

export interface PersonFacts {
  id: number;
  isActive: boolean;
  /** The external bookkeeper's account — not part of the team on the floor. */
  isBookkeeper: boolean;
}

/** Active colleagues — the people whose emergency contacts we need. */
export function isTeamMember(p: PersonFacts): boolean {
  return p.isActive && !p.isBookkeeper;
}

export interface ContactFacts { name: string | null; phone: string | null }

/** A contact we could actually use: a name and a number. */
export function hasUsableContact(c: ContactFacts | null | undefined): boolean {
  return !!c && !!c.name?.trim() && !!c.phone?.trim();
}

/**
 * Should this person be asked for their emergency contact? Only team
 * members, only when nothing usable is on file. (Where and when the card
 * shows is the client's job — see the app's emergency-contact-prompt.)
 */
export function promptNeeded(person: PersonFacts, contact: ContactFacts | null | undefined): boolean {
  return isTeamMember(person) && !hasUsableContact(contact);
}

// ── The service: decisions + the log row, with the database injected ──────

export interface StoredContact {
  userId: number;
  name: string;
  phone: string;
  relationship: string | null;
  secondName: string | null;
  secondPhone: string | null;
  secondRelationship: string | null;
  source: string;
  updatedByName: string | null;
  updatedAt: Date | string;
}

export interface ViewLogRow {
  viewerId: number;
  viewerName: string | null;
  subjectUserId: number;
  subjectName: string | null;
  action: "view" | "edit";
  source: ViewSource;
}

export interface EmergencyContactStore {
  person(userId: number): Promise<{ id: number; name: string } | null>;
  contact(userId: number): Promise<StoredContact | null>;
  save(userId: number, input: EmergencyContactInput, by: { id: number; name: string | null; source: "self" | "manager" }): Promise<StoredContact>;
  logView(row: ViewLogRow): Promise<void>;
}

export type Outcome<T> = { status: 200; body: T } | { status: 403 | 404; body: { error: string } };

export const NOT_YOURS = "Only managers and admins can see a colleague's emergency contact.";

export function shapeContact(c: StoredContact) {
  return {
    name: c.name, phone: c.phone, relationship: c.relationship,
    secondName: c.secondName, secondPhone: c.secondPhone, secondRelationship: c.secondRelationship,
    source: c.source, updatedByName: c.updatedByName,
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
  };
}
export type ContactBody = ReturnType<typeof shapeContact>;

/**
 * Reveal one person's contact. A colleague's read is logged BEFORE the
 * details are returned — if the log can't be written, nothing is shown.
 */
export async function revealContact(
  store: EmergencyContactStore,
  viewer: Viewer,
  subjectUserId: number,
  via: "team" | "people",
  source: ViewSource,
): Promise<Outcome<{ person: { id: number; name: string }; contact: ContactBody | null }>> {
  const right = viewRight(viewer, subjectUserId, via);
  if (!right) return { status: 403, body: { error: NOT_YOURS } };
  const person = await store.person(subjectUserId);
  if (!person) return { status: 404, body: { error: "Not found" } };
  if (right !== "own") {
    await store.logView({
      viewerId: viewer.id, viewerName: viewer.name, subjectUserId, subjectName: person.name, action: "view", source,
    });
  }
  const contact = await store.contact(subjectUserId);
  return { status: 200, body: { person, contact: contact ? shapeContact(contact) : null } };
}

/** Save someone's contact: their own, or a manager's correction (logged). */
export async function saveContact(
  store: EmergencyContactStore,
  viewer: Viewer,
  subjectUserId: number,
  input: EmergencyContactInput,
  source: ViewSource,
): Promise<Outcome<{ contact: ContactBody }>> {
  if (!mayEdit(viewer, subjectUserId)) return { status: 403, body: { error: NOT_YOURS } };
  const person = await store.person(subjectUserId);
  if (!person) return { status: 404, body: { error: "Not found" } };
  const own = viewer.id === subjectUserId;
  if (!own) {
    await store.logView({
      viewerId: viewer.id, viewerName: viewer.name, subjectUserId, subjectName: person.name, action: "edit", source,
    });
  }
  const saved = await store.save(subjectUserId, input, { id: viewer.id, name: viewer.name, source: own ? "self" : "manager" });
  return { status: 200, body: { contact: shapeContact(saved) } };
}
