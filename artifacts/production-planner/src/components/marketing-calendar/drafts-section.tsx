/**
 * Klaviyo drafts with NO send date (Graeme, 2026-10-21): "These aren't
 * scheduled for today — they're not scheduled at all. Change this so they're
 * in their own section called 'Drafts' which we can collapse." Objective I.
 *
 * One collapsible section at the top of the calendar, above the List view's
 * scrolling box and above the Month grid alike, so it never pushes Today
 * off screen. Each draft is the same row as in the list (status + inline
 * Approve; tap to open). Open / closed is remembered per device; until this
 * device chooses, it opens only when a draft needs approval (draftsOpen()
 * in @workspace/marketing-calendar, tested there).
 */
import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, ChevronRight } from "lucide-react";
import { draftsOpen, emailRowStatus, rowWantsApproval, sortDrafts } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import type { CalEmail } from "./api";
import { EmailRow } from "./agenda-list";

const OPEN_KEY = "tck.marketingCalendar.draftsOpen";

function readSaved(): string | null {
  try { return localStorage.getItem(OPEN_KEY); } catch { return null; }
}
function save(open: boolean) {
  try { localStorage.setItem(OPEN_KEY, open ? "open" : "closed"); } catch { /* private window — just don't remember */ }
}

export function DraftsSection({ drafts, canApprove, onOpenEmail }: {
  drafts: CalEmail[];
  canApprove: boolean;
  onOpenEmail: (m: CalEmail) => void;
}) {
  const sorted = useMemo(() => sortDrafts(drafts), [drafts]);
  const waiting = sorted.filter(m => rowWantsApproval(emailRowStatus(m))).length;
  const [saved, setSaved] = useState<string | null>(readSaved);
  const open = draftsOpen(saved, waiting > 0);
  if (sorted.length === 0) return null;

  const toggle = () => {
    const next = !open;
    setSaved(next ? "open" : "closed");
    save(next);
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-teal-600/50 bg-teal-500/5">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="w-full min-h-12 px-3 py-2 flex items-center gap-2 text-left rounded-xl hover:bg-teal-500/10">
        {open ? <ChevronDown className="w-5 h-5 flex-shrink-0" /> : <ChevronRight className="w-5 h-5 flex-shrink-0" />}
        <CalendarClock className="w-5 h-5 flex-shrink-0 text-teal-600" />
        <span className="text-base font-bold">Drafts — no send date ({sorted.length})</span>
        {waiting > 0 && (
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-sm font-semibold",
            "bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/50")}>
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            {waiting} need{waiting === 1 ? "s" : ""} approval
          </span>
        )}
        <span className="ml-auto text-sm text-muted-foreground hidden sm:inline">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-sm text-muted-foreground">Built in Klaviyo but not scheduled yet — give them a send date in Klaviyo and they move onto their day.</p>
          {sorted.map(m => <EmailRow key={m.id} email={m} canApprove={canApprove} onOpen={() => onOpenEmail(m)} />)}
        </div>
      )}
    </div>
  );
}
