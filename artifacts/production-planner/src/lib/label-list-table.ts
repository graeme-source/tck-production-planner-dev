/**
 * Product Labels list (/labels) as a sortable table — the pure rules:
 * which statuses need attention first, what each column sorts by, and the
 * short "What needs doing" line. Objectives D and F.
 */
import type { LabelStatus } from "@workspace/product-labels";
import { sortRows, type SortState, type SortValue } from "./sortable-table";

/** The bits of a /api/product-labels list row the table uses. */
export interface LabelTableRow {
  name: string;
  category: string | null;
  status: LabelStatus;
  liveVersion: { versionNo: number; publishedAt: string; publishedByName: string | null } | null;
  changes: string[];
  blockers: string[];
}

export type LabelSortKey = "name" | "category" | "status" | "live" | "todo";

/** Needing attention first: can't print, then out of date, then never live. */
export const LABEL_STATUS_RANK: Record<LabelStatus, number> = {
  "doesnt-fit": 0,
  "update-needed": 1,
  "never-published": 2,
  live: 3,
  "draft-recipe": 4,
  archived: 5,
};

export const DEFAULT_LABEL_SORT: SortState<LabelSortKey> = { key: "status", dir: "asc" };

/** The direction a column starts in when first tapped. Live version = newest first. */
export const LABEL_FIRST_DIR: Record<LabelSortKey, "asc" | "desc"> = {
  name: "asc", category: "asc", status: "asc", live: "desc", todo: "asc",
};

/**
 * "What needs doing": the changes since the live label, then anything
 * blocking it going live. `short` fits a table cell; `full` is everything
 * (shown on hover). Empty when there's nothing to do.
 */
export function labelTodo(row: LabelTableRow): { short: string; full: string } {
  const parts: string[] = [];
  const fullParts: string[] = [];
  if (row.changes.length > 0) {
    const shown = row.changes.slice(0, 3).join(", ");
    const more = row.changes.length > 3 ? ` +${row.changes.length - 3} more` : "";
    parts.push(`Changed since live: ${shown}${more}`);
    fullParts.push(`Changed since live: ${row.changes.join(", ")}`);
  }
  if (row.blockers.length > 0 && row.status !== "live") {
    parts.push(row.blockers.length === 1 ? row.blockers[0] : `${row.blockers.length} things to fix before it can go live`);
    fullParts.push(...row.blockers);
  }
  return { short: parts.join(" · "), full: fullParts.join("\n") };
}

export function labelSortValue(row: LabelTableRow, key: LabelSortKey): SortValue {
  switch (key) {
    case "name": return row.name;
    case "category": return row.category;
    case "status": return LABEL_STATUS_RANK[row.status];
    case "live": return row.liveVersion ? Date.parse(row.liveVersion.publishedAt) : null;
    case "todo": return labelTodo(row).short;
  }
}

/** Sorted rows; ties (e.g. every "Update needed") fall back to name A→Z. */
export function sortLabelRows<T extends LabelTableRow>(rows: readonly T[], sort: SortState<LabelSortKey>): T[] {
  return sortRows<T, LabelSortKey>(rows, sort, labelSortValue, r => r.name);
}

/** Search by product name or category. */
export function matchesLabelSearch(row: LabelTableRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || (row.category ?? "").toLowerCase().includes(q);
}
