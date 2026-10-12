/**
 * "What's it about?" as tick boxes (Graeme, 2026-10-12: "It could be about
 * attendance and timekeeping… we should be [able to tick a] number of
 * classifications"). Big, iPad-friendly; at least one always stays ticked;
 * the first ticked is the primary (migration 0184). Used by Schedule a
 * meeting, the review editor and the AI notes check step.
 *
 *   ClassTicks      controlled, for forms that save on a button
 *   AutoClassTicks  autosaves with a visible save state (charter rule 5)
 */
import { useState } from "react";
import { Check } from "lucide-react";
import { toggleClassId, type Classification } from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { FieldLabel } from "./review-fields";

export function ClassTicks({ classifications, value, onChange, label, chip, hint }: {
  classifications: readonly Classification[];
  value: readonly number[];
  onChange: (ids: number[]) => void;
  label?: string;
  chip?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label && <FieldLabel chip={chip}>{label}</FieldLabel>}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={label ?? "What it's about"}>
        {classifications.map(c => {
          const on = value.includes(c.id);
          const last = on && value.length === 1;
          return (
            <button key={c.id} type="button" role="checkbox" aria-checked={on} onClick={() => onChange(toggleClassId(value, c.id))}
              title={last ? "At least one has to stay ticked" : undefined}
              className={cn("min-h-14 rounded-2xl border-2 px-3 py-2 text-left flex items-center gap-3 text-base font-bold transition-colors",
                on ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/50")}>
              <span className={cn("w-7 h-7 shrink-0 rounded-lg border-2 flex items-center justify-center",
                on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                {on && <Check className="w-5 h-5" />}
              </span>
              <span className="min-w-0">{c.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Tick as many as fit — at least one.</p>
    </div>
  );
}

export function AutoClassTicks({ classifications, initial, onSave, label }: {
  classifications: readonly Classification[];
  initial: readonly number[];
  onSave: (ids: number[]) => Promise<unknown>;
  label: string;
}) {
  const [ids, setIds] = useState<number[]>([...initial]);
  const auto = useAutosave((v: number[]) => onSave(v), 0);
  return (
    <ClassTicks classifications={classifications} value={ids} label={label}
      chip={<SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
      onChange={next => { setIds(next); auto.schedule(next); }} />
  );
}
