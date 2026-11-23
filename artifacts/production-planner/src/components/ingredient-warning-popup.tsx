/**
 * The ingredient warning pop-up on the Mixing and Building screens (Fix
 * queue #404, Dave Bewsey; Graeme approved 20 Nov 2026). Objective D.
 *
 * When the recipe on screen uses an ingredient that carries a station
 * warning ("Please be vigilant for bones…"), this covers the screen until
 * the person taps "Got it" — once per person, per recipe, per day
 * (lib/ingredient-warning.ts). "Report incident" opens the normal accident /
 * incident form, photos and all. Each "Got it" is written to the dismissed
 * warnings log so a manager can see who read it.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ReportIncidentModal } from "@/components/report-incident-modal";
import { londonToday } from "@/lib/station-training";
import { logWarning } from "@/lib/warning-log";
import {
  SEEN_STORAGE_KEY, STATION_WARNINGS_KEY, markSeen, parseSeen, warningsToShow,
  type SeenToday, type StationWarningsResponse,
} from "@/lib/ingredient-warning";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useStationWarnings() {
  return useQuery({
    queryKey: STATION_WARNINGS_KEY,
    queryFn: async (): Promise<StationWarningsResponse> => {
      const res = await fetch(`${BASE}/api/ingredient-station-warnings`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the ingredient warnings (${res.status})`);
      return res.json() as Promise<StationWarningsResponse>;
    },
    staleTime: 5 * 60_000,
  });
}

function readSeen(): SeenToday | null {
  try { return parseSeen(localStorage.getItem(SEEN_STORAGE_KEY)); } catch { return null; }
}

export function IngredientWarningPopup({ recipeId, recipeName, station }: {
  recipeId: number | null | undefined;
  recipeName?: string | null;
  /** "Mixing" / "Building" — for the dismissed-warnings log. */
  station: string;
}) {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : 0;
  const { data } = useStationWarnings();
  // In-memory copy too, so "Got it" still sticks if the iPad blocks storage.
  const [seen, setSeen] = useState<SeenToday | null>(readSeen);
  const [incidentOpen, setIncidentOpen] = useState(false);

  const today = londonToday();
  const warnings = warningsToShow({
    warnings: recipeId != null ? data?.byRecipe[String(recipeId)] : undefined,
    recipeId, userId, today, seen,
  });

  const acknowledge = (action: "got_it" | "report_incident") => {
    if (recipeId == null || warnings.length === 0) return;
    const next = markSeen(readSeen() ?? seen, { warnings, recipeId, userId, today });
    setSeen(next);
    try { localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(next)); } catch { /* in-memory only */ }
    logWarning("ingredient_warning", action, `${station}${recipeName ? ` · ${recipeName}` : ""}: ${warnings.map(w => w.ingredientName).join(", ")}`);
  };

  return (
    <>
      {warnings.length > 0 && !incidentOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-modal="true" aria-label="Ingredient warning">
          <div className="relative bg-card border-4 border-amber-500 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col">
            <button
              type="button"
              onClick={() => acknowledge("got_it")}
              aria-label="Close"
              className="absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 space-y-5">
              <div className="flex items-center gap-3 pr-10">
                <span className="w-14 h-14 shrink-0 rounded-2xl bg-amber-500 text-white flex items-center justify-center">
                  <ShieldAlert className="w-8 h-8" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Warning</p>
                  {recipeName && <h2 className="text-2xl font-extrabold leading-tight break-words">{recipeName}</h2>}
                </div>
              </div>
              {warnings.map(w => (
                <div key={w.ingredientId} className="space-y-1">
                  <p className="text-base font-semibold text-muted-foreground break-words">{w.ingredientName}</p>
                  <p className="text-2xl sm:text-3xl font-bold leading-snug break-words">{w.warning}</p>
                </div>
              ))}
            </div>
            <div className="shrink-0 p-4 sm:p-6 pt-0 sm:pt-0 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => { acknowledge("report_incident"); setIncidentOpen(true); }}
                className="min-h-16 px-4 rounded-2xl border-2 border-red-700 text-red-700 dark:text-red-400 text-lg font-bold flex items-center justify-center gap-2"
              >
                <ShieldAlert className="w-6 h-6" /> Report incident
              </button>
              <button
                type="button"
                onClick={() => acknowledge("got_it")}
                className="min-h-16 px-4 rounded-2xl bg-primary text-primary-foreground text-xl font-extrabold"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
      <ReportIncidentModal open={incidentOpen} onClose={() => setIncidentOpen(false)} />
    </>
  );
}
