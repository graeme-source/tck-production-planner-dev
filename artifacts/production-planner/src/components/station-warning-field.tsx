/**
 * "Station warning" on the ingredient form (Fix queue #404, Dave Bewsey;
 * Graeme approved 20 Nov 2026). Objective D.
 *
 * A short safety message that pops up on the Mixing and Building screens
 * for every recipe that uses this ingredient ("Please be vigilant for
 * bones…"). Blank = no warning. Autosaves with a visible save state on
 * PUT /api/ingredient-station-warnings/:id, so it never waits for the
 * dialog's Save.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { useStationWarnings } from "@/components/ingredient-warning-popup";
import { STATION_WARNINGS_KEY, STATION_WARNING_MAX } from "@/lib/ingredient-warning";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function saveWarning(id: number, warning: string) {
  const res = await fetch(`${BASE}/api/ingredient-station-warnings/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ warning: warning.trim() ? warning : null }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(res.status === 403 ? "Managers only" : body.error ?? `Couldn't save (${res.status})`);
  }
}

export function StationWarningField({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const q = useStationWarnings();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && q.data) {
      setText(q.data.byIngredient[String(ingredientId)] ?? "");
      setLoaded(true);
    }
  }, [q.data, loaded, ingredientId]);

  const auto = useAutosave(async (value: string) => {
    await saveWarning(ingredientId, value);
    await qc.invalidateQueries({ queryKey: STATION_WARNINGS_KEY });
  });

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading station warning…</div>;
  }
  if (!q.data) {
    return <p className="text-sm text-destructive">Couldn&rsquo;t load the station warning. Close and reopen to try again.</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label htmlFor={`station-warning-${ingredientId}`} className="text-sm font-medium">Station warning — pops up on Mixing and Building</label>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>
      <textarea
        id={`station-warning-${ingredientId}`}
        value={text}
        maxLength={STATION_WARNING_MAX}
        rows={2}
        onChange={e => { setText(e.target.value); auto.schedule(e.target.value); }}
        onBlur={() => void auto.flush()}
        placeholder="e.g. Please be vigilant for bones. If any are found, fill in an incident report with pictures."
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <p className="text-xs text-muted-foreground">
        Shown full-screen, once per person a day, for every recipe that uses this ingredient. Leave blank for no warning.
      </p>
    </div>
  );
}
