/**
 * The top of the docked panel, the same for a team list and for My to-dos:
 * what it's showing (full name, wrapping — never cut short), close, the
 * switcher between everything it can show, and "Full view".
 */
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { TODOS_CHOICE, type DockChoice } from "@/lib/team-list-dock";
import { cn } from "@/lib/utils";

export const dockFullViewClass = "h-11 px-3 rounded-xl border-2 border-border bg-card font-semibold text-sm inline-flex items-center gap-1.5 hover:bg-secondary/60 shrink-0";

export function DockCloseButton({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button type="button" onClick={onClose} aria-label={label} title="Close"
      className="w-11 h-11 -mt-1 -mr-1 rounded-xl hover:bg-secondary flex items-center justify-center shrink-0">
      <X className="w-6 h-6" />
    </button>
  );
}

export function DockHeader({ icon, title, color, choices, onSwitch, onClose, closeLabel, fullView, className }: {
  icon: ReactNode;
  title: string;
  /** A coloured band across the top. */
  color?: string | null;
  /** Everything else it could show. */
  choices: DockChoice[];
  onSwitch: (choice: DockChoice["value"]) => void;
  onClose: () => void;
  closeLabel: string;
  fullView?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-3 pt-3 pb-3 border-b border-border space-y-2 flex-shrink-0", className)}
      style={color ? { borderTop: `6px solid ${color}` } : undefined}>
      <div className="flex items-start gap-2">
        {icon}
        <h2 className="flex-1 min-w-0 font-display font-bold text-lg leading-tight break-words pt-1">{title}</h2>
        <DockCloseButton onClose={onClose} label={closeLabel} />
      </div>
      <div className="flex items-center gap-2 empty:hidden">
        {choices.length > 0 ? (
          <select value="" aria-label="Switch to another list"
            onChange={e => { const v = e.target.value; if (v) onSwitch(v === TODOS_CHOICE ? TODOS_CHOICE : Number(v)); }}
            className="flex-1 min-w-0 h-11 px-2 rounded-xl border-2 border-border bg-background text-sm font-semibold">
            <option value="" disabled>Switch list…</option>
            {choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        ) : fullView ? <span className="flex-1" /> : null}
        {fullView}
      </div>
    </div>
  );
}
