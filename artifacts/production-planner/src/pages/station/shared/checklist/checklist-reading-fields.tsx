/**
 * "Record a reading" on a checklist item (issues #87 and #169, Objective D):
 * one big number box per reading (e.g. Scale 1, Scale 2 for the Monday
 * scale calibration), autosaved with a visible save state (charter rule 5)
 * and filed with who and when. The pass verdict and what's still missing
 * come back from the server with the checklist (routes/checklists.ts).
 *
 * Server: PUT /api/checklist-readings.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { parseReadingText, cleanReadingTyping, readingRangeText } from "@/lib/checklist-reading-input";
import type { ChecklistItem, ChecklistItemReading } from "./use-station-checklist";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function saveReading(body: { templateId: number; planId: number; stationType: string; label: string; value: number }): Promise<void> {
  const res = await fetch(`${BASE}/api/checklist-readings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (err.code === "PIN_REQUIRED") throw new Error("Enter your PIN, then type the reading again");
    throw new Error(err.error ?? `Couldn't save (${res.status})`);
  }
}

export function ChecklistReadingFields({ item, planId, stationType, onSaved, readOnly }: {
  item: ChecklistItem;
  planId: number;
  stationType: string;
  onSaved: () => void;
  /** The item is already ticked: readings can still be corrected. */
  readOnly?: boolean;
}) {
  const unit = item.readingUnit ?? "";
  const labels = item.readingLabels?.length ? item.readingLabels : [""];
  const range = readingRangeText(item.readingMin, item.readingMax, unit);
  const missing = item.readingsMissing ?? [];

  return (
    <div className="mb-4 rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-base font-bold">
          <Gauge className="w-5 h-5 text-primary" />
          {labels.length > 1 ? "Record the readings" : "Record the reading"}
        </p>
        {range && <span className="text-sm font-semibold text-muted-foreground">{range}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {labels.map(label => (
          <ReadingField
            key={`${item.id}:${label}`}
            templateId={item.id}
            planId={planId}
            stationType={stationType}
            label={label}
            unit={unit}
            saved={(item.readings ?? []).find(r => r.label === label) ?? null}
            onSaved={onSaved}
          />
        ))}
      </div>
      {!readOnly && missing.length > 0 && (
        <p className="text-sm font-medium text-muted-foreground">
          {missing.length === labels.length
            ? "Enter the reading to tick this off."
            : `Still to enter: ${missing.filter(Boolean).join(", ")}`}
        </p>
      )}
    </div>
  );
}

function ReadingField({ templateId, planId, stationType, label, unit, saved, onSaved }: {
  templateId: number;
  planId: number;
  stationType: string;
  label: string;
  unit: string;
  saved: ChecklistItemReading | null;
  onSaved: () => void;
}) {
  const [text, setText] = useState(saved ? String(saved.value) : "");
  const [touched, setTouched] = useState(false);
  // The checklist polls every few seconds: fill the box from a saved reading
  // (e.g. entered on another iPad) only while nobody is typing in it here.
  useEffect(() => {
    if (!touched && saved) setText(String(saved.value));
  }, [saved?.value, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  const auto = useAutosave(async (value: number) => {
    await saveReading({ templateId, planId, stationType, label, value });
    onSaved();
  });

  const parsed = parseReadingText(text);
  const change = (next: string) => {
    const clean = cleanReadingTyping(next);
    setText(clean);
    setTouched(true);
    const p = parseReadingText(clean);
    if (typeof p === "number") auto.schedule(p);
    else auto.discard(p === null ? "idle" : "dirty");
  };

  const verdict = saved && auto.state !== "dirty" && auto.state !== "saving" ? saved.inRange : null;
  const id = `reading-${templateId}-${label || "value"}`;

  return (
    <div className={cn(
      "rounded-xl border-2 bg-card p-3 space-y-2",
      verdict === false ? "border-red-400" : verdict === true ? "border-emerald-400" : "border-border",
    )}>
      {label && <label htmlFor={id} className="block text-base font-semibold">{label}</label>}
      <div className="flex items-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={e => change(e.target.value)}
          onBlur={() => void auto.flush()}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="0"
          aria-label={label ? `${label} reading` : "Reading"}
          className={cn(
            "w-36 h-14 rounded-xl border-2 bg-background px-3 text-2xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40",
            parsed === undefined || auto.state === "error" ? "border-destructive" : "border-border",
          )}
        />
        <span className="text-xl font-semibold text-muted-foreground">{unit}</span>
        {verdict === true && <CheckCircle2 className="w-6 h-6 text-emerald-600 ml-auto" aria-label="In range" />}
        {verdict === false && <AlertTriangle className="w-6 h-6 text-red-600 ml-auto" aria-label="Out of range" />}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-5">
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
        {saved && auto.state !== "dirty" && auto.state !== "saving" && (
          <span className="text-sm text-muted-foreground">
            {saved.recordedByName} · {new Date(saved.recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {parsed === undefined && <p className="text-sm text-destructive">Numbers only, up to 2 decimal places.</p>}
      {verdict === false && (
        <p className="text-sm font-semibold text-red-700 dark:text-red-400">
          Outside the pass range — tell your manager and log it in the notes.
        </p>
      )}
    </div>
  );
}
