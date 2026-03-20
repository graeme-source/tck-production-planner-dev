import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";

const router: IRouter = Router();

// GET /app-settings — returns all app settings as key-value record
router.get("/", async (_req, res) => {
  const rows = await db.select().from(appSettingsTable);
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  res.json(result);
});

// GET /app-settings/:key — get a single setting value
router.get("/:key", async (req, res) => {
  const { key } = req.params;
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  if (!row) {
    res.status(404).json({ error: `Setting '${key}' not found` });
    return;
  }
  res.json({ key: row.key, value: row.value });
});

// PUT /app-settings/:key — upsert a setting value (admin only enforced in router)
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
