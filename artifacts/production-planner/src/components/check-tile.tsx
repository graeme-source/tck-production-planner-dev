/**
 * One compact check panel on the Create / Edit Plan screens (Graeme,
 * 16 Oct 2026: "combine them on one row … hide the explanatory text by
 * default — click the panel to show how it's worked out"). Objective A.
 *
 * The tile shows its headline, status colour and action buttons only; a tap
 * anywhere else on it opens its details, which PlanChecksRow draws full width
 * below the row so the three tiles stay side by side.
 */
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type CheckTone = "ok" | "info" | "amber" | "orange" | "red" | "neutral";

export const CHECK_TONE: Record<CheckTone, { box: string; text: string }> = {
  ok: { box: "border-emerald-500/70 bg-emerald-500/5", text: "text-emerald-800 dark:text-emerald-200" },
  info: { box: "border-sky-400 bg-sky-500/5", text: "text-sky-800 dark:text-sky-200" },
  amber: { box: "border-amber-400 bg-amber-500/10", text: "text-amber-800 dark:text-amber-200" },
  orange: { box: "border-orange-500 bg-orange-500/10", text: "text-orange-800 dark:text-orange-200" },
  red: { box: "border-red-500 bg-red-500/10", text: "text-red-700 dark:text-red-300" },
  neutral: { box: "border-border bg-card", text: "text-foreground" },
};

/** A small button inside a tile — never toggles the tile itself. */
export function TileButton({ onClick, children, primary, small, title, className }: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
  /** The slim size that fits inside a header pill. */
  small?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick(); }}
      onKeyDown={e => e.stopPropagation()}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl font-semibold whitespace-nowrap",
        small ? "h-7 px-2 text-xs [&>svg]:size-3.5" : "h-10 px-3 text-sm",
        primary ? "bg-primary text-primary-foreground font-bold hover:bg-primary/90" : "border border-border bg-background hover:bg-secondary/60",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function CheckTile({ tone, expanded, onToggle, icon, headline, sub, actions, footer, label, compact, details, pillAction }: {
  tone: CheckTone;
  expanded: boolean;
  onToggle: () => void;
  icon: ReactNode;
  headline: ReactNode;
  /** One short line under the headline (optional). */
  sub?: ReactNode;
  /** Buttons on the right (Change limit / margin / levels, one fix). */
  actions?: ReactNode;
  /** A short call to action under the headline row (e.g. a suggestion + Apply). */
  footer?: ReactNode;
  /** Accessible name for the expand toggle. */
  label: string;
  /** A one-line pill (the Create Plan header) instead of a tile: tapping it
   *  opens `details`, the footer and the actions in a pop-over. */
  compact?: boolean;
  /** The "how it's worked out" contents — only used when compact. */
  details?: ReactNode;
  /** The one fix worth a tap without opening the pill (compact only). */
  pillAction?: ReactNode;
}) {
  const t = CHECK_TONE[tone];
  if (compact) {
    return (
      <CheckPill tone={tone} open={expanded} onToggle={onToggle} icon={icon} headline={headline} sub={sub} label={label} action={pillAction}>
        {footer}
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        {details}
      </CheckPill>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${label} — ${expanded ? "hide" : "show"} how it's worked out`}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      className={cn(
        "@container/tile min-w-0 rounded-2xl border-2 p-3 cursor-pointer select-none transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        t.box,
        expanded && "ring-2 ring-primary/40",
      )}
    >
      {/* Narrow (three across): buttons under the headline. Wide (stacked on
          iPad portrait): buttons beside it, so each tile stays one line. */}
      <div className="h-full flex flex-col gap-2 @min-[20rem]/tile:flex-row @min-[20rem]/tile:flex-wrap @min-[20rem]/tile:items-start">
        <div className="flex items-start gap-2 @min-[20rem]/tile:flex-1 @min-[20rem]/tile:min-w-0">
          <span className="flex-shrink-0 mt-0.5">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold leading-snug">{headline}</div>
            {sub && <div className={cn("text-sm font-semibold", t.text)}>{sub}</div>}
          </div>
          <span className="flex-shrink-0 text-muted-foreground mt-0.5 @min-[20rem]/tile:hidden" aria-hidden>
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </span>
        </div>
        {footer && <div className="@min-[20rem]/tile:order-last @min-[20rem]/tile:basis-full">{footer}</div>}
        {actions && <div className="flex flex-wrap gap-2 mt-auto @min-[20rem]/tile:mt-0">{actions}</div>}
        <span className="hidden @min-[20rem]/tile:block flex-shrink-0 text-muted-foreground mt-2" aria-hidden>
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </span>
      </div>
    </div>
  );
}

/**
 * A check as one slim pill (~40 px) for the Create Plan header bar (Graeme,
 * 27 Nov 2026: "the big three indicators at the top … smaller height-wise …
 * push those into the header banner"). Same colours as the tile; tapping it
 * opens everything the tile and its details showed in a pop-over, which has
 * its own X and closes on Esc or a tap outside.
 */
export function CheckPill({ tone, open, onToggle, icon, headline, sub, label, action, children }: {
  tone: CheckTone;
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  headline: ReactNode;
  sub?: ReactNode;
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const t = CHECK_TONE[tone];
  return (
    <Popover open={open} onOpenChange={v => { if (v !== open) onToggle(); }}>
      <div className={cn("inline-flex items-center gap-1 h-10 max-w-full min-w-0 rounded-xl border-2 pr-1", t.box, open && "ring-2 ring-primary/40")}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} — ${open ? "hide" : "show"} how it's worked out`}
            className="flex items-center gap-1.5 h-full min-w-0 pl-2 pr-1 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="flex-shrink-0 [&>svg]:size-4">{icon}</span>
            <span className="text-sm font-bold whitespace-nowrap truncate min-w-0">{headline}</span>
            {sub && <span className={cn("text-xs font-semibold truncate min-w-0", t.text)}>· {sub}</span>}
            <span className="flex-shrink-0 text-muted-foreground" aria-hidden>
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </button>
        </PopoverTrigger>
        {action}
      </div>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-[min(46rem,calc(100vw-1.5rem))] p-0 rounded-2xl border-0 bg-card shadow-xl"
      >
        {/* The tone's tint sits over a solid card so the table never shows through. */}
        <div className={cn("max-h-[min(80dvh,44rem)] overflow-y-auto overscroll-contain rounded-2xl border-2 p-3 space-y-3", t.box)}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold">{label} — how it's worked out</div>
          <button type="button" onClick={onToggle} aria-label="Close"
            className="h-9 w-9 flex-shrink-0 rounded-xl border border-border bg-background hover:bg-secondary/60 inline-flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The opened tile's details, full width under the row. */
export function CheckDetails({ tone, title, onClose, children }: {
  tone: CheckTone;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border-2 p-4 space-y-3", CHECK_TONE[tone].box)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-muted-foreground">{title}</div>
        <button type="button" onClick={onClose} className="h-9 px-3 rounded-xl border border-border bg-background text-sm font-semibold hover:bg-secondary/60 inline-flex items-center gap-1">
          <ChevronUp className="w-4 h-4" /> Hide
        </button>
      </div>
      {children}
    </div>
  );
}
