import { Router, type IRouter } from "express";
import {
  db,
  temperatureRecordsTable,
  usersTable,
  locationTemperatureRecordsTable,
  storageLocationsTable,
} from "@workspace/db";
import { eq, desc, and, gte, lte, isNotNull } from "drizzle-orm";
import * as z from "zod";
import { londonEndOfDay, londonStartOfDay } from "../lib/london-time";

const router: IRouter = Router();

const insertSchema = z.object({
  planId: z.number().int(),
  planName: z.string().optional(),
  recipeId: z.number().int().optional(),
  recipeName: z.string().optional(),
  ingredientId: z.number().int().optional(),
  ingredientName: z.string().optional(),
  trayIndex: z.number().int().min(0),
  temperatureC: z.number().min(-50).max(500),
  recordType: z.string().default("cooked_core"),
});

router.post("/", async (req, res) => {
  const userId = req.session?.userId ?? null;
  let userName: string | null = null;
  if (userId) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    userName = u?.name ?? null;
  }

  const parsed = insertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }

  const d = parsed.data;
  const [record] = await db.insert(temperatureRecordsTable).values({
    planId: d.planId,
    planName: d.planName ?? null,
    recipeId: d.recipeId ?? null,
    recipeName: d.recipeName ?? null,
    ingredientId: d.ingredientId ?? null,
    ingredientName: d.ingredientName ?? null,
    trayIndex: d.trayIndex,
    temperatureC: String(d.temperatureC),
    recordType: d.recordType,
    userId,
    userName,
  }).returning();

  res.json(record);
});

// Edit an existing temperature record (operators correcting a wrong reading
// or a wrong timestamp from the cooking summary table in mix-prep).
const editSchema = z.object({
  temperatureC: z.number().min(-50).max(500).optional(),
  recordedAt: z.string().datetime().optional(),
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid data", issues: parsed.error.issues });
    return;
  }
  const updates: { temperatureC?: string; recordedAt?: Date } = {};
  if (parsed.data.temperatureC !== undefined) updates.temperatureC = String(parsed.data.temperatureC);
  if (parsed.data.recordedAt) updates.recordedAt = new Date(parsed.data.recordedAt);
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No changes supplied" });
    return;
  }
  const [updated] = await db.update(temperatureRecordsTable)
    .set(updates)
    .where(eq(temperatureRecordsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Temperature record not found" });
    return;
  }
  res.json(updated);
});

// Unified shape returned by GET /. Combines:
//   - cooked-core readings from temperature_records (one row per reading)
//   - opening/closing fridge & freezer readings from location_temperature_records
//     (split into one row per opening/closing so they filter cleanly by time)
// recordType values:
//   cooked_core         → recipe cooking-temp check (existing data)
//   fridge_opening      → fridge opening check
//   fridge_closing      → fridge closing check
//   freezer_opening     → freezer opening check
//   freezer_closing     → freezer closing check
// `category` is "cooked" | "fridge" | "freezer" — the coarse filter used by the UI.
interface UnifiedTempRecord {
  id: string;
  category: "cooked" | "fridge" | "freezer";
  recordType: string;
  recordedAt: string;
  temperatureC: string;
  userName: string | null;
  userId: number | null;
  planId: number;
  planName: string | null;
  recipeId: number | null;
  recipeName: string | null;
  ingredientId: number | null;
  ingredientName: string | null;
  trayIndex: number | null;
  locationName: string | null;
}

router.get("/", async (req, res) => {
  const { from, to, planId, category } = req.query;
  const categoryStr = typeof category === "string" ? category : "all";
  const wantsCooked = categoryStr === "all" || categoryStr === "cooked";
  const wantsFridge = categoryStr === "all" || categoryStr === "fridge";
  const wantsFreezer = categoryStr === "all" || categoryStr === "freezer";

  // Use London-time day boundaries on BOTH ends. Naively parsing
  // `new Date("2026-05-18")` returns UTC midnight, which is 01:00 BST in
  // London — so any record made between 23:00 BST and midnight London
  // (i.e. 22:00–23:00 UTC) would fall outside both that day's filter and
  // the next day's, silently vanishing from the report.
  const fromDate = from ? londonStartOfDay(new Date(`${String(from)}T12:00:00Z`)) : null;
  const toDate = to ? londonEndOfDay(new Date(`${String(to)}T12:00:00Z`)) : null;

  const results: UnifiedTempRecord[] = [];

  if (wantsCooked) {
    const conditions = [];
    if (planId) conditions.push(eq(temperatureRecordsTable.planId, Number(planId)));
    if (fromDate) conditions.push(gte(temperatureRecordsTable.recordedAt, fromDate));
    if (toDate) conditions.push(lte(temperatureRecordsTable.recordedAt, toDate));

    const rows = await db
      .select()
      .from(temperatureRecordsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(temperatureRecordsTable.recordedAt))
      .limit(500);

    for (const r of rows) {
      results.push({
        id: `t-${r.id}`,
        category: "cooked",
        recordType: r.recordType,
        recordedAt: r.recordedAt.toISOString(),
        temperatureC: r.temperatureC,
        userName: r.userName,
        userId: r.userId,
        planId: r.planId,
        planName: r.planName,
        recipeId: r.recipeId,
        recipeName: r.recipeName,
        ingredientId: r.ingredientId,
        ingredientName: r.ingredientName,
        trayIndex: r.trayIndex,
        locationName: null,
      });
    }
  }

  if (wantsFridge || wantsFreezer) {
    const zoneFilter: ("fridge" | "freezer")[] = [];
    if (wantsFridge) zoneFilter.push("fridge");
    if (wantsFreezer) zoneFilter.push("freezer");

    const baseConds = [];
    if (planId) baseConds.push(eq(locationTemperatureRecordsTable.planId, Number(planId)));

    // Opening rows
    const openingConds = [...baseConds, isNotNull(locationTemperatureRecordsTable.openingTemperatureC)];
    if (fromDate) openingConds.push(gte(locationTemperatureRecordsTable.openingRecordedAt, fromDate));
    if (toDate) openingConds.push(lte(locationTemperatureRecordsTable.openingRecordedAt, toDate));
    const openingRows = await db
      .select({
        id: locationTemperatureRecordsTable.id,
        planId: locationTemperatureRecordsTable.planId,
        temperatureC: locationTemperatureRecordsTable.openingTemperatureC,
        recordedAt: locationTemperatureRecordsTable.openingRecordedAt,
        userId: locationTemperatureRecordsTable.openingUserId,
        locationName: storageLocationsTable.name,
        zone: storageLocationsTable.zone,
        userName: usersTable.name,
      })
      .from(locationTemperatureRecordsTable)
      .innerJoin(storageLocationsTable, eq(locationTemperatureRecordsTable.storageLocationId, storageLocationsTable.id))
      .leftJoin(usersTable, eq(locationTemperatureRecordsTable.openingUserId, usersTable.id))
      .where(and(...openingConds))
      .orderBy(desc(locationTemperatureRecordsTable.openingRecordedAt))
      .limit(500);

    for (const r of openingRows) {
      if (!zoneFilter.includes(r.zone as "fridge" | "freezer")) continue;
      if (!r.recordedAt || r.temperatureC == null) continue;
      results.push({
        id: `lo-${r.id}`,
        category: r.zone === "freezer" ? "freezer" : "fridge",
        recordType: r.zone === "freezer" ? "freezer_opening" : "fridge_opening",
        recordedAt: r.recordedAt.toISOString(),
        temperatureC: r.temperatureC,
        userName: r.userName,
        userId: r.userId,
        planId: r.planId,
        planName: null,
        recipeId: null,
        recipeName: null,
        ingredientId: null,
        ingredientName: null,
        trayIndex: null,
        locationName: r.locationName,
      });
    }

    // Closing rows
    const closingConds = [...baseConds, isNotNull(locationTemperatureRecordsTable.closingTemperatureC)];
    if (fromDate) closingConds.push(gte(locationTemperatureRecordsTable.closingRecordedAt, fromDate));
    if (toDate) closingConds.push(lte(locationTemperatureRecordsTable.closingRecordedAt, toDate));
    const closingRows = await db
      .select({
        id: locationTemperatureRecordsTable.id,
        planId: locationTemperatureRecordsTable.planId,
        temperatureC: locationTemperatureRecordsTable.closingTemperatureC,
        recordedAt: locationTemperatureRecordsTable.closingRecordedAt,
        userId: locationTemperatureRecordsTable.closingUserId,
        locationName: storageLocationsTable.name,
        zone: storageLocationsTable.zone,
        userName: usersTable.name,
      })
      .from(locationTemperatureRecordsTable)
      .innerJoin(storageLocationsTable, eq(locationTemperatureRecordsTable.storageLocationId, storageLocationsTable.id))
      .leftJoin(usersTable, eq(locationTemperatureRecordsTable.closingUserId, usersTable.id))
      .where(and(...closingConds))
      .orderBy(desc(locationTemperatureRecordsTable.closingRecordedAt))
      .limit(500);

    for (const r of closingRows) {
      if (!zoneFilter.includes(r.zone as "fridge" | "freezer")) continue;
      if (!r.recordedAt || r.temperatureC == null) continue;
      results.push({
        id: `lc-${r.id}`,
        category: r.zone === "freezer" ? "freezer" : "fridge",
        recordType: r.zone === "freezer" ? "freezer_closing" : "fridge_closing",
        recordedAt: r.recordedAt.toISOString(),
        temperatureC: r.temperatureC,
        userName: r.userName,
        userId: r.userId,
        planId: r.planId,
        planName: null,
        recipeId: null,
        recipeName: null,
        ingredientId: null,
        ingredientName: null,
        trayIndex: null,
        locationName: r.locationName,
      });
    }
  }

  results.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  res.json(results);
});

export default router;
