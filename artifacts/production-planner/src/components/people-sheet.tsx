/**
 * A side sheet for the People pages (Graeme, 2026-10-12) — the record's
 * secondary panels (Hours worked, Employment & holiday, Contracts,
 * Documents, Emergency contact, What we agreed) open in one of these so the
 * timeline keeps the page. Slides in from the right on an iPad or desktop;
 * comes up from the bottom, nearly full height, on a phone.
 *
 * Per the standing rule it can never trap anyone: an explicit X, Escape and
 * a tap outside all close it; it's capped at 92dvh on a phone and scrolls
 * INSIDE. It sits just below PeopleModal (z-[110]) so a form or document
 * opened from inside the sheet comes up on top of it, and Escape then
 * closes only that top one.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function PeopleSheet({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only when this sheet is the top dialog — a modal opened from inside
      // it closes first.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] === panel.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => { closeBtn.current?.focus(); }, []);

  return (
    <div className="fixed inset-0 z-[105] bg-black/50" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        className={
          "absolute inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl " +
          "md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:max-h-none md:w-[min(48rem,94vw)] md:rounded-t-none md:rounded-l-3xl " +
          "bg-background border-2 border-border shadow-2xl flex flex-col overflow-hidden"
        }
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0 bg-card">
          <h2 id={titleId} className="flex-1 min-w-0 font-display text-xl font-bold truncate">{title}</h2>
          <button ref={closeBtn} onClick={onClose} className="h-12 w-12 rounded-xl hover:bg-secondary flex items-center justify-center" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 pb-8">{children}</div>
      </div>
    </div>
  );
}
