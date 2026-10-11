/**
 * Advertising-efficiency targets — the settings behind the Numbers page's
 * At a Glance ROAS cards (Graeme, 2026-10-11). Objective I.
 *
 *   GET   /api/ad-efficiency/settings   the targets and thresholds, + may-I-edit
 *   PATCH /api/ad-efficiency/settings   change one or more (founder only)
 *
 * The cards' DATA is not here: they read the Numbers trend series by the
 * day (GET /api/founder-numbers/trend), so new-customer revenue, total
 * sales and ad spend are exactly the figures the Order Analysis tiles and
 * graphs use — one definition, no second calculation. The maths is
 * production-planner src/lib/ad-efficiency.ts (pure, tested).
 *
 * Reading: the founder or a Business Numbers grantee (founder.numbers), the
 * same gate as the rest of Numbers. Changing: the founder alone, whatever
 * the screen shows (requireFounder, 403 for anyone else). One row, seeded
 * by migration 0168; its column defaults are the only place the starting
 * targets are written down.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireFounder } from "../middleware/founder-access";
import { requireFounderArea } from "../middleware/founder-area-access";
import { validate } from "../middleware/validate";
import { isFounderEmail } from "../lib/founder-email";

const router: IRouter = Router();
router.use(requireFounderArea("founder.numbers"));

/** API field → column. The only fields that can be changed. */
export const SETTING_COLUMNS = {
  ncRoas7dTargetPct: "nc_roas_7d_target_pct",
  ncRoasMtdTargetPct: "nc_roas_mtd_target_pct",
  totalRoas30dTargetPct: "total_roas_30d_target_pct",
  amberWidthPct: "amber_width_pct",
  holdBandPct: "hold_band_pct",
  raiseSpendMinPct: "raise_spend_min_pct",
  raiseSpendMaxPct: "raise_spend_max_pct",
  smallSampleSpend: "small_sample_spend",
} as const;

export type SettingField = keyof typeof SETTING_COLUMNS;
type Settings = Record<SettingField, number>;

const targetPct = z.number().positive().max(10_000);
const bandPct = z.number().min(0).max(50);
const raisePct = z.number().positive().max(200);

/** Every field optional — the editor autosaves one field at a time. Limits
 *  match the table's CHECKs so a bad value is a 400, never a 500. */
export const SettingsPatch = z.object({
  ncRoas7dTargetPct: targetPct.optional(),
  ncRoasMtdTargetPct: targetPct.optional(),
  totalRoas30dTargetPct: targetPct.optional(),
  amberWidthPct: bandPct.optional(),
  holdBandPct: bandPct.optional(),
  raiseSpendMinPct: raisePct.optional(),
  raiseSpendMaxPct: raisePct.optional(),
  smallSampleSpend: z.number().min(0).max(1_000_000).optional(),
}).refine(p => Object.values(p).some(v => v !== undefined), { message: "Nothing to change" });

/** The merged settings must still make sense together. Pure, so tested. */
export function settingsProblem(s: Settings): string | null {
  if (s.raiseSpendMinPct > s.raiseSpendMaxPct) {
    return `The smallest suggested raise (${s.raiseSpendMinPct}%) can't be bigger than the largest (${s.raiseSpendMaxPct}%).`;
  }
  return null;
}

type Row = {
  nc_roas_7d_target_pct: string; nc_roas_mtd_target_pct: string; total_roas_30d_target_pct: string;
  amber_width_pct: string; hold_band_pct: string; raise_spend_min_pct: string; raise_spend_max_pct: string;
  small_sample_spend: string; updated_by_name: string | null; updated_at: string;
};

async function loadRow(): Promise<Row> {
  const read = () => db.execute<Row>(sql`SELECT *, updated_at::text AS updated_at FROM ad_efficiency_settings WHERE id = 1`);
  let rows = await read();
  if (!rows.rows[0]) {
    // The migration seeds it; a fresh copy of the row with the table's own
    // defaults covers a database where someone deleted it.
    await db.execute(sql`INSERT INTO ad_efficiency_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    rows = await read();
  }
  return rows.rows[0]!;
}

function toSettings(row: Row): Settings {
  const out = {} as Settings;
  for (const [field, column] of Object.entries(SETTING_COLUMNS) as Array<[SettingField, keyof Row]>) {
    out[field] = Number(row[column]);
  }
  return out;
}

async function payload(userId: number) {
  const row = await loadRow();
  const me = await db.execute<{ email: string | null }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  return {
    settings: toSettings(row),
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
    canEdit: isFounderEmail(me.rows[0]?.email),
  };
}

router.get("/settings", async (req: Request, res: Response) => {
  try {
    res.json(await payload(req.session.userId!));
  } catch (err) {
    console.error("[ad-efficiency] read failed:", err);
    res.status(500).json({ error: "Couldn't load the ROAS targets" });
  }
});

router.patch("/settings", requireFounder, validate(SettingsPatch), async (req: Request, res: Response) => {
  const patch = req.body as z.infer<typeof SettingsPatch>;
  try {
    await loadRow(); // make sure the row exists before locking it
    const me = await db.execute<{ name: string | null }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId!} LIMIT 1`);
    // Read-check-write under a row lock: two fields autosaving at once
    // must not overwrite each other with stale values.
    const problem = await db.transaction(async (tx) => {
      const locked = await tx.execute<Row>(sql`SELECT *, updated_at::text AS updated_at FROM ad_efficiency_settings WHERE id = 1 FOR UPDATE`);
      const next: Settings = { ...toSettings(locked.rows[0]!) };
      for (const field of Object.keys(SETTING_COLUMNS) as SettingField[]) {
        const v = patch[field];
        if (typeof v === "number") next[field] = v;
      }
      const why = settingsProblem(next);
      if (why) return why;
      await tx.execute(sql`
        UPDATE ad_efficiency_settings SET
          nc_roas_7d_target_pct = ${next.ncRoas7dTargetPct},
          nc_roas_mtd_target_pct = ${next.ncRoasMtdTargetPct},
          total_roas_30d_target_pct = ${next.totalRoas30dTargetPct},
          amber_width_pct = ${next.amberWidthPct},
          hold_band_pct = ${next.holdBandPct},
          raise_spend_min_pct = ${next.raiseSpendMinPct},
          raise_spend_max_pct = ${next.raiseSpendMaxPct},
          small_sample_spend = ${next.smallSampleSpend},
          updated_by_id = ${req.session.userId!},
          updated_by_name = ${me.rows[0]?.name ?? null},
          updated_at = NOW()
        WHERE id = 1
      `);
      return null;
    });
    if (problem) { res.status(400).json({ error: problem }); return; }
    res.json(await payload(req.session.userId!));
  } catch (err) {
    console.error("[ad-efficiency] save failed:", err);
    res.status(500).json({ error: "Couldn't save the ROAS targets — nothing was changed." });
  }
});

export default router;
