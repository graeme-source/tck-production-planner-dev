// New-starter onboarding — pre-arrival info a colleague provides after accepting
// their invite, before their first shift. An admin/manager reviews this from the
// training matrix and ticks the relevant items. Sensitive personal data
// (emergency contacts, right-to-work docs) — access is admin/manager + the owner.

import { pgTable, serial, text, integer, timestamp, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

// Postgres `bytea` — stored / returned as Buffer (same pattern as risk_assessments).
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// One row per user — their pre-arrival details.
export const onboardingSubmissionsTable = pgTable("onboarding_submissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  phone: text("phone"),
  address: text("address"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  emergencyContactRelationship: text("emergency_contact_relationship"),
  submittedAt: timestamp("submitted_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Uploaded files (right-to-work / ID, food hygiene cert). Stored inline as bytea
// like the documents repository; capped at the upload route.
export const onboardingDocumentsTable = pgTable("onboarding_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // "right_to_work" | "food_hygiene" | "other"
  kind: text("kind").notNull().default("other"),
  fileBlob: bytea("file_blob"),
  fileMime: text("file_mime"),
  fileName: text("file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export type OnboardingSubmission = typeof onboardingSubmissionsTable.$inferSelect;
export type OnboardingDocument = typeof onboardingDocumentsTable.$inferSelect;

export const insertOnboardingSubmissionSchema = createInsertSchema(onboardingSubmissionsTable).omit({ id: true, updatedAt: true });
