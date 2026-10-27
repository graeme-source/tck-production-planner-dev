/**
 * The Station menu (Graeme, 27 Oct 2026: "collapse a lot of the features in
 * the top bar in the stations into a single menu button — an action menu
 * for that station, like add SOPs, things we don't do very often but still
 * need... and add this 'What's changed in this station?'"). Objectives F, H.
 *
 * One clearly labelled button, big enough for gloved fingers, with a red
 * "N new" dot while this person has unseen changes on this station. The
 * station passes its own rarely-used actions in; "What's changed in this
 * station?" is always first.
 */
import { useState } from "react";
import type React from "react";
import { MoreHorizontal, Sparkles } from "lucide-react";
import { newDotLabel } from "@workspace/station-changes";
import { cn } from "@/lib/utils";
import { useStationChangesFor } from "./api";
import { WhatsChangedHost } from "./whats-changed";

export interface StationMenuItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
  onSelect: () => void;
}

export function StationMenu({ stationType, stationLabel, items, className }: {
  stationType: string;
  stationLabel: string;
  items: StationMenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const { unseen } = useStationChangesFor(stationType);
  const dot = newDotLabel(unseen);

  const all: StationMenuItem[] = [
    { key: "whats-changed", label: "What's changed in this station?", icon: Sparkles, iconClass: "text-primary", onSelect: () => setChangesOpen(true) },
    ...items,
  ];

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        data-tour="station-menu"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={dot ? `Station menu, ${unseen} new change${unseen === 1 ? "" : "s"}` : "Station menu"}
        className={cn(
          "relative flex items-center gap-2 h-11 px-3 sm:px-4 rounded-xl border-2 text-sm font-bold transition-colors",
          open ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:bg-secondary/60",
        )}
      >
        <MoreHorizontal className="w-5 h-5" />
        <span className="hidden sm:inline">Station menu</span>
        {dot && (
          <span className="absolute -top-2 -right-2 min-w-6 h-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center ring-2 ring-card tabular-nums">
            {dot}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 top-full mt-2 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card shadow-xl overflow-hidden py-1.5">
            {all.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  role="menuitem"
                  type="button"
                  onClick={() => { setOpen(false); item.onSelect(); }}
                  className="w-full flex items-center gap-3 px-4 min-h-14 py-2 text-base font-semibold text-left hover:bg-secondary/60 active:bg-secondary transition-colors"
                >
                  <Icon className={cn("w-5 h-5 flex-shrink-0", item.iconClass ?? "text-muted-foreground")} />
                  <span className="flex-1">{item.label}</span>
                  {item.key === "whats-changed" && unseen > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold">{unseen} new</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      <WhatsChangedHost
        stationType={stationType}
        stationLabel={stationLabel}
        open={changesOpen}
        onClose={() => setChangesOpen(false)}
      />
    </div>
  );
}

/** A standalone "What's changed?" button for station screens that don't use
 *  StationLayout (Order Packing Live is the packing station's screen). */
export function WhatsChangedButton({ stationType, stationLabel, className }: {
  stationType: string;
  stationLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { unseen } = useStationChangesFor(stationType);
  const dot = newDotLabel(unseen);
  return (
    <>
      <button
        type="button"
        data-tour="station-menu"
        onClick={() => setOpen(true)}
        className={cn("relative inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-border text-sm font-bold hover:bg-secondary/60", className)}
      >
        <Sparkles className="w-5 h-5 text-primary" />
        What's changed?
        {dot && (
          <span className="absolute -top-2 -right-2 min-w-6 h-6 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center ring-2 ring-card tabular-nums">
            {dot}
          </span>
        )}
      </button>
      <WhatsChangedHost stationType={stationType} stationLabel={stationLabel} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
