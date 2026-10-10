/**
 * Product → Labels: every recipe's pack label and whether its LIVE version
 * is up to date (Stage 1 of replacing Label LIVE; Objectives A, D, F).
 *
 * The live label is a frozen copy taken when someone checked it and pressed
 * "Update live". Each recipe's label is rebuilt from the recipe as it is now
 * and compared — any difference shows here as "Update needed", and clears by
 * itself if the change is undone.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, Settings2, Tag } from "lucide-react";
import type { LabelStatus } from "@workspace/product-labels";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { fmtDateTime, STATUS_TONE, useLabelList, type LabelListRow } from "@/components/product-labels/api";

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

  const rows = data?.recipes ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  const visible = filter === "all" ? rows : rows.filter(r => r.status === filter);

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="Labels"
        description="Each recipe's pack label. The live version is what gets printed — recipe changes never alter it until someone checks the new one and updates it."
        action={canEdit ? (
          <Link href="/labels/settings" className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border bg-card font-semibold hover:bg-secondary">
            <Settings2 className="w-5 h-5" /> Label design & type
          </Link>
        ) : undefined}
      />

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

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="w-5 h-5 animate-spin" /> Checking every label against its recipe…</div>
      ) : error ? (
        <p className="text-destructive">Couldn't load the labels — {(error as Error).message}</p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground py-6">Nothing here.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map(r => <LabelCard key={r.recipeId} row={r} />)}
        </div>
      )}
    </div>
  );
}

function LabelCard({ row }: { row: LabelListRow }) {
  return (
    <Link
      href={`/labels/${row.recipeId}`}
      className="group rounded-2xl border-2 border-border bg-card p-4 flex flex-col gap-3 hover:border-primary/60 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Tag className="w-6 h-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight">{row.name}</p>
          {row.category && <p className="text-sm text-muted-foreground">{row.category}</p>}
        </div>
        <ChevronRight className="w-6 h-6 text-muted-foreground group-hover:text-primary shrink-0" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-bold", STATUS_TONE[row.status])}>
          {row.status === "live" ? <CheckCircle2 className="w-4 h-4" /> : row.status === "update-needed" || row.status === "doesnt-fit" ? <AlertTriangle className="w-4 h-4" /> : null}
          {row.statusLabel}
        </span>
        {row.liveVersion && (
          <span className="text-sm text-muted-foreground">
            Live v{row.liveVersion.versionNo} · {fmtDateTime(row.liveVersion.publishedAt)}{row.liveVersion.publishedByName ? ` · ${row.liveVersion.publishedByName}` : ""}
          </span>
        )}
      </div>
      {row.changes.length > 0 && (
        <p className="text-sm"><span className="font-semibold">Changed since live:</span> {row.changes.slice(0, 4).join(", ")}{row.changes.length > 4 ? ` +${row.changes.length - 4} more` : ""}</p>
      )}
      {row.blockers.length > 0 && row.status !== "live" && (
        <p className="text-sm text-rose-700 dark:text-rose-400">
          {row.blockers.length === 1 ? row.blockers[0] : `${row.blockers.length} things to fix before it can go live`}
        </p>
      )}
    </Link>
  );
}
