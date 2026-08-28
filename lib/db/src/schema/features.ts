import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { riskAssessmentsTable } from "./risk_assessments";

// Per-user feature grants ("cherry-pick" access), optionally gated on a
// training-SOP sign-off. Access = granted AND (gate off, no SOP required,
// or the user is signed off on the feature's SOP in any training matrix).
// The gate is a global switch in app_settings: feature_sop_gate_enforced
// ("true"/"false", absent = off) — Graeme's call, 2026-08-28: ship with the
// gate OFF so grants work immediately, turn it on when the SOP library is
// ready to enforce.

export const appFeaturesTable = pgTable("app_features", {
  key: text("key").primaryKey(), // e.g. 'apc_label_printing'
  name: text("name").notNull(),
  description: text("description"),
  // The SOP (risk_assessments, assessment_type='sop') a user must be signed
  // off on before the grant unlocks — only enforced while the gate is on.
  requiredSopId: integer("required_sop_id").references(() => riskAssessmentsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const featureGrantsTable = pgTable("feature_grants", {
  id: serial("id").primaryKey(),
  featureKey: text("feature_key").notNull().references(() => appFeaturesTable.key, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  grantedBy: integer("granted_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("uq_feature_grant").on(table.featureKey, table.userId),
]);

export type AppFeature = typeof appFeaturesTable.$inferSelect;
export type FeatureGrant = typeof featureGrantsTable.$inferSelect;
