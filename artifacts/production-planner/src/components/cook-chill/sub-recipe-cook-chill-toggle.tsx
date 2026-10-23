/**
 * The "Cook and chill" tick on a sub-recipe (issue #244, Objective D): ticked
 * = it's cooked and must be cooled, so Prep records its cook-out core temp
 * and blast-chiller time and Wrapping ticks "chilling finished". Saves the
 * moment it's tapped, with a visible save state (charter rule 5), on its own
 * endpoint so it never waits for the big sub-recipe Save.
 * Server: GET/PUT /api/cook-chill/sub-recipes/:id/flag.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ThermometerSnowflake } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { COOK_CHILL_SUB_RECIPES_KEY } from "@/lib/cook-chill-view";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const url = (id: number) => `${BASE}/api/cook-chill/sub-recipes/${id}/flag`;
const key = (id: number) => ["cook-chill", "flag", id] as const;

export function SubRecipeCookChillToggle({ subRecipeId }: { subRecipeId: number }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: key(subRecipeId),
    queryFn: async () => {
      const res = await fetch(url(subRecipeId), { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load (${res.status})`);
      return ((await res.json()) as { cookChillRequired: boolean }).cookChillRequired;
    },
  });

  const auto = useAutosave(async (next: boolean) => {
    const res = await fetch(url(subRecipeId), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookChillRequired: next }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      qc.setQueryData(key(subRecipeId), !next);
      throw new Error(body.error ?? `Couldn't save (${res.status})`);
    }
    void qc.invalidateQueries({ queryKey: COOK_CHILL_SUB_RECIPES_KEY });
  }, 0);

  const checked = q.data === true;
  const toggle = (next: boolean) => {
    qc.setQueryData(key(subRecipeId), next);
    auto.schedule(next);
  };

  return (
    <div className="rounded-2xl border-2 border-border bg-secondary/10 p-4 space-y-2">
      {q.isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">Couldn't load the cook-and-chill setting — {(q.error as Error).message}</p>
      ) : (
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => toggle(e.target.checked)}
            className="mt-1 w-6 h-6 accent-primary"
          />
          <span className="flex-1">
            <span className="flex flex-wrap items-center gap-2 text-base font-bold">
              <ThermometerSnowflake className="w-5 h-5 text-cyan-600" /> Cook and chill
              <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
            </span>
            <span className="block text-sm text-muted-foreground">
              Tick if this is cooked and then cooled (e.g. a confit or a cooked butter). Prep records the core
              temperature at cook-out and when it goes into the blast chiller; Wrapping ticks when chilling is finished.
              All of it shows in Analytics → HACCP.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
