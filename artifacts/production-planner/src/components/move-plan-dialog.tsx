/**
 * Move production to another date (Graeme, 2026-09-16): the whole plan, or
 * just one line of it — calzones / mac cheese / fried chicken. A moved line
 * lands on the existing plan for the target date, or on a fresh standalone
 * plan created for it ("Mac Cheese – Friday 19 Sep 2026").
 *
 * Managers and admins only (the server enforces it; the button simply isn't
 * rendered for anyone else). Lives in its own file with its own POST
 * /api/plan-move/:id call — the charter forbids growing
 * pages/production-plans.tsx, which hosts this as a single menu row.
 *
 * Renders a menu-row button + its dialog (portalled to <body> so the host
 * menu's stacking context can't trap it). Modal rules: X + backdrop close,
 * max-h-[92dvh], internal scroll.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Loader2, X, ArrowRightLeft } from "lucide-react";
import { format, parseISO, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type MoveScope = "all" | "calzones" | "mac_cheese" | "fried_chicken";

const SCOPES: Array<{ key: MoveScope; label: string; hint: string }> = [
  { key: "all", label: "Whole plan", hint: "The plan itself changes date — batch number and prep/dough days follow." },
  { key: "calzones", label: "Calzones only", hint: "The core line moves; mac cheese / fried chicken stay put." },
  { key: "mac_cheese", label: "Mac Cheese only", hint: "Just the mac cheese items." },
  { key: "fried_chicken", label: "Fried Chicken only", hint: "Just the fried chicken items (prep ticks travel too)." },
];

export function MovePlanMenuAction({ plan, buttonClassName }: {
  plan: { id: number; name: string; planDate: string };
  buttonClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<MoveScope>("all");
  const [targetDate, setTargetDate] = useState<string>(() =>
    format(addDays(parseISO(plan.planDate), 1), "yyyy-MM-dd"));
  const queryClient = useQueryClient();

  const move = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/plan-move/${plan.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, targetDate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The move failed");
      return body as { moved: string; targetPlanId?: number; targetPlanName?: string; createdPlan?: boolean; movedItemCount?: number };
    },
    onSuccess: (r) => {
      const dateLabel = format(parseISO(targetDate), "EEEE d MMM");
      toast({
        title: r.moved === "plan" ? `Plan moved to ${dateLabel}` : `${r.movedItemCount} item${r.movedItemCount === 1 ? "" : "s"} moved to ${dateLabel}`,
        description: r.moved === "plan"
          ? "Prep and dough days re-set for the new date."
          : r.createdPlan
            ? `A standalone plan was created: ${r.targetPlanName}.`
            : `Merged into ${r.targetPlanName}.`,
      });
      setOpen(false);
      // Every plan-derived view refetches — the lists, both plans, stations.
      void queryClient.invalidateQueries();
    },
    onError: (err) => toast({
      title: "Couldn't move it",
      description: err instanceof Error ? err.message : "Try again",
      variant: "destructive",
    }),
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClassName}>
        <ArrowRightLeft className="w-4 h-4" />
        Move to another date
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-3 md:p-8" onClick={() => { if (!move.isPending) setOpen(false); }}>
          <div
            className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
              <ArrowRightLeft className="w-5 h-5 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h2 className="font-display font-bold text-lg leading-tight">Move production</h2>
                <p className="text-xs text-muted-foreground truncate">{plan.name} · {format(parseISO(plan.planDate), "EEE d MMM")}</p>
              </div>
              <button onClick={() => setOpen(false)} disabled={move.isPending} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="text-sm font-semibold block mb-2">What's moving?</label>
                <div className="space-y-2">
                  {SCOPES.map(s => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setScope(s.key)}
                      className={cn(
                        "w-full text-left rounded-xl border-2 px-4 py-3 transition-colors",
                        scope === s.key
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background hover:bg-secondary/50",
                      )}
                    >
                      <span className="block text-sm font-semibold">{s.label}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{s.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold block mb-1.5 flex items-center gap-1.5">
                  <CalendarDays className="w-4 h-4" /> New date
                </label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={e => setTargetDate(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  A moved line joins the plan already on that date, or gets a standalone plan of its own if the day is empty.
                </p>
              </div>

              <button
                onClick={() => move.mutate()}
                disabled={move.isPending || !targetDate || targetDate === plan.planDate}
                className="w-full h-12 rounded-xl font-bold flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {move.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                Move it
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
