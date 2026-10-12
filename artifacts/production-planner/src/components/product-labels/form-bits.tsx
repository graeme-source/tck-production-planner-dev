/**
 * Small form controls shared by the label design page and its cooking-tiers
 * card (moved out of pages/product-label-settings.tsx, 2026-10-12).
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const labelInputCls = "h-11 rounded-xl border-2 border-border bg-card px-3 text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60";

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
      className={cn("min-h-11 px-4 py-2 rounded-full border-2 text-sm font-bold text-left", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
      {on ? "✓ " : ""}{label}
    </button>
  );
}

/** Number box that keeps what's typed while focused ("6." is fine) and
 *  hands back a clamped number — or null when blank and allowBlank. */
export function Num({ label, unit, value, step, min, max, allowBlank, placeholder, onChange }: {
  label: string; unit?: string; value: number | null; step: number; min: number; max: number; allowBlank?: boolean; placeholder?: string;
  onChange: (v: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value == null ? "" : String(value)); }, [value, focused]);
  const commit = (t: string) => {
    if (t.trim() === "") { if (allowBlank) onChange(null); return; }
    const n = Number(t);
    if (!Number.isFinite(n)) return;
    onChange(Math.min(max, Math.max(min, Math.round(n / step) * step)));
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(text); }}
          onChange={e => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n); else if (allowBlank && e.target.value.trim() === "") onChange(null); }}
          className={cn(labelInputCls, "w-24")}
        />
        {unit && <span className="text-muted-foreground text-sm">{unit}</span>}
      </span>
    </label>
  );
}
