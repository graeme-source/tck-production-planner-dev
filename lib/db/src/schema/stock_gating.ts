/**
 * Stock-gate holds — products automatically held back from next-day delivery.
 *
 * When the fridge-vs-despatch surplus for a product falls to the configured
 * threshold, the poller adds a Shopify product tag that a Zapiet
 * product-specific preparation-time rule turns into "tomorrow is not
 * offered in the date picker". Each hold is one row; releasing (auto or
 * manual) stamps released_at rather than deleting, so the table doubles as
 * the audit trail of every hold/release with the numbers that caused it.
 *
 * Only holds created here are ever released here — a tag Graeme adds by
 * hand in Shopify admin is invisible to this table and never touched.
 */
import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { recipesTable } from "./recipes";

export const stockGateHoldsTable = pgTable("stock_gate_holds", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  recipeName: text("recipe_name").notNull(),
  // The tag written to Shopify (snapshot — the setting may change later).
  tag: text("tag").notNull(),
  // gid://shopify/Product/… + display title, resolved from the recipe's
  // mapped 2-pack variant at hold time.
  productGid: text("product_gid"),
  productTitle: text("product_title"),
  shopifyVariantId: text("shopify_variant_id"),
  // The numbers that pulled the trigger.
  surplusAtHold: integer("surplus_at_hold").notNull(),
  thresholdAtHold: integer("threshold_at_hold").notNull(),
  // Dry-run holds record what WOULD have been tagged, with no Shopify write.
  dryRun: boolean("dry_run").notNull().default(false),
  // Zapiet calendar check. null = no answer yet, then:
  //   verified    — Zapiet confirms tomorrow is gone (terminal)
  //   skipped     — the check couldn't say anything, re-checked later
  //   unconfirmed — still offered, but too early to conclude anything
  //   failed      — still offered after the confidence window
  // The check repeats on a schedule (see lib/stock-gate-verify.ts): judging a
  // hold on one reading a minute after tagging produced false negatives.
  verifyStatus: text("verify_status"),
  verifyNote: text("verify_note"),
  verifyAttempts: integer("verify_attempts").notNull().default(0),
  verifyCheckedAt: timestamp("verify_checked_at"),
  heldAt: timestamp("held_at").notNull().defaultNow(),
  // released_at IS NULL = the hold is live.
  releasedAt: timestamp("released_at"),
  // "auto" or the name of the user who clicked Release.
  releasedBy: text("released_by"),
  surplusAtRelease: integer("surplus_at_release"),
}, (t) => ({
  recipeIdx: index("ix_stock_gate_holds_recipe").on(t.recipeId),
  heldAtIdx: index("ix_stock_gate_holds_held_at").on(t.heldAt),
}));

export type StockGateHold = typeof stockGateHoldsTable.$inferSelect;
