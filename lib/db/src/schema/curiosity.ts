import { pgTable, serial, text, integer, timestamp, boolean, unique, customType } from "drizzle-orm/pg-core";
import { productionPlansTable } from "./production_plans";
import { usersTable } from "./users";

// Same inline-bytea custom type as morning_meetings / collections — photos
// live on the row; object storage isn't wired up for this app.
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// Curiosity Time (migration 0063): one waste-spotting walk per station per
// plan. The walk is the "sheet"; observations are its eight rows, one per
// Lean Made Simple waste, written as the person answers each one.
export const curiosityWalksTable = pgTable("curiosity_walks", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  stationType: text("station_type").notNull(),
  startedBy: integer("started_by").references(() => usersTable.id, { onDelete: "set null" }),
  startedByName: text("started_by_name").notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("uq_curiosity_walk").on(t.planId, t.stationType),
]);

export const curiosityObservationsTable = pgTable("curiosity_observations", {
  id: serial("id").primaryKey(),
  walkId: integer("walk_id").notNull().references(() => curiosityWalksTable.id, { onDelete: "cascade" }),
  // Canonical Lean Made Simple waste name (validated against the corpus on
  // write — no CHECK constraint so a corpus correction never strands rows).
  wasteName: text("waste_name").notNull(),
  spotted: boolean("spotted").notNull(),
  note: text("note"),
  photo: bytea("photo"),
  photoMime: text("photo_mime"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("uq_curiosity_observation").on(t.walkId, t.wasteName),
]);
