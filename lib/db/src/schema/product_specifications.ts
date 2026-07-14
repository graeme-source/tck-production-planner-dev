import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { recipesTable } from "./recipes";

// One row per recipe: the buyer-facing / BRC-style specification data that
// can't be derived from the recipe tree (that side — ingredients declaration,
// QUID, allergen aggregation, nutrition — is computed live by the
// ingredient-deck and nutritionals endpoints). Rendered together into the
// spec-sheet PDF at GET /api/recipes/:id/spec-sheet.pdf.
export const productSpecificationsTable = pgTable("product_specifications", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().unique().references(() => recipesTable.id, { onDelete: "cascade" }),
  // Legal name per FIC Reg 1169/2011 (e.g. "Wood-fired style folded pizza
  // with tomato and mozzarella"), distinct from the marketing name.
  legalName: text("legal_name"),
  productDescription: text("product_description"),
  intendedUse: text("intended_use"),
  // Consumer-facing, e.g. "Keep refrigerated below 5°C. Once opened consume
  // within 24 hours. Suitable for home freezing on day of purchase."
  storageInstructions: text("storage_instructions"),
  // Consumer cooking/reheating instructions.
  usageInstructions: text("usage_instructions"),
  // Per-product override of the global app_settings.may_contain_statement.
  mayContainOverride: text("may_contain_override"),
  // { format, primaryPackaging, secondaryPackaging, caseConfiguration,
  //   materials, recyclability } — free-shape, rendered as label/value rows.
  packagingSpec: jsonb("packaging_spec").$type<Record<string, string>>(),
  // { appearance, aroma, flavour, texture }
  organolepticStandards: jsonb("organoleptic_standards").$type<Record<string, string>>(),
  // Array of { organism, target, maximum, lastTestDate, lastTestLab,
  //   lastTestResult } — criteria plus most recent verification result.
  microCriteria: jsonb("micro_criteria").$type<Array<Record<string, string>>>(),
  dietarySuitability: text("dietary_suitability"),
  specVersion: integer("spec_version").notNull().default(1),
  specStatus: text("spec_status").notNull().default("draft"), // draft | approved
  preparedBy: text("prepared_by"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Single-row table (id enforced = 1 by the app) holding the manufacturer &
// site block shared by every spec sheet.
export const companyProfileTable = pgTable("company_profile", {
  id: integer("id").primaryKey().default(1),
  legalBusinessName: text("legal_business_name"),
  tradingName: text("trading_name"),
  siteAddress: text("site_address"),
  fboRegistrationNumber: text("fbo_registration_number"),
  localAuthority: text("local_authority"),
  certificationStatus: text("certification_status"), // e.g. "SALSA approved, cert #1234, expires ..."
  technicalContactName: text("technical_contact_name"),
  technicalContactEmail: text("technical_contact_email"),
  technicalContactPhone: text("technical_contact_phone"),
  emergencyContact: text("emergency_contact"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProductSpecificationSchema = createInsertSchema(productSpecificationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProductSpecification = z.infer<typeof insertProductSpecificationSchema>;
export type ProductSpecification = typeof productSpecificationsTable.$inferSelect;
export type CompanyProfile = typeof companyProfileTable.$inferSelect;
