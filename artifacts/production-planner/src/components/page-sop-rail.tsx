/**
 * Page-level SOPs, reachable from the top bar of EVERY screen (2026-09-08).
 *
 * Any page in the planner can carry its own SOPs — Graeme's ask started at
 * Order Packing Live, but the wiring is the top bar itself so no page needs
 * per-page work. Links are keyed by the normalised route path (see
 * lib/page-sop-key), so every production plan's copy of a parameterised page
 * shares one set.
 *
 * With one SOP attached, "Show me how" opens it directly. With several, it
 * opens a chooser modal listing each SOP by title — tap one to view it
 * (Graeme, 2026-09-08). The small + button manages the page's SOPs: attach
 * from the library, create-and-attach, or detach — the same SopPicker used
 * at stations and checklists, so behaviour is identical everywhere.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, X, ChevronRight, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { pageSopKey } from "@/lib/page-sop-key";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";
import { SopPicker, type SopLink } from "@/components/sop-link-chips";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function PageSopButton({ pageLabel }: {
  /** Human name of the page ("Order Packing Live") — labels the modals and
   *  pre-fills the title of an SOP created here. */
  pageLabel: string;
}) {
  const [pathname] = useLocation();
  const pageKey = pageSopKey(pathname);
  const queryKey = ["sop-links-page", pageKey];
  const queryClient = useQueryClient();

  const { data: links = [] } = useQuery<SopLink[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/standards/links/for-page?page=${encodeURIComponent(pageKey)}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const [chooserOpen, setChooserOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [viewSopId, setViewSopId] = useState<number | null>(null);
  const [editSopId, setEditSopId] = useState<number | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const detach = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await fetch(`${BASE}/api/standards/links/${linkId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to detach SOP");
    },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't detach the SOP", variant: "destructive" }),
  });

  // Same convention as SopChips: an SOP with no steps yet opens straight
  // into the editor — promising a how-to and showing nothing is worse than
  // no SOP at all.
  function openSop(link: SopLink) {
    setChooserOpen(false);
    if (link.stepCount === 0) setEditSopId(link.sopId);
    else setViewSopId(link.sopId);
  }

  function handleShowMeHow() {
    if (links.length === 1) openSop(links[0]);
    else setChooserOpen(true);
  }

  // Portalled to <body>: this button lives in the top bar, whose
  // backdrop-blur makes it the containing block for fixed-position children —
  // a modal rendered in place would be trapped inside the header (same
  // stacking-context trap the layout's SOPs dialog works around).
  const modalShell = (title: string, onClose: () => void, children: React.ReactNode) => createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg p-5 space-y-4 mt-14" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold leading-tight">{title}</h2>
            <p className="text-sm text-muted-foreground">{pageLabel}</p>
          </div>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );

  return (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      {links.length > 0 && (
        <button
          onClick={handleShowMeHow}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-colors"
          title={links.length === 1 ? links[0].title : `${links.length} SOPs for this page`}
        >
          <BookOpen className="w-4 h-4" />
          <span className="hidden sm:inline whitespace-nowrap">Show me how</span>
          {links.length > 1 && <span className="tabular-nums">{links.length}</span>}
        </button>
      )}
      <button
        onClick={() => setManageOpen(true)}
        className={cn(
          "flex items-center gap-1 py-1.5 rounded-lg text-sm font-medium border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors",
          links.length > 0 ? "px-1.5" : "px-2.5",
        )}
        title="Attach an SOP to this page"
        aria-label="Attach an SOP to this page"
      >
        <Plus className="w-4 h-4" />
        {links.length === 0 && <span className="hidden lg:inline">SOP</span>}
      </button>

      {chooserOpen && modalShell("Show me how", () => setChooserOpen(false), (
        <div className="space-y-2">
          {links.map(l => (
            <button
              key={l.linkId}
              onClick={() => openSop(l)}
              className={cn(
                "w-full flex items-center gap-3 rounded-xl border p-4 text-left transition-colors",
                l.stepCount === 0
                  ? "border-dashed border-amber-500/70 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  : "border-border hover:border-primary hover:bg-primary/5",
              )}
            >
              {l.stepCount === 0
                ? <PenLine className="w-5 h-5 text-amber-600 flex-shrink-0" />
                : <BookOpen className="w-5 h-5 text-primary flex-shrink-0" />}
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-base leading-snug">{l.title}</span>
                {l.stepCount === 0 && (
                  <span className="block text-xs text-amber-700 dark:text-amber-300 mt-0.5">No steps written yet — opens the editor</span>
                )}
              </span>
              <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            </button>
          ))}
        </div>
      ))}

      {manageOpen && modalShell("SOPs on this page", () => setManageOpen(false), (
        <div className="space-y-3">
          {links.length > 0 && (
            <div className="space-y-1.5">
              {links.map(l => (
                <div key={l.linkId} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
                  <button
                    onClick={() => { setManageOpen(false); openSop(l); }}
                    className="flex-1 min-w-0 truncate text-left text-sm font-medium hover:text-primary"
                    title={l.title}
                  >
                    {l.title}
                  </button>
                  <button
                    onClick={() => detach.mutate(l.linkId)}
                    disabled={detach.isPending}
                    className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10 flex-shrink-0 disabled:opacity-50"
                    title={`Detach ${l.title} from this page`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <SopPicker
            targets={[{ targetType: "page", text: pageKey, label: pageLabel, subject: pageLabel }]}
            existingSopIds={new Set(links.map(l => l.sopId))}
            // Attaching keeps the modal open — "sometimes we'll add multiple
            // SOPs to the same page" (Graeme, 2026-09-08), so one attach
            // shouldn't end the visit.
            onDone={invalidate}
            onInvalidate={invalidate}
            onEditSop={id => { setManageOpen(false); setEditSopId(id); }}
          />
        </div>
      ))}

      {viewSopId != null && createPortal(
        <StandardsSopsDialog open onClose={() => setViewSopId(null)} initialSopId={viewSopId} />,
        document.body,
      )}
      {editSopId != null && createPortal(
        <StandardsSopsDialog open onClose={() => { setEditSopId(null); invalidate(); }} initialEditSopId={editSopId} />,
        document.body,
      )}
    </span>
  );
}
