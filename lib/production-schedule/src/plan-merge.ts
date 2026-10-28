/**
 * One production plan per day — the merge rule (Graeme, 2026-10-28).
 *
 * "We never do two lots of fried chicken a day or two lots of calzones in a
 * day. Only ever one production for each category of products a day. It
 * always merges." Fried chicken (or mac cheese) can be planned onto a day
 * BEFORE the calzone plan exists; that makes the day's plan, holding only
 * those lines. When the calzone plan is created later it lands INSIDE that
 * plan, exactly as if everything had been added at the same time — never a
 * second plan for the same day.
 *
 * Pure (no DB, no network): the Create Plan dialog uses it to pick the plan
 * to merge into, and the /plan-merge route uses it to re-check that choice
 * and lay the merged plan out. Categories are read through kitchenLine(), so
 * no category string lives here.
 */
import { kitchenLine } from "./kitchen-scope";

/** Plan statuses in the order a day moves through them. */
const STATUS_ORDER = ["draft", "active", "prep", "building", "complete"] as const;
export type MergePlanStatus = (typeof STATUS_ORDER)[number];

function statusRank(s: string | null | undefined): number {
  const i = STATUS_ORDER.indexOf((s ?? "draft") as MergePlanStatus);
  return i < 0 ? 0 : i;
}

/** Does this plan already carry calzone-line production? */
export function hasCalzoneLine(items: ReadonlyArray<{ recipeCategory?: string | null }>): boolean {
  return items.some(it => kitchenLine(it.recipeCategory) === "calzone");
}

export type MergeBlock = "wrong-date" | "complete" | "has-calzones";

/** Can a new calzone plan for `planDate` merge into this existing plan?
 *  Only when it is the same day, the day isn't finished, and the plan holds
 *  no calzones yet (fried chicken only, mac cheese only, or an item-less day
 *  plan). A plan that already has calzones is a genuine clash, not a merge. */
export function mergeBlock(
  plan: { planDate: string; status: string },
  items: ReadonlyArray<{ recipeCategory?: string | null }>,
  planDate: string,
): MergeBlock | null {
  if (plan.planDate !== planDate) return "wrong-date";
  if (plan.status === "complete") return "complete";
  if (hasCalzoneLine(items)) return "has-calzones";
  return null;
}

export interface MergeCandidatePlan {
  id: number;
  planDate: string;
  status: string;
  items?: ReadonlyArray<{ recipeCategory?: string | null }> | null;
}

/** The plan a new calzone plan for `planDate` should merge into, or null.
 *
 *  Null when the day has no other plan (a plain create) and ALSO when any
 *  plan on the day already has calzones — that's two calzone runs on one
 *  day, which the "there's already a plan" dialog asks about instead.
 *  Otherwise the oldest mergeable plan wins, so a repeat create always picks
 *  the same one. `excludeId` is the dialog's own auto-saved draft. */
export function pickMergeTarget(
  plans: readonly MergeCandidatePlan[],
  planDate: string,
  excludeId: number | null = null,
): MergeCandidatePlan | null {
  const sameDay = plans.filter(p => p.planDate === planDate && p.id !== excludeId);
  if (sameDay.length === 0) return null;
  if (sameDay.some(p => hasCalzoneLine(p.items ?? []))) return null;
  const mergeable = sameDay
    .filter(p => mergeBlock(p, p.items ?? [], planDate) === null)
    .sort((a, b) => a.id - b.id);
  return mergeable[0] ?? null;
}

/** The merged plan's status: never step a plan backwards. Saving the calzone
 *  plan as a draft must not knock an active fried chicken run off the
 *  stations; activating it lifts an item-less draft day to active. */
export function mergedStatus(existing: string, incoming: string | null | undefined): MergePlanStatus {
  const rank = Math.max(statusRank(existing), statusRank(incoming ?? "draft"));
  return STATUS_ORDER[rank]!;
}

/** Keep both sets of notes — nothing typed on either is lost. */
export function mergedNotes(existing: string | null | undefined, incoming: string | null | undefined): string | null {
  const a = (existing ?? "").trim();
  const b = (incoming ?? "").trim();
  if (!a) return b || null;
  if (!b || a === b) return a;
  return `${a}\n${b}`;
}

export interface MergeExistingItem {
  id: number;
  recipeId: number;
  recipeCategory?: string | null;
  orderPosition: number;
}

export interface MergeIncomingItem {
  recipeId: number;
}

export interface MergeLayout {
  /** New production lines to insert: index into `incoming`, and position. */
  inserts: Array<{ incomingIndex: number; orderPosition: number }>;
  /** Existing lines whose position changes. */
  moves: Array<{ id: number; orderPosition: number }>;
  /** Incoming recipes already on the plan — the existing line is kept
   *  untouched (it may already have work counted against it). */
  skippedRecipeIds: number[];
}

/** Lay the merged plan out the way it would have been had everything been
 *  added together: mac cheese at the top (the kitchen makes it first — the
 *  add-mac-cheese rule), then the new plan's lines in the order the planner
 *  set them, then everything else already on the plan (fried chicken, which
 *  is always appended). Positions are renumbered 1..n. */
export function planMergeLayout(
  existing: readonly MergeExistingItem[],
  incoming: readonly MergeIncomingItem[],
): MergeLayout {
  const byPos = [...existing].sort((a, b) => a.orderPosition - b.orderPosition || a.id - b.id);
  const top = byPos.filter(e => kitchenLine(e.recipeCategory) === "mac");
  const rest = byPos.filter(e => kitchenLine(e.recipeCategory) !== "mac");
  const onPlan = new Set(existing.map(e => e.recipeId));

  const skipped: number[] = [];
  const toInsert: number[] = [];
  const seen = new Set<number>();
  incoming.forEach((it, i) => {
    if (onPlan.has(it.recipeId)) { if (!skipped.includes(it.recipeId)) skipped.push(it.recipeId); return; }
    if (seen.has(it.recipeId)) return; // same recipe twice in one submit
    seen.add(it.recipeId);
    toInsert.push(i);
  });

  let pos = 0;
  const moves: MergeLayout["moves"] = [];
  const place = (e: MergeExistingItem) => {
    pos += 1;
    if (e.orderPosition !== pos) moves.push({ id: e.id, orderPosition: pos });
  };
  top.forEach(place);
  const inserts = toInsert.map(incomingIndex => ({ incomingIndex, orderPosition: ++pos }));
  rest.forEach(place);

  return { inserts, moves, skippedRecipeIds: skipped };
}
