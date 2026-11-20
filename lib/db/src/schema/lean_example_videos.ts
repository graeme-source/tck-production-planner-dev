import { pgTable, text, timestamp, integer, customType } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { leanExamplesTable } from "./morning_meetings";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() { return "bytea"; },
});

/** A lean lesson day's own uploaded video (migration 0388). Kept out of
 *  lean_examples so reading lessons never loads a video. */
export const leanExampleVideosTable = pgTable("lean_example_videos", {
  exampleId: integer("example_id").primaryKey().references(() => leanExamplesTable.id, { onDelete: "cascade" }),
  video: bytea("video").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  fileName: text("file_name"),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});
