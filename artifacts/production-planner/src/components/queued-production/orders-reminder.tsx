/**
 * On the Orders page: ingredients still to order for queued test production
 * (Graeme, 30 Oct 2026: "a recurring thing that comes up every day until we
 * have ordered them"). One card per queued day; due today or late first.
 * Ordering and ticking off happen on the queue page.
 */
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOutstandingQueueIngredients } from "./api";

const day = (iso: string) => format(parseISO(iso), "EEE d MMM");

export function QueuedOrdersReminder() {
  const { data } = useOutstandingQueueIngredients();
  const days = data?.days ?? [];
  if (days.length === 0) return null;
  const today = format(new Date(), "yyyy-MM-dd");
  return (
    <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
      {days.map(d => {
        const due = d.lines.filter(l => l.orderBy <= today).length;
        return (
          <Link key={d.productionDate} href={`/plans/queued?date=${d.productionDate}`}
            className={cn("block rounded-2xl border-2 bg-card p-4 hover:bg-secondary/40 transition-colors", due > 0 ? "border-amber-500" : "border-border")}>
            <div className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-violet-600 flex-shrink-0" />
              <span className="text-base font-semibold">Test production {day(d.productionDate)}: {d.lines.length} to order</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">Delivered by {day(d.deliverBy)}{due > 0 ? ` · ${due} due today` : ""}</p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {d.lines.map(l => (
                <li key={l.ingredientId} className="flex justify-between gap-3">
                  <span>{l.name}</span>
                  <span className={cn("tabular-nums flex-shrink-0", l.orderBy <= today ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                    {Math.round(l.toOrder * 100) / 100} {l.unit} · by {day(l.orderBy)}
                  </span>
                </li>
              ))}
            </ul>
          </Link>
        );
      })}
    </div>
  );
}
