import { pgTable, text } from "drizzle-orm/pg-core";
import { userRoleEnum } from "./users";

export const pagePermissionsTable = pgTable("page_permissions", {
  pageKey: text("page_key").primaryKey(),
  minRole: userRoleEnum("min_role").notNull().default("viewer"),
});

export type PagePermission = typeof pagePermissionsTable.$inferSelect;
