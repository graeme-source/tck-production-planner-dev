/**
 * Staff emergency contacts (Graeme, 2026-10-02): "Have everyone's emergency
 * contact details available so we can access them easily through the front
 * end in an emergency involving one of our team." Staff safety.
 *
 *   GET  /me                 anyone signed in: my own + whether to ask me
 *   PUT  /me                 anyone signed in: save my own
 *   GET  /team               managers/admins: active team members and whether
 *                            each has one on file — names only, no details
 *   POST /team/:userId/view  managers/admins: reveal one person's (LOGGED)
 *   PUT  /team/:userId       managers/admins: correct one person's (LOGGED)
 *   POST /people/:userId/view  People access + private PIN (the People
 *                            record's own gate, unchanged): reveal (LOGGED)
 *
 * Who-sees-whose and the log row live in services/staff-emergency-contacts.ts
 * (tested). A reveal is a POST because it writes the log row; the details
 * are never in a list response, so nothing is shown without being logged.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, usersTable, staffEmergencyContactsTable, staffEmergencyContactViewsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requirePeopleUnlock } from "../middleware/people-unlock";
import { hasPeopleAccess } from "../lib/people-access";
import {
  emergencyContactBody, viewBody, revealContact, saveContact, mayListTeam, isTeamMember, promptNeeded,
  hasUsableContact, shapeContact, NOT_YOURS,
  type EmergencyContactStore, type StoredContact, type Viewer, type EmergencyContactInput, type ViewSource,
} from "../services/staff-emergency-contacts";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
}
router.use(requireAuth);

const CONTACT_COLUMNS = {
  userId: staffEmergencyContactsTable.userId,
  name: staffEmergencyContactsTable.name,
  phone: staffEmergencyContactsTable.phone,
  relationship: staffEmergencyContactsTable.relationship,
  secondName: staffEmergencyContactsTable.secondName,
  secondPhone: staffEmergencyContactsTable.secondPhone,
  secondRelationship: staffEmergencyContactsTable.secondRelationship,
  source: staffEmergencyContactsTable.source,
  updatedByName: staffEmergencyContactsTable.updatedByName,
  updatedAt: staffEmergencyContactsTable.updatedAt,
} as const;

const store: EmergencyContactStore = {
  async person(userId) {
    const [p] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    return p ?? null;
  },
  async contact(userId) {
    const [c] = await db.select(CONTACT_COLUMNS).from(staffEmergencyContactsTable).where(eq(staffEmergencyContactsTable.userId, userId));
    return (c as StoredContact | undefined) ?? null;
  },
  async save(userId, input, by) {
    const values = { ...input, source: by.source, updatedById: by.id, updatedByName: by.name, updatedAt: new Date() };
    const [row] = await db.insert(staffEmergencyContactsTable)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: staffEmergencyContactsTable.userId, set: values })
      .returning(CONTACT_COLUMNS);
    return row as StoredContact;
  },
  async logView(row) {
    await db.insert(staffEmergencyContactViewsTable).values(row);
  },
};

async function viewerOf(req: Request): Promise<Viewer> {
  const [u] = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId!));
  return { id: req.session.userId!, name: u?.name ?? null, role: u?.role ?? null };
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fail(res: Response, where: string, err: unknown) {
  console.error(`[emergency-contacts] ${where} failed:`, err instanceof Error ? err.message : err);
  res.status(500).json({ error: "Couldn't load or save the emergency contact — try again" });
}

// ── My own ────────────────────────────────────────────────────────────────

router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const [[me], contact] = await Promise.all([
      db.select({ id: usersTable.id, isActive: usersTable.isActive, isBookkeeper: usersTable.isBookkeeper })
        .from(usersTable).where(eq(usersTable.id, userId)),
      store.contact(userId),
    ]);
    res.json({
      contact: contact ? shapeContact(contact) : null,
      promptNeeded: me ? promptNeeded(me, contact) : false,
    });
  } catch (err) { fail(res, "get mine", err); }
});

router.put("/me", validate(emergencyContactBody), async (req: Request, res: Response) => {
  try {
    const out = await saveContact(store, await viewerOf(req), req.session.userId!, req.body as EmergencyContactInput, "contacts_page");
    res.status(out.status).json(out.body);
  } catch (err) { fail(res, "save mine", err); }
});

// ── The team (managers + admins) ──────────────────────────────────────────

router.get("/team", async (req: Request, res: Response) => {
  try {
    const viewer = await viewerOf(req);
    if (!mayListTeam(viewer)) { res.status(403).json({ error: NOT_YOURS }); return; }
    const [people, onFile] = await Promise.all([
      db.select({
        id: usersTable.id, name: usersTable.name, avatarUrl: usersTable.avatarUrl, jobTitle: usersTable.jobTitle,
        isActive: usersTable.isActive, isBookkeeper: usersTable.isBookkeeper,
      }).from(usersTable).orderBy(asc(usersTable.name)),
      db.select({
        userId: staffEmergencyContactsTable.userId, name: staffEmergencyContactsTable.name,
        phone: staffEmergencyContactsTable.phone, updatedAt: staffEmergencyContactsTable.updatedAt,
      }).from(staffEmergencyContactsTable),
    ]);
    const byUser = new Map(onFile.map(c => [c.userId, c]));
    res.json({
      people: people.filter(isTeamMember).map(p => {
        const c = byUser.get(p.id);
        return {
          userId: p.id, name: p.name, avatarUrl: p.avatarUrl, jobTitle: p.jobTitle,
          hasContact: hasUsableContact(c), updatedAt: c?.updatedAt ?? null,
        };
      }),
    });
  } catch (err) { fail(res, "team list", err); }
});

router.post("/team/:userId/view", validate(viewBody), async (req: Request, res: Response) => {
  const userId = parseId(req.params["userId"]);
  if (userId == null) { res.status(400).json({ error: "Invalid person" }); return; }
  try {
    const out = await revealContact(store, await viewerOf(req), userId, "team", (req.body as { source: ViewSource }).source);
    res.status(out.status).json(out.body);
  } catch (err) { fail(res, "reveal", err); }
});

// The source rides in the query string — the body is the contact itself.
router.put("/team/:userId", validate(emergencyContactBody), async (req: Request, res: Response) => {
  const userId = parseId(req.params["userId"]);
  if (userId == null) { res.status(400).json({ error: "Invalid person" }); return; }
  const q = req.query["source"];
  const source: ViewSource = q === "station" || q === "people_record" ? q : "contacts_page";
  try {
    const out = await saveContact(store, await viewerOf(req), userId, req.body as EmergencyContactInput, source);
    res.status(out.status).json(out.body);
  } catch (err) { fail(res, "correct", err); }
});

// ── The People record (People access + private PIN, exactly as there) ─────

async function requirePeopleAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Same answer as the People routes: someone without access gets 404.
    if (!(await hasPeopleAccess(req.session.userId))) { res.status(404).json({ error: "Not found" }); return; }
    next();
  } catch (err) { fail(res, "people access", err); }
}

router.post("/people/:userId/view", requirePeopleUnlock, requirePeopleAccess, validate(viewBody), async (req: Request, res: Response) => {
  const userId = parseId(req.params["userId"]);
  if (userId == null) { res.status(400).json({ error: "Invalid person" }); return; }
  try {
    const out = await revealContact(store, await viewerOf(req), userId, "people", "people_record");
    res.status(out.status).json(out.body);
  } catch (err) { fail(res, "people reveal", err); }
});

export default router;
