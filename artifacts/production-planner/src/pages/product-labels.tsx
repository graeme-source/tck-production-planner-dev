/**
 * Product → Labels: every recipe's pack label and whether its LIVE version
 * is up to date (Stage 1 of replacing Label LIVE; Objectives A, D, F).
 *
 * The live label is a frozen copy taken when someone checked it and pressed
 * "Update live". Each recipe's label is rebuilt from the recipe as it is now
 * and compared — any difference shows here as "Update needed", and clears by
 * itself if the change is undone.
 *
 * Since 12 Oct 2026 this is the Product Labels hub that replaced the old
 * Product Hub: a Labels tab (the cards) and a Data health tab (?tab=health,
 * ingredients missing declarations or nutrition). Each card opens the
 * recipe's label, ingredient deck and nutrition. Objective F.
 *
 * Since 12 Oct 2026 the Labels tab is a sortable table, one product per row
 * (sort rules: lib/label-list-table.ts), not a two-column grid of cards.
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronRight, HeartPulse, Loader2, Percent, Search, Settings2, Tag, X } from "lucide-react";
import type { LabelStatus } from "@workspace/product-labels";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { fmtDateTime, STATUS_TONE, useLabelList, type LabelListRow } from "@/components/product-labels/api";
import { HubTabs, useCanSeeProductData, useTabParam, type HubTab } from "@/components/product-labels/hub-tabs";
import { DataHealthPanel } from "@/components/product-labels/data-health-panel";
import { RecipeDraftBadge } from "@/components/recipe-archive";
import { SortableTh } from "@/components/sortable-th";
import { nextSort, type SortState } from "@/lib/sortable-table";
import {
  DEFAULT_LABEL_SORT, LABEL_FIRST_DIR, labelTodo, matchesLabelSearch, sortLabelRows, type LabelSortKey,
} from "@/lib/label-list-table";

type ListTab = "labels" | "health";
const ALL_TABS: HubTab<ListTab>[] = [
  { key: "labels", label: "Labels", icon: Tag },
  { key: "health", label: "Data health", icon: HeartPulse },
];

const FILTERS: Array<{ key: "all" | LabelStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "update-needed", label: "Update needed" },
  { key: "doesnt-fit", label: "Doesn't fit" },
  { key: "never-published", label: "Never published" },
  { key: "live", label: "Live & up to date" },
  { key: "draft-recipe", label: "Draft recipes" },
];

export default function ProductLabelsPage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canEdit = role === "admin" || role === "manager";
  const { data, isLoading, error } = useLabelList();
  const [filter, setFilter] = useState<"all" | LabelStatus>("all");
  // Data health keeps the old Product Hub's access level.
  const canSeeData = useCanSeeProductData();
  const tabs = canSeeData ? ALL_TABS : ALL_TABS.filter(t => t.key === "labels");
  const [tab, setTab] = useTabParam(tabs.map(t => t.key));

  const rows = data?.recipes ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<LabelSortKey>>(DEFAULT_LABEL_SORT);
  const visible = useMemo(
    () => sortLabelRows(
      rows.filter(r => (filter === "all" || r.status === filter) && matchesLabelSearch(r, search)),
      sort,
    ),
    [rows, filter, search, sort],
  );

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="Product Labels"
        description="Each recipe's pack label, ingredient deck and nutrition. The live label is what gets printed — recipe changes never alter it until someone checks the new one and updates it."
        action={canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/labels/quid" className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary">
              <Percent className="w-5 h-5" /> QUID words
            </Link>
            <Link href="/labels/settings" className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary">
              <Settings2 className="w-5 h-5" /> Label design & type
            </Link>
          </div>
        ) : undefined}
      />

      {tabs.length > 1 && <HubTabs tabs={tabs} value={tab} onChange={setTab} />}

      {tab === "health" ? <DataHealthPanel /> : (<>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "h-11 px-4 rounded-full text-sm font-bold border-2 transition-colors",
              filter === f.key ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label} {counts[f.key] ? <span className="ml-1 tabular-nums">{counts[f.key]}</span> : null}
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products by name or category…"
          aria-label="Search products"
          className="w-full h-11 pl-10 pr-9 bg-card border-2 border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="w-5 h-5 animate-spin" /> Checking every label against its recipe…</div>
      ) : error ? (
        <p className="text-destructive">Couldn't load the labels — {(error as Error).message}</p>
      ) : (
        <LabelTable rows={visible} sort={sort} onSort={k => setSort(s => nextSort(s, k, LABEL_FIRST_DIR[k]))} />
      )}
      </>)}
    </div>
  );
}

/**
 * One row per product (Graeme, 12 Oct 2026: "one column… into tables that
 * we can sort, a bit more like the recipe database"). Tapping a row opens
 * the product's label; the name is a real link too, for keyboards.
 */
function LabelTable({ rows, sort, onSort }: {
  rows: LabelListRow[];
  sort: SortState<LabelSortKey>;
  onSort: (key: LabelSortKey) => void;
}) {
  const [, navigate] = useLocation();
  const th = (label: string, key: LabelSortKey, className?: string) => (
    <SortableTh label={label} sortKey={key} activeKey={sort.key} dir={sort.dir} onSort={onSort} className={className} />
  );
  return (
    <div className="overflow-x-auto glass-panel rounded-2xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            {th("Product", "name")}
            {th("Category", "category", "hidden md:table-cell")}
            {th("Status", "status")}
            {th("Live version", "live", "hidden sm:table-cell")}
            {th("What needs doing", "todo")}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const todo = labelTodo(r);
            return (
              <tr
                key={r.recipeId}
                onClick={() => navigate(`/labels/${r.recipeId}`)}
                className="group border-b border-border/50 last:border-0 hover:bg-secondary/40 cursor-pointer align-middle"
              >
                <td className="py-3 px-3 min-w-[9rem]">
                  <Link
                    href={`/labels/${r.recipeId}`}
                    onClick={e => e.stopPropagation()}
                    className="text-base font-semibold leading-snug hover:text-primary"
                  >
                    {r.name}
                  </Link>
                  {r.status === "draft-recipe" && <RecipeDraftBadge className="ml-2 align-middle" />}
                  {r.category && <p className="md:hidden text-xs text-muted-foreground mt-0.5">{r.category}</p>}
                </td>
                <td className="py-3 px-3 text-muted-foreground hidden md:table-cell">{r.category ?? "—"}</td>
                <td className="py-3 px-3">
                  <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold whitespace-nowrap", STATUS_TONE[r.status])}>
                    {r.status === "live" ? <CheckCircle2 className="w-3.5 h-3.5" /> : r.status === "update-needed" || r.status === "doesnt-fit" ? <AlertTriangle className="w-3.5 h-3.5" /> : null}
                    {r.statusLabel}
                  </span>
                </td>
                <td className="py-3 px-3 text-muted-foreground hidden sm:table-cell">
                  {r.liveVersion ? (
                    <span className="block leading-snug">
                      <span className="font-semibold text-foreground">v{r.liveVersion.versionNo}</span> · {fmtDateTime(r.liveVersion.publishedAt)}
                      {r.liveVersion.publishedByName && <span className="block text-xs">{r.liveVersion.publishedByName}</span>}
                    </span>
                  ) : "—"}
                </td>
                <td className="py-3 px-3 max-w-[18rem]">
                  {todo.short ? (
                    <span
                      title={todo.full}
                      className={cn("line-clamp-2", r.blockers.length > 0 && r.status !== "live" && r.changes.length === 0 && "text-rose-700 dark:text-rose-400")}
                    >
                      {todo.short}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-3 pr-3 text-right">
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary inline" />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Nothing here.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
