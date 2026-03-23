import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

const SALT_ROUNDS = 10;

function mapRow(r: typeof usersTable.$inferSelect) {
  const { passwordHash: _ph, ...safe } = r;
  return {
    ...safe,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(usersTable).orderBy(usersTable.name);
  res.json(rows.map(mapRow));
});

router.post("/", validate(CreateUserBody), async (req, res) => {
  const { name, email, password, role, isActive } = req.body;
  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
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
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapRow(row));
});

router.put("/:id", validate(UpdateUserBody), async (req, res) => {
  const id = Number(req.params.id);
  const { name, email, role, isActive, password } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> & { updatedAt: Date } = {
    name,
    email,
    role,
    isActive,
    updatedAt: new Date(),
  };
  if (password) {
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    updates.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
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
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

export default router;
