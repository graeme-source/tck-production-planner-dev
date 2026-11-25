/**
 * "Close down the packing and wrapping shift" (Graeme, 24 Nov 2026) — on the
 * Packing and the Wrapping station. Offered once everything is packed, every
 * recipe is wrapped and the packing and wrapping opening, cleaning and
 * closing checks are all actioned; until then it says what's left. Closing
 * down stops the paid hours counted in the room run rate at that moment —
 * nothing else changes. The rules are on the server
 * (api lib/shift-close-down.ts); this card only shows them.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, LogOut, RotateCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { guardedFetch } from "@/hooks/use-guarded-action";

interface CloseDownStatus {
  date: string;
  isToday: boolean;
  closedDown: { closedAt: string; closedByName: string | null } | null;
  outstanding: string[];
  canClose: boolean;
}

const LABEL = "Close down the packing and wrapping shift";

export const shiftCloseDownQueryKey = (date: string) => ["shift-close-down", date] as const;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

export function ShiftCloseDownCard({ date }: { date: string }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<"close" | "reopen" | null>(null);
  const key = shiftCloseDownQueryKey(date);

  const q = useQuery<CloseDownStatus>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/shift-close-down?date=${date}`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't check the shift");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const act = useMutation({
    mutationFn: async (what: "close" | "reopen") => {
      const res = await guardedFetch(`/api/shift-close-down${what === "reopen" ? "/reopen" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      return res.json() as Promise<CloseDownStatus>;
    },
    onSuccess: (data, what) => {
      qc.setQueryData(key, { ...data, isToday: true });
      // The room score reads the new hours.
      qc.invalidateQueries({ queryKey: ["room-day"] });
      toast({ title: what === "close" ? "Shift closed down" : "Shift reopened" });
    },
    onError: (err) => {
      toast({ title: "Couldn't do that", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      qc.invalidateQueries({ queryKey: key });
    },
    onSettled: () => setConfirming(null),
  });

  const s = q.data;
  if (!s) return null;
  // Another day's plan: nothing to press. Show the close-down if there was one.
  if (!s.isToday && !s.closedDown) return null;

  if (s.closedDown) {
    const by = s.closedDown.closedByName ? ` by ${s.closedDown.closedByName}` : "";
    return (
      <div className="rounded-2xl border-2 border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex flex-wrap items-center gap-3">
        <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-[12rem]">
          <p className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
            Closed down at {timeOf(s.closedDown.closedAt)}{by}
          </p>
          <p className="text-sm text-emerald-800/80 dark:text-emerald-200/80">Time after this doesn't count on the room score.</p>
        </div>
        {s.isToday && (confirming === "reopen" ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => act.mutate("reopen")}
              disabled={act.isPending}
              className="min-h-12 px-4 rounded-xl bg-amber-500 text-white font-semibold flex items-center gap-2 disabled:opacity-60"
            >
              {act.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Yes, reopen
            </button>
            <button onClick={() => setConfirming(null)} className="min-h-12 px-4 rounded-xl border border-border bg-background font-medium">
              Keep closed
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming("reopen")}
            className="min-h-12 px-4 rounded-xl border border-emerald-500 text-emerald-800 dark:text-emerald-200 font-medium flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" /> Reopen
          </button>
        ))}
      </div>
    );
  }

  if (!s.canClose) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-base font-semibold text-muted-foreground flex items-center gap-2">
          <LogOut className="w-5 h-5" /> {LABEL}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="font-medium text-foreground">Still to do: </span>
          {s.outstanding.join(" · ")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-3">
      <p className="text-base text-emerald-900 dark:text-emerald-100">
        Everything's packed, wrapped and checked. Close down now and the room score stops counting time from here — stay on for improvements, it won't cost you.
      </p>
      {confirming === "close" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => act.mutate("close")}
            disabled={act.isPending}
            className="min-h-16 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {act.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            Yes, close down
          </button>
          <button
            onClick={() => setConfirming(null)}
            className="min-h-16 rounded-2xl border border-border bg-background text-lg font-medium"
          >
            Not yet
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming("close")}
          className="w-full min-h-16 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-semibold flex items-center justify-center gap-3 active:scale-[0.98] transition"
        >
          <LogOut className="w-6 h-6" /> {LABEL}
        </button>
      )}
    </div>
  );
}
