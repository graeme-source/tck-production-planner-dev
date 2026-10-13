/**
 * A team list as a big card (index page, dashboard) and the progress bar
 * it shares with the list page.
 */
import { Link } from "wouter";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { progressText, type Progress, type TeamListSummary } from "./team-lists-api";

export function ProgressBar({ progress, color }: { progress: Progress; color?: string | null }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const complete = progress.total > 0 && progress.done === progress.total;
  return (
    <div className="h-3 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", complete && "bg-emerald-500")}
        style={{ width: `${pct}%`, backgroundColor: complete ? undefined : color ?? "hsl(var(--primary))" }} />
    </div>
  );
}

export function ListCard({ list, compact = false, onClick }: { list: TeamListSummary; compact?: boolean; onClick?: () => void }) {
  const p = list.progress;
  return (
    <Link href={`/lists/${list.id}`} onClick={onClick}
      className={cn("block rounded-3xl border-2 border-border bg-card hover:border-primary/60 active:scale-[0.99] transition-all", compact ? "p-4" : "p-5")}
      style={{ borderLeftColor: list.color ?? undefined, borderLeftWidth: list.color ? 8 : undefined }}>
      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none">{list.emoji || "📋"}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold leading-tight truncate">{list.name}{list.archived ? " (archived)" : ""}</span>
          <span className={cn("block text-sm", p.overdue > 0 ? "text-amber-700 dark:text-amber-400 font-semibold" : "text-muted-foreground")}>{progressText(p)}</span>
        </span>
        {p.total > 0 && p.done === p.total && <Check className="w-7 h-7 text-emerald-600 shrink-0" />}
      </div>
      {p.total > 0 && <div className="mt-3"><ProgressBar progress={p} color={list.color} /></div>}
    </Link>
  );
}

