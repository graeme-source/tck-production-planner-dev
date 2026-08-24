// Stock gate — status, config, and manual hold/release.
// The heavy lifting lives in lib/stock-gating.ts; these routes are thin.

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, usersTable, stockGateHoldsTable } from "@workspace/db";
import { eq, isNull, and, sql } from "drizzle-orm";
import {
  getStockGateStatus,
  getStockGateSettings,
  setStockGateSettings,
  runStockGateCycle,
  releaseHold,
} from "../lib/stock-gating";

const router: IRouter = Router();

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
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

// GET /api/stock-gating/status — settings, active holds, recent history, last run.
router.get("/status", async (_req, res) => {
  res.json(await getStockGateStatus());
});

// PUT /api/stock-gating/config — body: partial settings, all values as strings
// (matches app_settings storage; booleans "true"/"false").
router.put("/config", requireAdmin, async (req, res) => {
  const allowed = ["enabled", "dryRun", "thresholdPacks", "releasePacks", "autoRelease", "tag", "intervalMinutes", "zapietLocationId", "excludedRecipeIds"] as const;
  const patch: Partial<Record<(typeof allowed)[number], string>> = {};
  for (const field of allowed) {
    const v = req.body?.[field];
    if (typeof v === "string") patch[field] = v;
    if (typeof v === "boolean") patch[field] = v ? "true" : "false";
    if (typeof v === "number" && Number.isFinite(v)) patch[field] = String(v);
  }
  await setStockGateSettings(patch);
  res.json({ settings: await getStockGateSettings() });
});

// GET /api/stock-gating/scope — the recipes the gate CAN cover (core menu /
// fridge-held) with each one's current excluded flag, for the Settings
// tick-list. Frozen lines stay excluded until their stock recording is
// trustworthy; re-including one is a tick, not a deploy.
router.get("/scope", requireAdmin, async (_req, res) => {
  const { getStockGateSettings } = await import("../lib/stock-gating");
  const settings = await getStockGateSettings();
  const excluded = new Set(settings.excludedRecipeIds);
  const rows = await db.execute<{ id: number; name: string; is_core_menu: boolean; is_fridge_product: boolean }>(sql`
    SELECT id, name, is_core_menu, is_fridge_product
    FROM recipes
    WHERE is_core_menu = TRUE OR is_fridge_product = TRUE
    ORDER BY name ASC
  `);
  res.json(rows.rows.map(r => ({
    recipeId: Number(r.id),
    name: r.name,
    excluded: excluded.has(Number(r.id)),
  })));
});

// POST /api/stock-gating/run — force a check cycle now (admin button).
router.post("/run", requireAdmin, async (_req, res) => {
  const result = await runStockGateCycle("manual");
  res.json(result);
});

// POST /api/stock-gating/release/:holdId — manual release of one hold.
router.post("/release/:holdId", requireAdmin, async (req, res) => {
  const holdId = Number(req.params.holdId);
  if (!Number.isInteger(holdId)) {
    res.status(400).json({ error: "holdId must be an integer" });
    return;
  }
  const [hold] = await db.select().from(stockGateHoldsTable)
    .where(and(eq(stockGateHoldsTable.id, holdId), isNull(stockGateHoldsTable.releasedAt)));
  if (!hold) {
    res.status(404).json({ error: "No live hold with that id" });
    return;
  }
  const [releaser] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId!));
  const releasedBy = releaser?.name ?? `user ${req.session.userId}`;
  try {
    await releaseHold(hold, releasedBy, null);
  } catch (err) {
    res.status(502).json({ error: `Shopify tag removal failed: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  res.json({ ok: true });
});

export default router;
