/**
 * The four numbers behind a chicken run, editable by an admin.
 *
 * They live in app_settings and were seeded by migration 0074, which meant the
 * only way to change one was a SQL console. They belong on the screen that
 * uses them — and they cannot go on the Settings page, which the charter
 * closes to new code, so they sit here behind a disclosure on the planning
 * dialog.
 *
 * Every field autosaves and says so (charter rule 5). No silent catch: a
 * failed save turns the field red and keeps what was typed.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, AlertTriangle, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const FRIED_CHICKEN_SETTINGS = [
  {
    key: "fried_chicken_default_raw_kg",
    label: "Usual run size",
    unit: "kg of raw chicken",
    hint: "What a new run starts at. Still editable run by run.",
    fallback: "75",
  },
  {
    key: "fried_chicken_oil_kg_per_kg",
    label: "Oil per kg of chicken",
    unit: "kg",
    hint: "What has to be on site to fry with — most of it ends the day as waste. Not what ends up in the food; that is in the recipes.",
    fallback: "0.457",
  },
  {
    key: "fried_chicken_sales_window_days",
    label: "Sales window",
    unit: "days",
    hint: "How far back sales are read to work out each variant's share of the run.",
    fallback: "30",
  },
  {
    key: "fried_chicken_prep_days_before",
    label: "Prep runs",
    unit: "days before the run",
    hint: "Where the prep sheet shows up. 1 means a Monday run is prepped on Sunday.",
    fallback: "1",
  },
] as const;

type SaveState = "idle" | "saving" | "saved" | "error";

export function useFriedChickenSettings() {
  return useQuery<Record<string, string>>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/app-settings`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't read settings (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

/** A setting as a number, falling back to the seeded default when it is
 *  missing or unreadable — never NaN into the arithmetic. */
export function settingNumber(
  settings: Record<string, string> | undefined,
  key: string,
  fallback: number,
): number {
  const raw = settings?.[key];
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function SettingField({ setting, value, onSaved }: {
  setting: (typeof FRIED_CHICKEN_SETTINGS)[number];
  value: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Follow the server while the field is not being edited, so a save made in
  // another session shows up rather than being clobbered on next blur.
  useEffect(() => { if (state === "idle") setDraft(value); }, [value, state]);

  const save = useMutation({
    mutationFn: async (next: string) => {
      const res = await fetch(`${BASE}/api/app-settings/${encodeURIComponent(setting.key)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `Save failed (${res.status})`);
      return body as { value: string };
    },
    onMutate: () => { setState("saving"); setError(null); },
    onSuccess: () => {
      setState("saved");
      onSaved();
      setTimeout(() => setState(s => (s === "saved" ? "idle" : s)), 1500);
    },
    onError: (err: Error) => { setState("error"); setError(err.message); },
  });

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n <= 0) {
      setState("error");
      setError("Has to be a number above zero");
      return;
    }
    if (String(n) === String(Number(value))) { setState("idle"); setError(null); return; }
    save.mutate(String(n));
  };

  return (
    <div className="space-y-1.5">
      <label className="text-base font-semibold flex items-center gap-2">
        {setting.label}
        {state === "saving" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        {state === "saved" && <span className="flex items-center gap-1 text-sm font-medium text-emerald-600"><Check className="w-4 h-4" /> Saved</span>}
        {state === "error" && <span className="flex items-center gap-1 text-sm font-medium text-destructive"><AlertTriangle className="w-4 h-4" /> Not saved</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="any"
          value={draft}
          onChange={e => { setDraft(e.target.value); setState("idle"); setError(null); }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className={cn(
            "w-32 px-3 py-2.5 rounded-xl border-2 bg-background text-lg text-right tabular-nums",
            state === "error" ? "border-destructive" : "border-border",
          )}
        />
        <span className="text-base text-muted-foreground">{setting.unit}</span>
      </div>
      <p className="text-sm text-muted-foreground">{error ?? setting.hint}</p>
    </div>
  );
}

export function FriedChickenRunSettings({ settings }: { settings: Record<string, string> | undefined }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    // The suggestion is computed from these numbers server-side.
    queryClient.invalidateQueries({ queryKey: ["fried-chicken"] });
  };

  return (
    <div className="rounded-2xl border-2 border-border">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-base font-semibold hover:bg-secondary/40 rounded-2xl transition-colors"
      >
        <SlidersHorizontal className="w-5 h-5 text-muted-foreground" />
        Run settings
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 grid gap-5 sm:grid-cols-2">
          {FRIED_CHICKEN_SETTINGS.map(s => (
            <SettingField
              key={s.key}
              setting={s}
              value={settings?.[s.key] ?? s.fallback}
              onSaved={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
