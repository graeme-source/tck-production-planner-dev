/**
 * A now-and-then tool opened from a menu (Recipe tools, Station menu): big,
 * closable, viewport-fit — X in the header, the card capped at 92dvh and
 * scrolling inside, so it can never trap anyone (CLAUDE.md modal rule).
 */
import type React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ToolPopup({ title, icon: Icon, iconClass, onClose, children }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <Icon className={iconClass ?? "w-6 h-6 text-primary shrink-0"} />
          <h2 className="flex-1 font-display font-bold text-xl">{title}</h2>
          <button onClick={onClose} className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
