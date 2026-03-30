import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, appSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";

const router: IRouter = Router();

const STATION_KEY_PREFIXES = ["mozz_load_confirmed_", "checklist_done_"];

async function requireAuthForWrite(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET") { next(); return; }
  const key = req.params.key ?? "";
  const isStationKey = STATION_KEY_PREFIXES.some(p => key.startsWith(p));
  if (isStationKey && req.session.userId) { next(); return; }
  if (req.session.userRole === "admin") { next(); return; }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin") { next(); return; }
    }
  }
  res.status(403).json({ error: "Admin access required" });
}

router.use(requireAuthForWrite);

router.get("/", async (_req, res) => {
  const rows = await db.select().from(appSettingsTable);
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  res.json(result);
});

router.get("/:key", async (req, res) => {
  const { key } = req.params;
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  if (!row) {
    res.status(404).json({ error: `Setting '${key}' not found` });
    return;
  }
  res.json({ key: row.key, value: row.value });
});

const PutBody = z.object({ value: z.string() });

router.put("/:key", async (req, res) => {
  const parsed = PutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "value (string) is required" });
    return;
  }
  const { key } = req.params;
  const { value } = parsed.data;

  const [row] = await db
    .insert(appSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: new Date() },
    })
    .returning();

  res.json({ key: row.key, value: row.value });
});

export default router;
