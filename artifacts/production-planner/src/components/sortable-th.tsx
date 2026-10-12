/**
 * A sortable table header cell — tap to sort by the column, tap again to
 * flip it. Lifted from the Recipes table (/recipes) so every list table
 * looks and behaves the same; the sort rules live in lib/sortable-table.ts.
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SortableTh<K extends string>({ label, sortKey, activeKey, dir, onSort, align = "left", className }: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: "asc" | "desc";
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "py-2.5 px-3 font-semibold select-none cursor-pointer hover:text-foreground transition-colors",
        align === "right" ? "text-right" : "text-left",
        active && "text-foreground",
        className,
      )}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        {active
          ? (dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </span>
    </th>
  );
}
