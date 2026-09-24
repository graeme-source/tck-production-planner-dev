/**
 * "Run rate restart allowance" (Graeme, 2026-09-24) — the standard minutes
 * added to each break in the TCK run rate for getting back up and running
 * (default 7). It only affects the run rate; the break timers themselves
 * keep using Break Durations above. Lives in its own file so the Settings
 * page only gains one line. Autosaves with a visible save state.
 */
import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";

const KEY = "run_rate_restart_allowance_minutes";
const DEFAULT = "7";

export function RunRateAllowanceSetting() {
  const [value, setValue] = useState(DEFAULT);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/app-settings/${KEY}`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.value != null) setValue(String(d.value)); })
      .finally(() => { loaded.current = true; });
  }, []);

  const save = (v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 60) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState("saving");
      try {
        const r = await fetch(`/api/app-settings/${KEY}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: String(n) }),
        });
        setState(r.ok ? "saved" : "error");
      } catch {
        setState("error");
      }
    }, 600);
  };

  const n = Number(value);
  return (
    <div className="space-y-2 mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" /> TCK run rate — restart allowance
        </h2>
        <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Couldn't save — try again" : ""}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Standard minutes added to each break for getting back up and running. Only the run rate uses this — the
        break timers above are unchanged.
      </p>
      <div className="rounded-2xl border border-border bg-card p-5 flex flex-wrap items-center gap-3">
        <label htmlFor="run-rate-allowance" className="text-sm font-medium w-36">Per break</label>
        <input
          id="run-rate-allowance"
          type="number"
          min="0"
          max="60"
          step="1"
          value={value}
          onChange={e => { setValue(e.target.value); save(e.target.value); }}
          className="w-20 px-3 py-2 border border-border rounded-lg text-sm text-right"
        />
        <span className="text-sm text-muted-foreground">min</span>
        {Number.isInteger(n) && n >= 0 && (
          <span className="text-sm text-muted-foreground">
            — deducts snack + {n} and lunch + {n} (lunch only when there's a 40-minute stop in production)
          </span>
        )}
      </div>
    </div>
  );
}
