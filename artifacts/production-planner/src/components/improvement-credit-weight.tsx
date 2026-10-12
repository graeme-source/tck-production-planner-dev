/**
 * ×2 / ×3 credits on an improvement (Graeme, 2026-10-12; Objective E).
 *
 * CreditBadge — the small "×2 — great one" mark everyone sees on a
 *   special improvement.
 * CreditWeightControl — the founder's ×1 / ×2 / ×3 buttons, on the feed
 *   card and the improvement itself. One tap saves at once; the control says
 *   "Saving…", then "Saved", or the error in red with the old value put back.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check, Sparkles } from "lucide-react";
import { FOUNDER_EMAIL } from "@workspace/feature-registry";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { CREDIT_OPTIONS, creditBadge, normaliseCreditWeight, type CreditWeight } from "@/lib/improvement-score";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useIsFounder(): boolean {
  const { state } = useAuth();
  return state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;
}

export function CreditBadge({ weight, className }: { weight: unknown; className?: string }) {
  const text = creditBadge(weight);
  if (!text) return null;
  return (
    <span
      className={cn(
        "text-xs px-2.5 py-1 rounded-lg font-extrabold whitespace-nowrap inline-flex items-center gap-1 bg-violet-600 text-white",
        className,
      )}
      title="Counts as more than one on the improvement score"
    >
      <Sparkles className="w-3.5 h-3.5" /> {text}
    </span>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function CreditWeightControl({ improvementId, weight, size = "feed" }: {
  improvementId: number;
  weight: unknown;
  size?: "feed" | "detail";
}) {
  const queryClient = useQueryClient();
  const current = normaliseCreditWeight(weight);
  const [shown, setShown] = useState<CreditWeight>(current);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Follow the server when it changes underneath (another tab, a refetch)
  // — but never while a save is in flight.
  const [lastServer, setLastServer] = useState<CreditWeight>(current);
  if (current !== lastServer) {
    setLastServer(current);
    if (saveState !== "saving") setShown(current);
  }

  const save = useMutation({
    mutationFn: async (w: CreditWeight) => {
      const res = await fetch(`${BASE}/api/improvements/${improvementId}/credit-weight`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight: w }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Couldn't save (${res.status})`);
      }
      return res.json() as Promise<{ creditWeight: number }>;
    },
    onMutate: (w) => { setShown(w); setSaveState("saving"); setError(null); },
    onSuccess: () => {
      setSaveState("saved");
      queryClient.invalidateQueries({ queryKey: ["improvements"] });
      queryClient.invalidateQueries({ queryKey: ["improvement-scoreboard"] });
    },
    onError: (e: Error) => { setShown(current); setSaveState("error"); setError(e.message); },
  });

  const big = size === "detail";
  return (
    <div className="space-y-1.5" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("font-bold text-muted-foreground", big ? "text-base" : "text-sm")}>Credits</span>
        <div className="inline-flex rounded-2xl border-2 border-border overflow-hidden" role="radiogroup" aria-label="Credits for this improvement">
          {CREDIT_OPTIONS.map(opt => {
            const on = shown === opt.weight;
            return (
              <button
                key={opt.weight}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={save.isPending}
                onClick={() => { if (!on) save.mutate(opt.weight); }}
                title={opt.hint}
                className={cn(
                  "flex flex-col items-center justify-center font-bold transition-colors disabled:opacity-60",
                  big ? "h-16 min-w-[6rem] px-3" : "h-14 min-w-[4.75rem] px-2",
                  opt.weight > 1 && "border-l-2 border-border",
                  on
                    ? opt.weight === 1 ? "bg-secondary text-foreground" : "bg-violet-600 text-white"
                    : "bg-card hover:bg-secondary/50",
                )}
              >
                <span className={big ? "text-xl leading-none" : "text-lg leading-none"}>{opt.label}</span>
                <span className="text-[11px] font-semibold mt-1 opacity-80">{opt.hint}</span>
              </button>
            );
          })}
        </div>
        <span className="text-sm font-semibold min-w-[4.5rem]" aria-live="polite">
          {saveState === "saving" && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>}
          {saveState === "saved" && <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="w-4 h-4" /> Saved</span>}
        </span>
      </div>
      {saveState === "error" && error && (
        <p className="text-sm font-semibold text-destructive">Not saved — {error}. Tap again to retry.</p>
      )}
    </div>
  );
}
