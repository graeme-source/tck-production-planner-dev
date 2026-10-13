/**
 * The modal shell for the People pages — per the standing rule it can never
 * trap anyone: an explicit X, Escape and a tap outside all close it; the
 * card is capped at 92dvh and scrolls INSIDE so its actions stay reachable
 * on a phone or an iPad in landscape.
 *
 * Pinned footer (Graeme, 2026-10-13, objective H): a form inside puts its
 * main Save / Submit into the bar at the bottom of the card with
 * <PinnedFooter> (components/ui/pinned-save-bar.tsx), so it's always in
 * view. Autosaving fields inside report to one combined save state
 * (useAutosaveSummary) for that footer to show.
 *
 * Close guard: a form holding something unsaved (an AI meeting-notes draft)
 * registers usePeopleModalCloseGuard; closing then asks Save / Discard /
 * Keep editing. Discard always closes, so it still can't trap anyone.
 * Escape only acts on the top-most People modal.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PinnedBody, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";
import { AutosaveSummaryProvider } from "@/hooks/autosave-summary";

export interface PeopleModalCloseGuard {
  title: string;
  description: string;
  saveLabel: string;
  /** Save it; true = saved (the modal then closes). */
  onSave: () => Promise<boolean>;
  /** Throw it away (the modal then closes). */
  onDiscard: () => void;
}
type GuardRef = MutableRefObject<PeopleModalCloseGuard | null>;
const GuardRegistry = createContext<((ref: GuardRef) => () => void) | null>(null);

/** Ask before the surrounding People modal closes while `guard` is set. */
export function usePeopleModalCloseGuard(guard: PeopleModalCloseGuard | null) {
  const register = useContext(GuardRegistry);
  const ref = useRef(guard);
  ref.current = guard;
  const active = guard != null;
  useEffect(() => {
    if (!register || !active) return;
    return register(ref);
  }, [register, active]);
}

export function PeopleModal({ title, onClose, children, wide = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const guards = useRef(new Set<GuardRef>());
  const [asking, setAsking] = useState<PeopleModalCloseGuard | null>(null);
  const [saving, setSaving] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  const register = useCallback((ref: GuardRef) => {
    guards.current.add(ref);
    return () => { guards.current.delete(ref); };
  }, []);

  const requestClose = useCallback(() => {
    const g = Array.from(guards.current).map(r => r.current).find((x): x is PeopleModalCloseGuard => x != null);
    if (g) setAsking(g);
    else onClose();
  }, [onClose]);

  const askingRef = useRef(asking);
  askingRef.current = asking;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the top-most People modal answers (one opened from inside another).
      const all = document.querySelectorAll("[data-people-modal]");
      if (all.length && all[all.length - 1] !== card.current) return;
      if (askingRef.current) setAsking(null);
      else requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const saveAndClose = async () => {
    if (!asking) return;
    setSaving(true);
    try {
      const ok = await asking.onSave();
      setAsking(null);
      if (ok) onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-3 md:p-6" onClick={requestClose}>
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-people-modal=""
        className={cn(
          "relative bg-card border-2 border-border rounded-3xl shadow-2xl w-full max-h-[92dvh] flex flex-col overflow-hidden",
          wide ? "max-w-3xl" : "max-w-2xl",
        )}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <h2 className="flex-1 min-w-0 font-display text-xl font-bold truncate">{title}</h2>
          <button onClick={requestClose} className="p-2.5 rounded-xl hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <GuardRegistry.Provider value={register}>
          <AutosaveSummaryProvider>
            <PinnedBody bodyClassName="p-4 sm:p-5" footerClassName="px-4 sm:px-5 py-3" footerTestId="people-modal-footer">
              {children}
            </PinnedBody>
          </AutosaveSummaryProvider>
        </GuardRegistry.Provider>

        {asking && (
          <div className="absolute inset-0 z-10 bg-black/50 flex items-center justify-center p-4" onClick={() => !saving && setAsking(null)}>
            <div role="alertdialog" aria-modal="true" aria-label={asking.title} onClick={e => e.stopPropagation()}
              className="w-full max-w-md max-h-full overflow-y-auto rounded-3xl border-2 border-border bg-card p-5 space-y-4 shadow-2xl">
              <p className="text-xl font-bold">{asking.title}</p>
              <p className="text-base text-muted-foreground">{asking.description}</p>
              <div className="space-y-2">
                <button type="button" disabled={saving} onClick={() => void saveAndClose()} className={pinnedPrimaryClass}>
                  {saving && <Loader2 className="w-5 h-5 animate-spin" />} {asking.saveLabel}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={saving} onClick={() => { const g = asking; setAsking(null); g.onDiscard(); onClose(); }}
                    className="min-h-12 rounded-2xl border-2 border-destructive text-destructive text-base font-bold hover:bg-destructive/10 disabled:opacity-50">
                    Discard
                  </button>
                  <button type="button" disabled={saving} onClick={() => setAsking(null)}
                    className="min-h-12 rounded-2xl border-2 border-border text-base font-bold hover:bg-secondary/50 disabled:opacity-50">
                    Keep editing
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
