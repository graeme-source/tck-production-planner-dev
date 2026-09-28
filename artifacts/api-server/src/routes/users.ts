import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import { validatePassword } from "../lib/password-policy";
import { toSafeUserRow } from "../lib/safe-user-row";
import { checkUserWrite, namesOnlyRow, userListView, type UserActor } from "../lib/user-admin-rules";
import { hasPeopleAccess } from "../lib/people-access";

const router: IRouter = Router();

const SALT_ROUNDS = 10;

function mapRow(r: typeof usersTable.$inferSelect) {
  // No password or PIN hashes — see lib/safe-user-row.ts.
  const safe = toSafeUserRow(r);
  return {
    ...safe,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// The caller, read fresh from the database — a role or email changed a
// moment ago must bite on this request, not whenever the session refreshes.
async function loadActor(req: Request): Promise<UserActor | null> {
  const id = req.session.userId;
  if (!id) return null;
  const [u] = await db.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable).where(eq(usersTable.id, id));
  return u && u.isActive ? { id: u.id, email: u.email, role: u.role } : null;
}

/** Rules 2 + 3 of lib/user-admin-rules.ts. Sends the refusal and returns
 *  false when the write isn't allowed; fails closed on a lookup error. */
async function allowWrite(req: Request, res: Response, targetId: number | null): Promise<boolean> {
  const actor = await loadActor(req);
  if (!actor) { res.status(403).json({ error: "Only admins can add, change or remove accounts." }); return false; }
  // Role first, so a non-admin can't even learn which account ids exist.
  const roleCheck = checkUserWrite({ actor, target: null });
  if (!roleCheck.ok) { res.status(roleCheck.status).json({ error: roleCheck.error }); return false; }
  let target: { id: number; email: string | null; hasPeopleAccess: boolean } | null = null;
  if (targetId != null) {
    const [t] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, targetId));
    if (!t) { res.status(404).json({ error: "Not found" }); return false; }
    target = { ...t, hasPeopleAccess: await hasPeopleAccess(t.id) };
  }
  const check = checkUserWrite({ actor, target });
  if (!check.ok) { res.status(check.status).json({ error: check.error }); return false; }
  return true;
}

// Everyone signed in gets names only (pickers); admins get the full rows.
router.get("/", async (req, res) => {
  const actor = await loadActor(req);
  const rows = await db.select().from(usersTable).orderBy(usersTable.name);
  res.json(actor && userListView(actor) === "full" ? rows.map(mapRow) : rows.map(namesOnlyRow));
});

router.post("/", validate(CreateUserBody), async (req, res) => {
  if (!(await allowWrite(req, res, null))) return;
  const { name, email, password, role, isActive } = req.body;
  const policyError = password ? validatePassword(password) : "Password is required";
  if (!password || policyError) {
    res.status(400).json({ error: policyError ?? "Password is required" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  try {
    const [row] = await db.insert(usersTable).values({
      name,
      email,
      passwordHash,
      role: role ?? "viewer",
      isActive: isActive ?? true,
      // Set by an admin under the new policy — don't flag for forced reset.
      passwordChangedAt: new Date(),
    }).returning();
    res.status(201).json(mapRow(row));
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "A user with that email already exists" });
    } else {
      throw err;
    }
  }
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const actor = await loadActor(req);
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  // Your own account, or an admin looking: the full row. Anyone else: name only.
  const full = !!actor && (actor.id === id || userListView(actor) === "full");
  res.json(full ? mapRow(row) : namesOnlyRow(row));
});

router.put("/:id", validate(UpdateUserBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await allowWrite(req, res, id))) return;
  const { name, email, role, isActive, password, isProductionPlanner } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> & { updatedAt: Date } = {
    name,
    email,
    role,
    isActive,
    updatedAt: new Date(),
  };
  // Production-planner capability flag (manager subtype) — optional so
  // older clients that don't send it leave it untouched.
  if (typeof isProductionPlanner === "boolean") updates.isProductionPlanner = isProductionPlanner;
  if (password) {
    const policyError = validatePassword(password);
    if (policyError) {
      res.status(400).json({ error: policyError });
      return;
    }
    updates.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    updates.passwordChangedAt = new Date();
    updates.passwordResetDeadline = null;
  }
  try {
    const [row] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(mapRow(row));
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "A user with that email already exists" });
    } else {
      throw err;
    }
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!(await allowWrite(req, res, id))) return;
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

export default router;
