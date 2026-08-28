import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  db,
  appFeaturesTable,
  appSettingsTable,
  featureGrantsTable,
  riskAssessmentsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireAdmin } from "../middleware/roles";
import {
  SOP_GATE_SETTING_KEY,
  allowedFeatureKeys,
  isSopGateEnforced,
  userTrainedOnSop,
} from "../lib/feature-access";

// Feature grants: admin cherry-picks features per user, optionally gated on
// an SOP training sign-off (global switch, default OFF — see feature-access).

const router: IRouter = Router();

// Any logged-in user: which features can I use right now? (Drives nav/pages.)
router.get("/mine", async (req: Request, res: Response) => {
  if (!req.session.userId) { res.json([]); return; }
  res.json(await allowedFeatureKeys(req.session.userId));
});

// ── Admin management ────────────────────────────────────────────────────────

router.get("/", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const features = await db.select().from(appFeaturesTable);
    const grants = await db.select().from(featureGrantsTable);
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.isActive, true));
    const sops = await db
      .select({ id: riskAssessmentsTable.id, title: riskAssessmentsTable.title })
      .from(riskAssessmentsTable)
      .where(eq(riskAssessmentsTable.assessmentType, "sop"));
    const gateEnforced = await isSopGateEnforced();

    // Per-grant training status, so the UI can show "awaiting training"
    // honestly even while the gate is off (it becomes a preview of what
    // turning the gate on would do).
    const trainingByGrant: Record<number, boolean> = {};
    for (const g of grants) {
      const feature = features.find((f) => f.key === g.featureKey);
      trainingByGrant[g.id] =
        feature?.requiredSopId != null ? await userTrainedOnSop(g.userId, feature.requiredSopId) : true;
    }

    res.json({ features, grants, users, sops, gateEnforced, trainingByGrant });
  } catch (err) {
    console.error("[features] list error:", err);
    res.status(500).json({ error: "Failed to load features" });
  }
});

const gateSchema = z.object({ enforced: z.boolean() });

router.put("/sop-gate", requireAdmin, validate(gateSchema), async (req: Request, res: Response) => {
  const { enforced } = req.body as z.infer<typeof gateSchema>;
  const value = enforced ? "true" : "false";
  const [existing] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, SOP_GATE_SETTING_KEY));
  if (existing) {
    await db.update(appSettingsTable).set({ value }).where(eq(appSettingsTable.key, SOP_GATE_SETTING_KEY));
  } else {
    await db.insert(appSettingsTable).values({ key: SOP_GATE_SETTING_KEY, value });
  }
  res.json({ enforced });
});

const featurePatchSchema = z.object({
  requiredSopId: z.number().int().positive().nullable(),
});

router.patch("/:key", requireAdmin, validate(featurePatchSchema), async (req: Request, res: Response) => {
  const { requiredSopId } = req.body as z.infer<typeof featurePatchSchema>;
  const [row] = await db
    .update(appFeaturesTable)
    .set({ requiredSopId, updatedAt: new Date() })
    .where(eq(appFeaturesTable.key, String(req.params.key)))
    .returning();
  if (!row) { res.status(404).json({ error: "Feature not found" }); return; }
  res.json(row);
});

router.put("/:key/grants/:userId", requireAdmin, async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);
  const featureKey = String(req.params.key);
  const [feature] = await db.select().from(appFeaturesTable).where(eq(appFeaturesTable.key, featureKey));
  if (!feature) { res.status(404).json({ error: "Feature not found" }); return; }
  await db
    .insert(featureGrantsTable)
    .values({ featureKey, userId, grantedBy: req.session.userId ?? null })
    .onConflictDoNothing();
  res.json({ ok: true });
});

router.delete("/:key/grants/:userId", requireAdmin, async (req: Request, res: Response) => {
  await db
    .delete(featureGrantsTable)
    .where(and(eq(featureGrantsTable.featureKey, String(req.params.key)), eq(featureGrantsTable.userId, Number(req.params.userId))));
  res.json({ ok: true });
});

export default router;
