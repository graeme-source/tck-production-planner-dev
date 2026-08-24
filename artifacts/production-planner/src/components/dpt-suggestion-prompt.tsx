/**
 * Weekly DPT refresh prompt (Objective B).
 *
 * Once a week, managers/admins see the packs-sold numbers the last 30 days
 * of Shopify sales actually support (rotating special excluded) next to the
 * current hand-set ones, and choose:
 *   - Apply — updates every active DPT row and recalculates the ingredient
 *     requirements; the prompt stays quiet for a week.
 *   - Not now — asks again tomorrow.
 * Nothing is ever applied without a human pressing Apply.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, Minus, Loader2, BarChart2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface SuggestionRow {
  recipeId: number;
  name: string;
  currentPacksSold: number;
  suggestedPacksSold: number;
  salesPacks30d: number;
}

interface SuggestionResponse {
  due: boolean;
  windowStart?: string;
  windowEnd?: string;
  windowDays?: number;
  rows?: SuggestionRow[];
  excludedSpecials?: string[];
}

async function fetchSuggestion(): Promise<SuggestionResponse | null> {
  const res = await fetch(`${BASE}/api/dpt-suggestions`, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}

export function DptSuggestionPrompt() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : null;
  const eligible = role === "admin" || role === "manager";
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["dpt-suggestion-due"],
    queryFn: fetchSuggestion,
    enabled: eligible,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const confirm = useMutation({
    mutationFn: async (rows: SuggestionRow[]) => {
      const res = await fetch(`${BASE}/api/dpt-suggestions/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rows.map(r => ({ recipeId: r.recipeId, packsSold: r.suggestedPacksSold })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Could not apply the update");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "DPT updated from sales", description: "Ingredient requirements recalculated. Next check-in is in a week." });
      setDismissed(true);
      void queryClient.invalidateQueries({ queryKey: ["dpt-suggestion-due"] });
      void queryClient.invalidateQueries();
    },
    onError: (e) => {
      toast({ title: "Couldn't apply the DPT update", description: e instanceof Error ? e.message : "Request failed", variant: "destructive" });
    },
  });

  const snooze = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}/api/dpt-suggestions/snooze`, { method: "POST", credentials: "include" });
    },
    onSettled: () => {
      setDismissed(true);
      void queryClient.invalidateQueries({ queryKey: ["dpt-suggestion-due"] });
    },
  });

  if (!eligible || dismissed || !data?.due || !data.rows?.length) return null;

  const rows = data.rows;
  const busy = confirm.isPending || snooze.isPending;

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) void snooze.mutate(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" /> Suggested DPT update
          </DialogTitle>
          <DialogDescription>
            Based on the last {data.windowDays ?? 30} days of Shopify sales
            ({data.windowStart} → {data.windowEnd}), shown as weekly packs.
            {data.excludedSpecials?.length ? ` The rotating special (${data.excludedSpecials.join(", ")}) is excluded.` : " The rotating special is excluded."}
            {" "}Nothing changes until you apply.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Recipe</th>
                <th className="text-right px-3 py-2 font-medium">Current</th>
                <th className="text-right px-3 py-2 font-medium">Suggested</th>
                <th className="text-right px-3 py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const diff = r.suggestedPacksSold - r.currentPacksSold;
                return (
                  <tr key={r.recipeId} className="border-t border-border/60">
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.currentPacksSold}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{r.suggestedPacksSold}</td>
                    <td className={cn(
                      "px-3 py-1.5 text-right tabular-nums font-medium",
                      diff > 0 ? "text-emerald-600 dark:text-emerald-400" : diff < 0 ? "text-destructive" : "text-muted-foreground",
                    )}>
                      <span className="inline-flex items-center gap-1">
                        {diff > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : diff < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                        {diff > 0 ? `+${diff}` : diff}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void snooze.mutate()}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm.mutate(rows)}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {confirm.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Apply new numbers
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
