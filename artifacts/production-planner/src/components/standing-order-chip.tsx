/**
 * "Every Fri — 2 boxes · Not today" on an Orders line (Fix queue #348).
 *
 * A standing weekly order puts the item on its supplier's card on the
 * chosen day so nobody has to remember it; the team still decides. Placing
 * the order with it on marks it ordered; "Not today" takes it off until the
 * next chosen weekday (POST /api/standing-orders/not-today). Objective C.
 */
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { packNoun } from "@workspace/units";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function skipToday(ingredientId: number): Promise<void> {
  const res = await fetch(`${BASE}/api/standing-orders/not-today`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredientId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Couldn't take it off (${res.status})`);
  }
}

export function StandingOrderChip({ ingredientId, ingredientName, label, packs, unit, packName, onSkipped }: {
  ingredientId: number;
  ingredientName: string;
  label: string;
  packs: number;
  unit: string;
  packName?: string | null;
  /** Re-fetch the order calculation so the line drops / shrinks. */
  onSkipped: () => void;
}) {
  const skip = useMutation({
    mutationFn: () => skipToday(ingredientId),
    onSuccess: () => {
      onSkipped();
      toast({ title: `${ingredientName} not ordered today`, description: `It'll come up again on its next day (${label.replace(/^Every /, "")}).` });
    },
    onError: (err) => toast({ title: "Couldn't take it off", description: err instanceof Error ? err.message : "Try again", variant: "destructive" }),
  });

  return (
    <span className="flex flex-wrap items-center gap-1.5 mt-1">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-teal-500/15 text-teal-700 dark:text-teal-300"
        title="Standing weekly order — set on the ingredient's kanban settings. It comes up on this day whatever the stock."
      >
        <CalendarClock className="w-3 h-3" /> {label} — {packs} {packNoun(unit, packs, packName)}
      </span>
      <button
        type="button"
        disabled={skip.isPending}
        onClick={() => skip.mutate()}
        className="inline-flex items-center gap-1 min-h-[32px] px-1 text-xs font-medium underline underline-offset-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {skip.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
        Not today
      </button>
    </span>
  );
}
