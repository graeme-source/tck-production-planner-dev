/**
 * Contacts directory (Graeme, 2026-10-02). Objective D (the APC
 * customer-service number on the packing bench) and safety (emergency
 * contacts on the stations that need them).
 *
 *   GET    /             everyone signed in: contacts + suppliers' details
 *   POST   /             managers/admins: add
 *   PATCH  /:id          managers/admins: edit
 *   DELETE /:id          managers/admins: soft delete (restorable)
 *   POST   /:id/restore  managers/admins: undo a delete
 *
 * Suppliers' phone numbers and emails are NOT copied into contacts: they
 * are read from the suppliers table here, read-only, and edited on the
 * supplier's own record — one place for each fact.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db, contactsTable, suppliersTable } from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
}
router.use(requireAuth);

async function myName(req: Request): Promise<string | null> {
  const r = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId}`);
  return r.rows[0]?.name ?? null;
}

const CATEGORIES = ["emergency", "carrier", "service", "supplier", "other"] as const;

// Blank strings from a form mean "no value".
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform(v => (v ? v : null));

const contactBody = z.object({
  name: z.string().trim().min(1, "A name is needed").max(120),
  organisation: optionalText(120),
  role: optionalText(200),
  phone: optionalText(40),
  email: z.string().trim().max(200).nullable().optional()
    .refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "That email address doesn't look right")
    .transform(v => (v ? v : null)),
  notes: optionalText(1000),
  category: z.enum(CATEGORIES),
  stationKeys: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  pinned: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});
const contactPatch = contactBody.partial();

function serialise(c: typeof contactsTable.$inferSelect) {
  return {
    id: c.id, name: c.name, organisation: c.organisation, role: c.role, phone: c.phone, email: c.email,
    notes: c.notes, category: c.category, stationKeys: c.stationKeys ?? [], pinned: c.pinned,
    useFor: c.useFor, sortOrder: c.sortOrder,
    updatedByName: c.updatedByName ?? c.createdByName, updatedAt: c.updatedAt,
  };
}

router.get("/", async (_req: Request, res: Response) => {
  const contacts = await db.select().from(contactsTable)
    .where(isNull(contactsTable.deletedAt))
    .orderBy(asc(contactsTable.sortOrder), asc(contactsTable.name));
  const suppliers = await db.select({
    id: suppliersTable.id, name: suppliersTable.name, contactName: suppliersTable.contactName,
    phone: suppliersTable.phone, orderingPhone: suppliersTable.orderingPhone,
    email: suppliersTable.email, website: suppliersTable.website,
  }).from(suppliersTable).orderBy(asc(suppliersTable.name));
  res.json({
    contacts: contacts.map(serialise),
    // Only suppliers with a way to reach them — an empty card is noise.
    suppliers: suppliers.filter(s => s.phone || s.orderingPhone || s.email),
  });
});

router.post("/", requireManagerOrAdmin, validate(contactBody), async (req: Request, res: Response) => {
  const body = contactBody.parse(req.body);
  const name = await myName(req);
  const [row] = await db.insert(contactsTable).values({
    ...body,
    createdById: req.session.userId, createdByName: name,
    updatedById: req.session.userId, updatedByName: name,
  }).returning();
  res.json(serialise(row));
});

router.patch("/:id", requireManagerOrAdmin, validate(contactPatch), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid contact" }); return; }
  const body = contactPatch.parse(req.body);
  const [row] = await db.update(contactsTable).set({
    ...body,
    updatedById: req.session.userId, updatedByName: await myName(req), updatedAt: new Date(),
  }).where(and(eq(contactsTable.id, id), isNull(contactsTable.deletedAt))).returning();
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  res.json(serialise(row));
});

router.delete("/:id", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid contact" }); return; }
  const [row] = await db.update(contactsTable).set({
    deletedAt: new Date(), deletedById: req.session.userId, deletedByName: await myName(req),
  }).where(and(eq(contactsTable.id, id), isNull(contactsTable.deletedAt))).returning({ id: contactsTable.id });
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  res.json({ ok: true });
});

router.post("/:id/restore", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid contact" }); return; }
  try {
    const [row] = await db.update(contactsTable).set({ deletedAt: null, deletedById: null, deletedByName: null })
      .where(eq(contactsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
    res.json(serialise(row));
  } catch (err) {
    // The one way this fails: another live contact has since taken its
    // use_for key (unique while live).
    console.warn("[contacts] restore failed:", err instanceof Error ? err.message : err);
    res.status(409).json({ error: "Couldn't restore — another contact now does this job." });
  }
});

export default router;
