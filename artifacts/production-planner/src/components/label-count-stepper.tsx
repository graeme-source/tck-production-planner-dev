/**
 * A big − / + number for choosing how many labels to print ("Print some",
 * fix-queue #374). Touch-sized for the iPad; never goes below `min` or above
 * `max` (the day's total — the server caps it there too).
 */
import { Minus, Plus } from "lucide-react";

export function LabelCountStepper({ value, min, max, onChange, label }: {
  value: number; min: number; max: number; onChange: (n: number) => void; label: string;
}) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)));
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" onClick={() => set(value - 1)} disabled={value <= min} aria-label={`One fewer: ${label}`}
        className="h-12 w-12 rounded-xl border-2 border-border bg-background inline-flex items-center justify-center hover:bg-secondary active:scale-[0.96] disabled:opacity-40">
        <Minus className="w-5 h-5" />
      </button>
      <span className="min-w-[3ch] text-center text-xl font-bold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" onClick={() => set(value + 1)} disabled={value >= max} aria-label={`One more: ${label}`}
        className="h-12 w-12 rounded-xl border-2 border-border bg-background inline-flex items-center justify-center hover:bg-secondary active:scale-[0.96] disabled:opacity-40">
        <Plus className="w-5 h-5" />
      </button>
      <span className="text-sm text-muted-foreground">of {max}</span>
    </div>
  );
}
