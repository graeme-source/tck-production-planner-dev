/**
 * Autosaving fields for Reviews & warnings — every one shows its save state
 * (charter rule 5) through hooks/use-autosave.ts + SaveChip. Typing saves
 * ~0.8s after you stop, straight away on blur, and on close if anything is
 * still pending; a failed save shows the error with Retry and keeps the text.
 */
import { useState, type ReactNode } from "react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { cn } from "@/lib/utils";

const inputBase = "w-full rounded-2xl border-2 bg-card px-4 text-lg focus:outline-none focus:ring-2 focus:ring-primary/40";

export function FieldLabel({ children, chip }: { children: ReactNode; chip?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-base font-bold">{children}</span>
      {chip}
    </div>
  );
}

/** Text that autosaves. `rows` > 1 = a textarea. */
export function AutoText({ label, initial, onSave, rows = 1, placeholder, maxLength = 20000 }: {
  label: string;
  initial: string | null;
  onSave: (value: string) => Promise<unknown>;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}) {
  const [value, setValue] = useState(initial ?? "");
  const auto = useAutosave(onSave);
  const change = (next: string) => { setValue(next); auto.schedule(next); };
  const cls = cn(inputBase, auto.state === "error" ? "border-destructive" : "border-border");
  return (
    <label className="block space-y-1.5">
      <FieldLabel chip={<SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}>{label}</FieldLabel>
      {rows > 1 ? (
        <textarea
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={e => change(e.target.value)}
          onBlur={() => void auto.flush()}
          className={cn(cls, "py-3 leading-relaxed resize-y min-h-[3.5rem]")}
        />
      ) : (
        <input
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={e => change(e.target.value)}
          onBlur={() => void auto.flush()}
          className={cn(cls, "h-14")}
        />
      )}
    </label>
  );
}

/** A date that saves as soon as it's picked (or cleared). */
export function AutoDate({ label, initial, onSave, min }: {
  label: string;
  initial: string | null;
  onSave: (value: string | null) => Promise<unknown>;
  min?: string;
}) {
  const [value, setValue] = useState(initial ?? "");
  const auto = useAutosave((v: string) => onSave(v === "" ? null : v), 0);
  return (
    <label className="block space-y-1.5">
      <FieldLabel chip={<SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}>{label}</FieldLabel>
      <input
        type="date"
        value={value}
        min={min}
        onChange={e => { setValue(e.target.value); auto.schedule(e.target.value); }}
        className={cn(inputBase, "h-14 font-bold", auto.state === "error" ? "border-destructive" : "border-border")}
      />
    </label>
  );
}

/** A time (HH:MM) that saves as soon as it's picked (or cleared). */
export function AutoTime({ label, initial, onSave }: {
  label: string;
  initial: string | null;
  onSave: (value: string | null) => Promise<unknown>;
}) {
  const [value, setValue] = useState(initial ?? "");
  const auto = useAutosave((v: string) => onSave(v === "" ? null : v), 300);
  return (
    <label className="block space-y-1.5">
      <FieldLabel chip={<SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}>{label}</FieldLabel>
      <input
        type="time"
        value={value}
        onChange={e => { setValue(e.target.value); auto.schedule(e.target.value); }}
        onBlur={() => void auto.flush()}
        className={cn(inputBase, "h-14 font-bold", auto.state === "error" ? "border-destructive" : "border-border")}
      />
    </label>
  );
}

/** Tick-boxes that save the moment one is ticked. */
export function AutoChecklist({ label, items, initial, onSave }: {
  label: string;
  items: Array<{ key: string; label: string }>;
  initial: string[];
  onSave: (keys: string[]) => Promise<unknown>;
}) {
  const [ticked, setTicked] = useState<string[]>(initial);
  const auto = useAutosave(onSave, 0);
  const toggle = (k: string) => {
    const next = ticked.includes(k) ? ticked.filter(x => x !== k) : [...ticked, k];
    setTicked(next);
    auto.schedule(next);
  };
  return (
    <div className="space-y-1.5">
      <FieldLabel chip={<SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}>{label}</FieldLabel>
      <div className="space-y-2">
        {items.map(i => (
          <label key={i.key} className="flex items-start gap-3 min-h-14 px-4 py-3 rounded-2xl border-2 border-border bg-card cursor-pointer">
            <input type="checkbox" checked={ticked.includes(i.key)} onChange={() => toggle(i.key)} className="w-6 h-6 mt-0.5 shrink-0 accent-primary" />
            <span className="text-base font-semibold leading-snug">{i.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Big choice chips that save the moment one is tapped. */
export function AutoChoice<T extends string | number>({ label, value, options, onSave, allowClear, columns = 3, pills = false }: {
  label: string;
  value: T | null;
  options: Array<{ value: T; label: string; hint?: string; tone?: "warn" }>;
  onSave: (value: T | null) => Promise<unknown>;
  allowClear?: string;
  columns?: 2 | 3;
  /** Compact wrapping pills — for long lists such as classifications. */
  pills?: boolean;
}) {
  const [current, setCurrent] = useState<T | null>(value);
  const auto = useAutosave((v: T | null) => onSave(v), 0);
  const pick = (v: T | null) => { setCurrent(v); auto.schedule(v); };
  const opts: Array<{ value: T | null; label: string; hint?: string; tone?: "warn" }> = allowClear
    ? [{ value: null, label: allowClear }, ...options]
    : options;
  return (
    <div className="space-y-1.5">
      <FieldLabel chip={<SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}>{label}</FieldLabel>
      {pills ? (
        <div className="flex flex-wrap gap-2">
          {opts.map(o => (
            <PillButton key={String(o.value)} selected={current === o.value} onClick={() => pick(o.value)}>{o.label}</PillButton>
          ))}
        </div>
      ) : (
      <div className={cn("grid gap-2 grid-cols-1 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
        {opts.map(o => (
          <ChoiceButton key={String(o.value)} selected={current === o.value} onClick={() => pick(o.value)} hint={o.hint} tone={o.tone}>
            {o.label}
          </ChoiceButton>
        ))}
      </div>
      )}
    </div>
  );
}

export function PillButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cn("min-h-12 px-4 py-2 rounded-full border-2 text-base font-bold leading-tight transition-colors",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary/50")}>
      {children}
    </button>
  );
}

export function ChoiceButton({ selected, onClick, children, hint, tone, disabled }: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  tone?: "warn";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "min-h-14 px-4 py-2 rounded-2xl border-2 text-left transition-colors disabled:opacity-50",
        selected
          ? tone === "warn" ? "border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200" : "border-primary bg-primary/10 text-primary"
          : "border-border hover:bg-secondary/50",
      )}
    >
      <span className="block text-lg font-bold leading-snug">{children}</span>
      {hint && <span className="block text-sm text-muted-foreground leading-snug">{hint}</span>}
    </button>
  );
}
