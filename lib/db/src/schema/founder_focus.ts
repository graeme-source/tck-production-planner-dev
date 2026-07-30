import { pgTable, serial, text, integer, timestamp, date, index, unique } from "drizzle-orm/pg-core";

// Founder Focus — founder-only time-blocking and priorities. Pillars are the
// handful of areas only the founder can do (AI/systems work, sales, team
// coaching…); goals live under a pillar; blocks are the day's time-boxed
// plan; templates seed a default week; the parking lot catches "things that
// pull" so they can be captured without being acted on mid-block.

export const founderPillarsTable = pgTable("founder_pillars", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Hex colour used for block chips and the weekly share report.
  color: text("color"),
  sort: integer("sort").notNull().default(0),
  // Intended share of the working week, in percent. Nullable = no target.
  targetSharePct: integer("target_share_pct"),
  notes: text("notes"),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const founderGoalsTable = pgTable("founder_goals", {
  id: serial("id").primaryKey(),
  pillarId: integer("pillar_id")
    .notNull()
    .references(() => founderPillarsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  detail: text("detail"),
  // active | done | parked
  status: text("status").notNull().default("active"),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  doneAt: timestamp("done_at"),
});

export const founderBlocksTable = pgTable(
  "founder_blocks",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    // Minutes from midnight, local kitchen time — matches how the day
    // schedule stores times and avoids timezone drift on a DATE column.
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    pillarId: integer("pillar_id").references(() => founderPillarsTable.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    notes: text("notes"),
    // planned | done | skipped
    status: text("status").notNull().default("planned"),
    // manual | template | caz — where the block came from.
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ix_founder_blocks_date").on(t.date)],
);

export const founderBlockTemplatesTable = pgTable("founder_block_templates", {
  id: serial("id").primaryKey(),
  // 0 = Sunday … 6 = Saturday, matching JS Date.getDay().
  weekday: integer("weekday").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  pillarId: integer("pillar_id").references(() => founderPillarsTable.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  sort: integer("sort").notNull().default(0),
});

// Per-pillar daily rituals ("30-min one-on-one coaching"). Shown as
// tickboxes inside that pillar's block on the day view — only on days
// where the pillar actually has a block, so a template without the pillar
// simply hides them. Tick state is one row per (item, date).
export const founderRecurringItemsTable = pgTable("founder_recurring_items", {
  id: serial("id").primaryKey(),
  pillarId: integer("pillar_id")
    .notNull()
    .references(() => founderPillarsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sort: integer("sort").notNull().default(0),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const founderRecurringTicksTable = pgTable(
  "founder_recurring_ticks",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => founderRecurringItemsTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    tickedAt: timestamp("ticked_at").notNull().defaultNow(),
  },
  (t) => [unique("founder_recurring_ticks_item_date").on(t.itemId, t.date)],
);

export const founderParkingLotTable = pgTable("founder_parking_lot", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export type FounderPillar = typeof founderPillarsTable.$inferSelect;
export type FounderGoal = typeof founderGoalsTable.$inferSelect;
export type FounderBlock = typeof founderBlocksTable.$inferSelect;
export type FounderBlockTemplate = typeof founderBlockTemplatesTable.$inferSelect;
export type FounderParkingLotItem = typeof founderParkingLotTable.$inferSelect;
export type FounderRecurringItem = typeof founderRecurringItemsTable.$inferSelect;
export type FounderRecurringTick = typeof founderRecurringTicksTable.$inferSelect;
