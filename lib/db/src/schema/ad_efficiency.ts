/**
 * Advertising-efficiency targets (migration 0168, Graeme 2026-10-11).
 * Objective I.
 *
 * One row (id = 1): the targets and thresholds behind the Numbers page's
 * At a Glance ROAS cards and their "What to do" line. Percentages are whole
 * percents (210 = 210%). Read and written by routes/ad-efficiency.ts; the
 * maths is artifacts/production-planner/src/lib/ad-efficiency.ts.
 */
import { pgTable, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const adEfficiencySettingsTable = pgTable("ad_efficiency_settings", {
  id: integer("id").primaryKey().default(1),
  ncRoas7dTargetPct: numeric("nc_roas_7d_target_pct", { precision: 7, scale: 1 }).notNull().default("210"),
  ncRoasMtdTargetPct: numeric("nc_roas_mtd_target_pct", { precision: 7, scale: 1 }).notNull().default("210"),
  totalRoas30dTargetPct: numeric("total_roas_30d_target_pct", { precision: 7, scale: 1 }).notNull().default("700"),
  amberWidthPct: numeric("amber_width_pct", { precision: 5, scale: 1 }).notNull().default("10"),
  holdBandPct: numeric("hold_band_pct", { precision: 5, scale: 1 }).notNull().default("10"),
  raiseSpendMinPct: numeric("raise_spend_min_pct", { precision: 5, scale: 1 }).notNull().default("10"),
  raiseSpendMaxPct: numeric("raise_spend_max_pct", { precision: 5, scale: 1 }).notNull().default("20"),
  smallSampleSpend: numeric("small_sample_spend", { precision: 10, scale: 2 }).notNull().default("350"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
