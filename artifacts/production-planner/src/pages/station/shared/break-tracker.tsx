import React from "react";
import { createPortal } from "react-dom";
import { useState, useEffect, useRef } from "react";
import { Coffee, Utensils, Loader2 } from "lucide-react";
import { format, parseISO, differenceInSeconds } from "date-fns";
import { cn } from "@/lib/utils";
import { useCreateStationBreak, useEndStationBreak } from "@workspace/api-client-react";
import type { StationType } from "./constants";

interface BreakTrackerProps {
  planId: number;
  stationType: StationType;
  onBreakChange?: (activeBreakMinutes: number | null) => void;
  onBreakActiveChange?: (active: boolean) => void;
}

export interface ActiveBreak {
  id: number;
  type: "morning" | "lunch";
  startedAt: string;
}

export function BreakTracker({ planId, stationType, onBreakChange, onBreakActiveChange }: BreakTrackerProps) {
  const [activeBreak, setActiveBreak] = useState<ActiveBreak | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [defaults, setDefaults] = useState<{ breakMins: number; lunchMins: number }>({ breakMins: 15, lunchMins: 45 });
  const createBreak = useCreateStationBreak();
  const endBreak = useEndStationBreak();
  const activeBreakRef = useRef<ActiveBreak | null>(null);
  activeBreakRef.current = activeBreak;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/production-plans/${planId}/station-breaks/active`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null),
      fetch("/api/app-settings", { credentials: "include" })
        .then(r => r.ok ? r.json() : {})
        .catch(() => ({})),
    ]).then(([breakData, settings]: [{ id: number; breakType: string; startedAt: string } | null, Record<string, string>]) => {
      if (cancelled) return;
      if (settings.default_break_minutes) setDefaults(d => ({ ...d, breakMins: Number(settings.default_break_minutes) }));
      if (settings.default_lunch_minutes) setDefaults(d => ({ ...d, lunchMins: Number(settings.default_lunch_minutes) }));
      if (breakData && breakData.id) {
        setActiveBreak({ id: breakData.id, type: (breakData.breakType as "morning" | "lunch") ?? "morning", startedAt: breakData.startedAt });
        onBreakActiveChange?.(true);
      } else {
        onBreakActiveChange?.(false);
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, [planId, stationType]);

  useEffect(() => {
    if (!hydrated) return;
    let abortCtrl: AbortController | null = null;
    const poll = () => {
      abortCtrl?.abort();
      abortCtrl = new AbortController();
      fetch(`/api/production-plans/${planId}/station-breaks/active`, {
        credentials: "include",
        signal: abortCtrl.signal,
      })
        .then(r => r.ok ? r.json() : null)
        .then((breakData: { id: number; breakType: string; startedAt: string } | null) => {
          const curr = activeBreakRef.current;
          if (breakData?.id) {
            if (!curr || curr.id !== breakData.id) {
              setActiveBreak({ id: breakData.id, type: (breakData.breakType as "morning" | "lunch") ?? "morning", startedAt: breakData.startedAt });
              onBreakActiveChange?.(true);
            }
          } else if (curr) {
            setActiveBreak(null);
            onBreakChange?.(null);
            onBreakActiveChange?.(false);
          }
        })
        .catch(e => { if (e.name !== "AbortError") { /* silent */ } });
    };
    const interval = setInterval(poll, 10000);
    return () => { clearInterval(interval); abortCtrl?.abort(); };
  }, [planId, hydrated]);

  useEffect(() => {
    if (!activeBreak) {
      onBreakChange?.(null);
      setElapsedSecs(0);
      return;
    }
    const update = () => {
      const secs = differenceInSeconds(new Date(), parseISO(activeBreak.startedAt));
      setElapsedSecs(secs);
      const mins = Math.floor(secs / 60);
      onBreakChange?.(mins);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [activeBreak]);

  const startBreak = (type: "morning" | "lunch") => {
    createBreak.mutate(
      {
        id: planId,
        data: { stationType, breakType: type, startedAt: new Date().toISOString() },
      },
      {
        onSuccess: (b: { id: number; startedAt?: string | null }) => {
          setActiveBreak({ id: b.id, type, startedAt: b.startedAt! });
          onBreakActiveChange?.(true);
        },
      }
    );
  };

  const stopBreak = () => {
    if (!activeBreak) return;
    endBreak.mutate(
      {
        id: planId,
        breakId: activeBreak.id,
        data: { endedAt: new Date().toISOString() },
      },
      {
        onSuccess: () => { setActiveBreak(null); onBreakChange?.(null); onBreakActiveChange?.(false); },
      }
    );
  };

  if (!hydrated) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading break status…
      </div>
    );
  }

  const breakOverlay = activeBreak ? (() => {
    const allowedSecs = (activeBreak.type === "lunch" ? defaults.lunchMins : defaults.breakMins) * 60;
    const remainingSecs = allowedSecs - elapsedSecs;
    const overrun = elapsedSecs > allowedSecs;
    const approaching = !overrun && remainingSecs <= 120;

    const elapsedMins = Math.floor(elapsedSecs / 60);
    const elapsedSecsRem = elapsedSecs % 60;
    const elapsedLabel = `${String(elapsedMins).padStart(2, "0")}:${String(elapsedSecsRem).padStart(2, "0")}`;

    const overrunSecs = Math.max(0, elapsedSecs - allowedSecs);
    const overrunMins = Math.floor(overrunSecs / 60);
    const overrunSecsRem = overrunSecs % 60;
    const overrunLabel = `${String(overrunMins).padStart(2, "0")}:${String(overrunSecsRem).padStart(2, "0")}`;

    const remSecs = Math.max(0, remainingSecs);
    const remMins = Math.floor(remSecs / 60);
    const remSecsRem = remSecs % 60;
    const remainingLabel = `${String(remMins).padStart(2, "0")}:${String(remSecsRem).padStart(2, "0")}`;

    const timerColor = overrun
      ? "text-red-400"
      : approaching
        ? "text-amber-400"
        : "text-emerald-400";

    const ringBg = overrun
      ? "border-red-500/40"
      : approaching
        ? "border-amber-500/40"
        : "border-emerald-500/40";

    const badgeBg = overrun
      ? "bg-red-500/20 text-red-300 border border-red-500/30"
      : approaching
        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";

    const btnClass = overrun
      ? "bg-red-500 hover:bg-red-400 text-white"
      : "bg-white/10 hover:bg-white/20 text-white border border-white/20";

    const BreakIcon = activeBreak.type === "lunch" ? Utensils : Coffee;
    const breakLabel = activeBreak.type === "lunch" ? "Lunch Break" : "Snack Break";
    const allowedMins = activeBreak.type === "lunch" ? defaults.lunchMins : defaults.breakMins;

    return createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", background: "rgba(0,0,0,0.75)" }}
      >
        <div className={cn(
          "relative flex flex-col items-center gap-6 rounded-3xl border-2 p-10 shadow-2xl w-full max-w-sm mx-4",
          "bg-gray-900/95",
          ringBg
        )}>
          <div className="flex flex-col items-center gap-3">
            <div className={cn("flex items-center justify-center w-16 h-16 rounded-2xl", badgeBg)}>
              <BreakIcon className="w-8 h-8" />
            </div>
            <p className="text-white text-xl font-bold tracking-tight">{breakLabel}</p>
            <p className="text-gray-400 text-sm">
              Started {format(parseISO(activeBreak.startedAt), "HH:mm")} · {allowedMins} min allowed
            </p>
          </div>

          <div className="flex flex-col items-center gap-1">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Elapsed</p>
            <p className={cn("text-7xl font-bold font-mono tabular-nums tracking-tight", timerColor)}>
              {elapsedLabel}
            </p>
            {overrun ? (
              <p className="text-red-400 text-sm font-semibold mt-1">
                {overrunLabel} over time
              </p>
            ) : (
              <p className={cn("text-sm font-medium mt-1", approaching ? "text-amber-400" : "text-gray-400")}>
                {remainingLabel} remaining
              </p>
            )}
          </div>

          <button
            onClick={stopBreak}
            disabled={endBreak.isPending}
            className={cn(
              "w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-95",
              btnClass,
              endBreak.isPending && "opacity-60 cursor-not-allowed"
            )}
          >
            {endBreak.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Ending…
              </span>
            ) : (
              `End ${activeBreak.type === "lunch" ? "Lunch" : "Snack"} Break`
            )}
          </button>
        </div>
      </div>,
      document.body
    );
  })() : null;

  return (
    <>
      {breakOverlay}
      {!activeBreak && (
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs text-muted-foreground flex-shrink-0">Breaks:</span>
          <button
            onClick={() => startBreak("morning")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-break-action hover:opacity-90 text-break-action-foreground rounded-lg transition-colors font-medium flex-shrink-0"
          >
            <Coffee className="w-3.5 h-3.5" />
            Snack ({defaults.breakMins}m)
          </button>
          <button
            onClick={() => startBreak("lunch")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-break-action hover:opacity-90 text-break-action-foreground rounded-lg transition-colors font-medium flex-shrink-0"
          >
            <Utensils className="w-3.5 h-3.5" />
            Lunch ({defaults.lunchMins}m)
          </button>
        </div>
      )}
    </>
  );
}
