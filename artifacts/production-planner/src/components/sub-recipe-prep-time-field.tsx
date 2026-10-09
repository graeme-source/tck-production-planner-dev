/**
 * Standard prep time for a sub-recipe — minutes to make ONE mix (its yield)
 * (Graeme, 2026-10-09; Objectives C/E). Typed straight in and autosaved
 * with a visible save state (charter rule 5); saved on its own endpoint so
 * it never waits for the big sub-recipe Save.
 *
 * Only used to pre-fill "How long to make it again?" when the sub-recipe is
 * wasted (scaled by the amount wasted ÷ the mix's yield).
 * Server: GET/PUT /api/sub-recipes/:id/standard-prep-minutes.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const url = (id: number) => `${BASE}/api/sub-recipes/${id}/standard-prep-minutes`;

async function savePrepMinutes(id: number, minutes: number | null): Promise<void> {
  const res = await fetch(url(id), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ standardPrepMinutes: minutes }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Couldn't save (${res.status})`);
  }
}

/** "" → null (not known); a whole number 1–1440 → it; anything else → undefined (invalid). */
function parseMinutes(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= 1440 ? n : undefined;
}

export function SubRecipePrepTimeField({ subRecipeId, yieldText }: { subRecipeId: number; yieldText: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["sub-recipe-prep-minutes", subRecipeId],
    queryFn: async () => {
      const res = await fetch(url(subRecipeId), { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load (${res.status})`);
      return ((await res.json()) as { standardPrepMinutes: number | null }).standardPrepMinutes;
    },
  });
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded && q.isSuccess) { setText(q.data == null ? "" : String(q.data)); setLoaded(true); }
  }, [q.isSuccess, q.data, loaded]);

  const auto = useAutosave(async (minutes: number | null) => {
    await savePrepMinutes(subRecipeId, minutes);
    qc.setQueryData(["sub-recipe-prep-minutes", subRecipeId], minutes);
    // The waste form's list carries it for the pre-fill.
    void qc.invalidateQueries({ queryKey: ["defects", "items"] });
  });

  const parsed = parseMinutes(text);
  const change = (next: string) => {
    const clean = next.replace(/[^\d]/g, "").slice(0, 4);
    setText(clean);
    const p = parseMinutes(clean);
    if (p !== undefined) auto.schedule(p);
  };

  return (
    <div className="rounded-2xl border-2 border-border bg-secondary/10 p-4 space-y-2">
      <label htmlFor={`prep-min-${subRecipeId}`} className="flex items-center gap-2 text-base font-bold">
        <Clock className="w-5 h-5 text-primary" /> Standard prep time
      </label>
      <p className="text-sm text-muted-foreground">Minutes to make one mix ({yieldText}). Used to work out the time lost when some is wasted.</p>
      {q.isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">Couldn't load it — {(q.error as Error).message}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <input
              id={`prep-min-${subRecipeId}`}
              inputMode="numeric"
              value={text}
              onChange={e => change(e.target.value)}
              onBlur={() => void auto.flush()}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="e.g. 20"
              className={cn(
                "w-28 h-12 rounded-xl border-2 bg-card px-3 text-lg font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40",
                parsed === undefined || auto.state === "error" ? "border-destructive" : "border-border",
              )}
            />
            <span className="text-base text-muted-foreground">min</span>
          </div>
          <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
        </div>
      )}
      {parsed === undefined && <p className="text-sm text-destructive">Whole minutes, 1 to 1440 — or leave it empty if you don't know.</p>}
    </div>
  );
}
