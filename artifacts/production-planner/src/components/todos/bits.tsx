/** The big chips every to-do screen shares: priority, dates, the link. */
import { CalendarDays, ExternalLink, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveTodoLink } from "@/lib/todo-link";
import { dayLabel, PRIORITY_META, type TodoPriority } from "./api";

export function PriorityChip({ p, big }: { p: TodoPriority; big?: boolean }) {
  const meta = PRIORITY_META[p];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-bold",
      big ? "px-4 py-1.5 text-base" : "px-3 py-1 text-sm",
      meta.chip,
    )}>
      <Flag className={big ? "w-4 h-4" : "w-3.5 h-3.5"} />
      {meta.label}
    </span>
  );
}

export function DateChip({ label, iso, overdue, big }: { label: string; iso: string; overdue?: boolean; big?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-semibold",
      big ? "px-4 py-1.5 text-base" : "px-3 py-1 text-sm",
      overdue
        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
        : "bg-secondary text-foreground",
    )}>
      <CalendarDays className={big ? "w-4 h-4" : "w-3.5 h-3.5"} />
      {label} {dayLabel(iso)}{overdue ? " — overdue" : ""}
    </span>
  );
}

export function LinkButton({ url, big }: { url: string; big?: boolean }) {
  const { href, label, external } = resolveTodoLink(url);
  // App-relative links deliberately use a plain same-tab anchor rather than
  // SPA navigation: the sheet lives in Layout, so a wouter navigate would
  // leave it open on top of the destination page. A full load closes it.
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={e => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border-2 border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors",
        big ? "px-5 py-3.5 text-lg" : "px-4 py-2 text-base",
      )}
    >
      <ExternalLink className={big ? "w-5 h-5" : "w-4 h-4"} />
      Open link — {label}
    </a>
  );
}
