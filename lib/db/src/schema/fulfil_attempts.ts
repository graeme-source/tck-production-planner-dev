import { pgTable, serial, bigint, integer, text, timestamp, index, boolean, jsonb } from "drizzle-orm/pg-core";

/**
 * Every request to fulfil an order (migration 0409; Graeme, 27 Nov 2026 —
 * #140447). Written before Shopify is called, finished when the answer goes
 * back, so a row stuck at 'started' means the server stopped mid-way.
 * outcome: 'started' | 'fulfilled' | 'refused' (4xx) | 'failed' (5xx).
 */
export const fulfilAttemptsTable = pgTable("fulfil_attempts", {
  id: serial("id").primaryKey(),
  shopifyOrderId: bigint("shopify_order_id", { mode: "number" }).notNull(),
  route: text("route").notNull(),
  consignmentNumber: text("consignment_number"),
  clientAttemptId: text("client_attempt_id"),
  tryNumber: integer("try_number"),
  userId: integer("user_id"),
  userName: text("user_name"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  outcome: text("outcome").notNull().default("started"),
  httpStatus: integer("http_status"),
  error: text("error"),
}, t => [index("fulfil_attempts_order_idx").on(t.shopifyOrderId, t.startedAt)]);

export type FulfilAttempt = typeof fulfilAttemptsTable.$inferSelect;

/** Each API process start (migration 0410) — lets the checklist tell a
 *  restart mid-Complete from any other failure. */
export const serverStartsTable = pgTable("server_starts", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  deploymentId: text("deployment_id"),
  replicaId: text("replica_id"),
});

/** The packer's answers on the "should already have been fulfilled"
 *  checklist (migration 0410). outcome: 'not-found' | 'escalated' | 'fixed'. */
export const fulfilChecksTable = pgTable("fulfil_checks", {
  id: serial("id").primaryKey(),
  shopifyOrderId: bigint("shopify_order_id", { mode: "number" }).notNull(),
  userId: integer("user_id"),
  userName: text("user_name"),
  found: boolean("found").notNull(),
  outcome: text("outcome").notNull(),
  diagnosis: jsonb("diagnosis"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
