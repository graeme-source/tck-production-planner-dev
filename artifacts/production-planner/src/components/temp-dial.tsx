// Big-buttoned temperature dial: − / + nudge 0.1°C (hold to spin), slider
// underneath for coarse jumps. No keyboard needed — far easier than typing
// "3.2" on an iPad with cold hands. Extracted from the fridge/freezer
// checklist so goods-in (and anything else recording a temperature) uses
// the same control (Graeme, 2026-09-14).
import { useEffect, useRef } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function TempDial({ value, min, max, out, onStep, onSet }: {
  value: number;
  min: number;
  max: number;
  /** Out of the acceptable band — paints the reading red. */
  out: boolean;
  onStep: (delta: number) => void;
  onSet: (v: number) => void;
}) {
  const holdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = () => { if (holdRef.current) { clearInterval(holdRef.current); holdRef.current = null; } };
  const startHold = (delta: number) => {
    onStep(delta);
    stopHold();
    holdRef.current = setInterval(() => onStep(delta), 120);
  };
  useEffect(() => stopHold, []);
  const btnClass = "w-12 h-12 rounded-xl border-2 border-border bg-background hover:bg-secondary/60 active:scale-95 flex items-center justify-center select-none touch-none shrink-0";
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onPointerDown={() => startHold(-0.1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onContextMenu={e => e.preventDefault()}
          className={btnClass}
        >
          <Minus className="w-5 h-5" />
        </button>
        <div className={cn(
          "flex-1 text-center text-3xl font-display font-bold tabular-nums leading-none whitespace-nowrap",
          out ? "text-red-600 dark:text-red-400" : "text-foreground",
        )}>
          {value.toFixed(1)}<span className="text-lg font-semibold text-muted-foreground">°C</span>
        </div>
        <button
          type="button"
          onPointerDown={() => startHold(0.1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onContextMenu={e => e.preventDefault()}
          className={btnClass}
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={e => onSet(Number(e.target.value))}
        className="w-full h-2 accent-primary cursor-pointer"
      />
    </div>
  );
}
