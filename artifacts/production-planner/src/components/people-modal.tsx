/**
 * The modal shell for the People pages — per the standing rule it can never
 * trap anyone: an explicit X, Escape and a tap outside all close it; the
 * card is capped at 92dvh and scrolls INSIDE so its actions stay reachable
 * on a phone or an iPad in landscape.
 */
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function PeopleModal({ title, onClose, children, wide = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-3 md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "bg-card border-2 border-border rounded-3xl shadow-2xl w-full max-h-[92dvh] flex flex-col overflow-hidden",
          wide ? "max-w-3xl" : "max-w-2xl",
        )}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <h2 className="flex-1 min-w-0 font-display text-xl font-bold truncate">{title}</h2>
          <button onClick={onClose} className="p-2.5 rounded-xl hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
