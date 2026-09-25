/**
 * Who is on each building table for a plan — the raw facts behind the
 * dashboard's "Which building table?" chooser and the optional building
 * station lock (feature_building_station_lock).
 *
 * Fri 25 Sep 2026: the chooser said "Started by Tommy" and "Started by Grant"
 * because it only knew who had first OPENED each table screen. Kerri-Leigh
 * and Nozomi did the building. So this returns both facts per table:
 *  - lastBatch: whoever recorded the most recent building batch on it
 *    (batch_completions.station_type), excluding admin corrections;
 *  - claim: whoever last opened it (app_settings station_assignment_*), and
 *    when (the row's updated_at).
 * The client decides what to say from them (production-planner
 * lib/building-table-status.ts) — the batch recorder wins.
 *
 * Its own file: the charter forbids growing routes/production-plans.ts.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, appSettingsTable, batchCompletionsTable, productionPlanItemsTable, usersTable } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

const router: IRouter = Router();

const TABLES = ["building_1", "building_2"] as const;
type TableKey = (typeof TABLES)[number];

const ParamsSchema = z.object({ planId: z.coerce.number().int().positive() });
const ClaimValue = z.object({ userId: z.number().int(), userName: z.string() });

type Person = { userId: number; userName: string };
type TableFacts = {
  claim: (Person & { openedAt: string }) | null;
  lastBatch: (Person & { completedAt: string }) | null;
};

/** The most recent real (non-correction) building batch on one table. */
async function lastBatchOn(planId: number, station: TableKey): Promise<TableFacts["lastBatch"]> {
  const [row] = await db.select({
    userId: batchCompletionsTable.userId,
    userName: usersTable.name,
    completedAt: batchCompletionsTable.completedAt,
  })
    .from(batchCompletionsTable)
    .innerJoin(productionPlanItemsTable, eq(productionPlanItemsTable.id, batchCompletionsTable.planItemId))
    .leftJoin(usersTable, eq(usersTable.id, batchCompletionsTable.userId))
    .where(and(
      eq(productionPlanItemsTable.planId, planId),
      eq(batchCompletionsTable.stationType, station),
      isNotNull(batchCompletionsTable.userId),
      isNull(batchCompletionsTable.correctionByUserId),
    ))
    .orderBy(desc(batchCompletionsTable.completedAt))
    .limit(1);
  if (!row || row.userId == null) return null;
  return { userId: row.userId, userName: row.userName ?? "Someone", completedAt: row.completedAt.toISOString() };
}

/** Whoever last opened the table screen, from its app_settings claim row. */
async function claimsFor(planId: number): Promise<Record<TableKey, TableFacts["claim"]>> {
  const keyFor = (t: TableKey) => `station_assignment_${planId}_${t}`;
  const rows = await db.select({ key: appSettingsTable.key, value: appSettingsTable.value, updatedAt: appSettingsTable.updatedAt })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, TABLES.map(keyFor)));
  const out = { building_1: null, building_2: null } as Record<TableKey, TableFacts["claim"]>;
  for (const t of TABLES) {
    const row = rows.find(r => r.key === keyFor(t));
    if (!row) continue;
    try {
      const v = ClaimValue.safeParse(JSON.parse(row.value));
      if (v.success) out[t] = { ...v.data, openedAt: row.updatedAt.toISOString() };
    } catch { /* unreadable claim → treated as none */ }
  }
  return out;
}

router.get("/:planId", async (req, res) => {
  const parsed = ParamsSchema.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const { planId } = parsed.data;

  try {
    const [claims, batch1, batch2] = await Promise.all([
      claimsFor(planId),
      lastBatchOn(planId, "building_1"),
      lastBatchOn(planId, "building_2"),
    ]);
    const tables: Record<TableKey, TableFacts> = {
      building_1: { claim: claims.building_1, lastBatch: batch1 },
      building_2: { claim: claims.building_2, lastBatch: batch2 },
    };
    res.json({ tables });
  } catch (err) {
    console.error("[building-tables] failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load building tables" });
  }
});

export default router;
