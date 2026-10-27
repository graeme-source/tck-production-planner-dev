/**
 * "What's changed in this station?" (Graeme, 27 Oct 2026: "people go into
 * their station in the morning, click What's changed, see e.g. 3 changes in
 * the last 7 days, click one, and it walks them through how to use it";
 * objectives E, F and H).
 *
 * WhatsChangedHost owns the panel and the walkthrough so any station screen
 * can mount it: StationLayout (every station) and Order Packing Live (the
 * packing station's screen). The panel lists this station's changes from
 * the last 7 days, NEW until this person has seen them; "Show me how" closes
 * the panel and runs the change's walkthrough on the station screen itself.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { CheckCircle2, Loader2, PlayCircle, Sparkles, X } from "lucide-react";
import { isUnseen, unseenFirst, type StationChange } from "@workspace/station-changes";
import { Link } from "wouter";
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import { cn } from "@/lib/utils";
import { useMarkSeen, useStationChangesFor } from "./api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function WhatsChangedHost({ stationType, stationLabel, open, onClose }: {
  stationType: string;
  stationLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const [running, setRunning] = useState<StationChange | null>(null);
  return (
    <>
      {/* Portalled to <body>: the host lives inside the sticky station top
          bar, whose stacking context would otherwise put the station's
          bottom dock on top of the panel. */}
      {open && createPortal(
        <WhatsChangedPanel
          stationType={stationType}
          stationLabel={stationLabel}
          onClose={onClose}
          onShowMe={c => { onClose(); setRunning(c); }}
        />,
        document.body,
      )}
      {running?.tutorial && (
        <TutorialOverlay tutorial={running.tutorial} heading={running.title} onClose={() => setRunning(null)} />
      )}
    </>
  );
}

function WhatsChangedPanel({ stationType, stationLabel, onClose, onShowMe }: {
  stationType: string;
  stationLabel: string;
  onClose: () => void;
  onShowMe: (c: StationChange) => void;
}) {
  const q = useStationChangesFor(stationType);
  const markSeen = useMarkSeen();
  const canManage = useFeatureAccess().can("settings.features");
  const list = unseenFirst(q.changes, q.seen);
  const unseenIds = list.filter(c => isUnseen(c, q.seen)).map(c => c.id);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6 bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`What's changed in ${stationLabel}`}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[92dvh] flex flex-col bg-card rounded-2xl border border-border shadow-2xl"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border">
          <div className="w-11 h-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-display font-bold leading-tight">What's changed in {stationLabel}?</h2>
            <p className="text-sm text-muted-foreground mt-0.5">The last 7 days. Tap "Show me how" and it walks you through it on this screen.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="shrink-0 w-12 h-12 -mr-2 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          {q.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : q.isError ? (
            <p className="text-base text-destructive font-semibold py-6 text-center">{(q.error as Error).message}</p>
          ) : list.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-lg font-semibold">Nothing new on {stationLabel} this week.</p>
              <p className="text-sm text-muted-foreground mt-1">When something changes here, it'll show up in this list.</p>
            </div>
          ) : (
            list.map(c => (
              <ChangeCard
                key={c.id}
                change={c}
                unseen={isUnseen(c, q.seen)}
                onShowMe={() => { markSeen.mutate([c.id]); onShowMe(c); }}
                onGotIt={() => markSeen.mutate([c.id])}
              />
            ))
          )}
          {markSeen.isError && (
            <p className="text-sm text-destructive font-semibold">Couldn't save that you've seen it — {(markSeen.error as Error).message}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          {canManage && (
            <Link href="/station-changes" onClick={onClose}
              className="mr-auto h-12 px-3 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary inline-flex items-center">
              Manage changes
            </Link>
          )}
          {unseenIds.length > 1 && (
            <button type="button" onClick={() => markSeen.mutate(unseenIds)} disabled={markSeen.isPending}
              className="h-12 px-4 rounded-xl border-2 border-border font-semibold hover:bg-secondary disabled:opacity-50">
              Mark all as seen
            </button>
          )}
          <button type="button" onClick={onClose}
            className="h-12 px-5 rounded-xl bg-secondary font-semibold hover:bg-secondary/80">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangeCard({ change, unseen, onShowMe, onGotIt }: {
  change: StationChange;
  unseen: boolean;
  onShowMe: () => void;
  onGotIt: () => void;
}) {
  return (
    <div className={cn(
      "rounded-2xl border-2 p-4 sm:p-5 flex flex-col sm:flex-row gap-4",
      unseen ? "border-primary/50 bg-primary/5" : "border-border bg-card",
    )}>
      {change.hasImage && (
        <img
          src={`${BASE}/api/system-updates/${change.id}/image`}
          alt=""
          className="w-full sm:w-40 h-32 sm:h-28 object-cover rounded-xl border border-border shrink-0 bg-secondary/30"
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {unseen && <span className="px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider">New</span>}
          <span className="text-sm text-muted-foreground">{format(new Date(change.createdAt), "EEE d MMM")}</span>
        </div>
        <h3 className="text-xl font-bold leading-snug mt-1">{change.title}</h3>
        {change.bullets.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-base">
            {change.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 leading-snug">
                <span className="text-primary font-bold shrink-0">•</span><span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          {change.tutorial && (
            <button type="button" onClick={onShowMe}
              className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 hover:bg-primary/90 active:scale-[0.98]">
              <PlayCircle className="w-5 h-5" /> Show me how
            </button>
          )}
          {unseen && (
            <button type="button" onClick={onGotIt}
              className="h-12 px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary">
              <CheckCircle2 className="w-5 h-5" /> Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
