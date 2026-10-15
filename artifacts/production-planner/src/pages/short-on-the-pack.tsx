/**
 * Short on the pack (Graeme, 15 Oct 2026) — /short-on-the-pack.
 *
 * Opened from the Production Flow Manager team list ("If short on the pack,
 * move around the order of production…" — its link is this page). For the
 * NEXT production plan (the next pack day: tomorrow, or Monday on a Friday):
 *   1. what's short — packs at close of play today vs packs ordered;
 *   2. the order of production the kitchen's rules suggest (veg before meat,
 *      slow meat not before it's ready, most short first), beside today's
 *      order, with "Use this order" → the same PATCH /production-plans/:id/order
 *      the drag handles use, after a confirm;
 *   3. a pre-written message for everyone, editable, sent through team
 *      messages (POST /api/messages to "everyone") after a confirm.
 * Nothing is reordered or sent without a tap on a confirm. The maths is
 * lib/short-on-pack.ts (tested).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, CheckCircle2, ListOrdered, Loader2, Megaphone, Send, TriangleAlert, Undo2 } from "lucide-react";
import type { ScheduleBreakInput, ScheduleRecipeInput } from "@workspace/production-schedule";
import { PageHeader } from "@/components/page-header";
import { ConfirmSheet } from "@/components/apc-booking-issues/confirm-sheet";
import { useSendMessage } from "@/components/messages/messages-api";
import { useSlowMeatProfile } from "@/hooks/use-slow-meat-profile";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { packDayName, packDayNameCap } from "@/lib/pack-day";
import {
  shortOnPackReport, suggestProductionOrder, shortOnPackMessage, pickNextPlan,
  type NextPlanItem, type OrderPlan, type OrderRow, type PackCalcRow,
} from "@/lib/short-on-pack";
import { fetchDashboard } from "./meeting";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CalcResponse { recipes: PackCalcRow[]; dispatchDates: string[]; deliveryDates: string[] }
/** The fields of GET /production-plans/:id items this screen reads. */
interface PlanItemResponse {
  id: number;
  recipeId: number;
  recipeName: string;
  recipeCategory: string | null;
  dietaryCategory: string | null;
  batchesTarget: number;
  eightPackBagCount: number | null;
  status: string;
}
interface ScheduleResponse {
  recipes: ScheduleRecipeInput[];
  options: { startMinutes: number; buildersCount: number; changeoverSeconds: number };
  breaks: ScheduleBreakInput[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function ShortOnThePack() {
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const canMessageEveryone = role === "admin" || role === "manager";

  // Same cache entries as the Pack Report / morning meeting, so the numbers
  // can't disagree with the table the team already reads.
  const dashQ = useQuery({ queryKey: ["morning-meeting-dashboard"], queryFn: fetchDashboard, staleTime: 30_000 });
  // The next pack day: calendar tomorrow Mon–Thu, Monday on a Friday, bank
  // holidays skipped — the dashboard's `tomorrow`.
  const packDate = dashQ.data?.tomorrow ?? null;
  const calcQ = useQuery<CalcResponse>({
    queryKey: ["production-plan-calc", packDate],
    enabled: !!packDate,
    queryFn: () => getJson<CalcResponse>(`/api/production-plans/calculate?planDate=${packDate}`),
    staleTime: 60_000,
  });
  // The plan for that day, chosen here rather than taken from the dashboard
  // so a leftover draft on the same date can't be the one that gets reordered.
  const plansQ = useQuery<Array<{ id: number; status: string }>>({
    queryKey: ["short-on-pack-plans", packDate],
    enabled: !!packDate,
    queryFn: () => getJson(`/api/production-plans?date=${packDate}`),
  });
  const chosen = plansQ.data ? pickNextPlan(plansQ.data) : null;
  const planId = chosen?.id ?? null;
  const planQ = useQuery<{ id: number; status: string; items: PlanItemResponse[] }>({
    queryKey: ["short-on-pack-plan", planId],
    enabled: planId != null,
    queryFn: () => getJson(`/api/production-plans/${planId}`),
  });
  const schedQ = useQuery<ScheduleResponse>({
    queryKey: ["plan-schedule", planId],
    enabled: planId != null,
    queryFn: () => getJson<ScheduleResponse>(`/api/production-plans/${planId}/schedule`),
    staleTime: 60_000,
  });
  const slowQ = useSlowMeatProfile(true);

  const items: NextPlanItem[] = useMemo(() => (planQ.data?.items ?? []).map(it => ({
    itemId: it.id,
    recipeId: it.recipeId,
    recipeName: it.recipeName,
    recipeCategory: it.recipeCategory,
    batchesTarget: it.batchesTarget,
    eightPackBagCount: it.eightPackBagCount,
    status: it.status,
  })), [planQ.data]);

  const report = useMemo(
    () => (calcQ.data ? shortOnPackReport(calcQ.data.recipes, items) : null),
    [calcQ.data, items],
  );

  const suggestion = useMemo(() => {
    if (!report || !schedQ.data || !slowQ.data || !planQ.data || items.length === 0) return null;
    const dietaryByRecipe = new Map<number, string | null>(planQ.data.items.map(it => [it.recipeId, it.dietaryCategory ?? null]));
    const slowMeatIds = new Set(slowQ.data.profiles.flatMap(p => p.meats.map(m => m.ingredientId)));
    return suggestProductionOrder({
      items,
      timeline: schedQ.data.recipes,
      options: schedQ.data.options,
      breaks: schedQ.data.breaks,
      dietaryByRecipe,
      slowMeatIds,
      shortByRecipe: new Map(report.lines.map(l => [l.recipeId, l.shortBy])),
    });
  }, [report, schedQ.data, slowQ.data, planQ.data, items]);

  // ── Reorder (after a confirm) ──
  const [confirmOrder, setConfirmOrder] = useState(false);
  const [reorderedTo, setReorderedTo] = useState<string[] | null>(null);
  const reorder = useMutation({
    mutationFn: async (order: Array<{ itemId: number; orderPosition: number }>) => {
      const res = await fetch(`${BASE}/api/production-plans/${planId}/order`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      setReorderedTo(suggestion ? suggestion.suggested.rows.map(r => r.recipeName) : null);
      setConfirmOrder(false);
      toast({ title: "Production order saved", description: "Every station now follows the new order." });
    },
    onError: (err: Error) => toast({ title: "Reorder failed", description: err.message, variant: "destructive" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["morning-meeting-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["plan-schedule", planId] });
      void queryClient.invalidateQueries({ queryKey: ["short-on-pack-plan", planId] });
      void queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).includes("/api/production-plans") });
    },
  });

  // ── Message (after a confirm) ──
  const dayName = dashQ.data && packDate ? packDayName(dashQ.data.today, packDate) : "tomorrow";
  const dayCap = dashQ.data && packDate ? packDayNameCap(dashQ.data.today, packDate) : "Tomorrow";
  const template = report ? shortOnPackMessage({ dayName, lines: report.lines, reorderedTo }) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const message = draft ?? template;
  const [confirmSend, setConfirmSend] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const send = useSendMessage([]);
  const doSend = () => {
    send.mutate({ conversationKey: "everyone", body: message.trim() }, {
      onSuccess: () => {
        setConfirmSend(false);
        setSentAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }));
        toast({ title: "Sent to everyone", description: "It's in the team messages." });
      },
      onError: (err: Error) => toast({ title: "Couldn't send", description: err.message, variant: "destructive" }),
    });
  };

  const loading = dashQ.isLoading || (packDate != null && calcQ.isLoading);
  const loadError = (dashQ.error ?? calcQ.error) as Error | null;
  const packDateLabel = packDate
    ? new Date(`${packDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    : "";

  return (
    <div className="space-y-6 w-full">
      <PageHeader title="Short on the pack" description={packDate ? `${dayCap}'s pack · ${packDateLabel}` : "The next pack day"} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign(`${BASE}/lists`)}
          className="min-h-[48px] px-3 rounded-xl inline-flex items-center gap-2 font-semibold hover:bg-secondary/60">
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <span className="flex-1" />
        <Link href="/pack-report" className="min-h-[48px] px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary/60">
          Pack Report <ArrowRight className="w-5 h-5" />
        </Link>
      </div>

      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-lg"><Loader2 className="w-5 h-5 animate-spin" /> Working out the pack…</p>
      ) : loadError || !report ? (
        <p className="rounded-2xl border-2 border-red-300 bg-red-50 dark:bg-red-950/20 p-4 font-semibold text-red-700 dark:text-red-300">
          Couldn't load the numbers: {loadError?.message ?? "no data"}. Please refresh.
        </p>
      ) : (
        <>
          {/* 1. The report */}
          {report.lines.length === 0 ? (
            <div className="rounded-3xl border-2 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-6 flex items-start gap-4">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 shrink-0" />
              <div>
                <h2 className="font-display text-2xl font-bold">Nothing short for {dayName === "tomorrow" ? "tomorrow" : dayCap}'s pack</h2>
                <p className="text-lg text-muted-foreground mt-1">By close of play today the fridge covers every order for {packDateLabel}.</p>
              </div>
            </div>
          ) : (
            <section className="rounded-3xl border-2 border-red-300 bg-red-50/60 dark:bg-red-950/20 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <TriangleAlert className="w-9 h-9 text-red-600 shrink-0" />
                <div>
                  <h2 className="font-display text-2xl font-bold">{dayName === "tomorrow" ? "Tomorrow" : `On ${dayCap}`} we're short on the pack</h2>
                  <p className="text-lg text-muted-foreground">
                    {plural(report.lines.length, "flavour")} · {plural(report.totalShortPacks, "pack")} short at close of play today
                  </p>
                </div>
              </div>
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {report.lines.map(l => (
                  <div key={l.recipeId} className="rounded-2xl border-2 border-border bg-card p-4 space-y-1">
                    <p className="text-xl font-bold leading-snug break-words">{l.recipeName}</p>
                    <p className="text-3xl font-black text-red-600 tabular-nums">
                      −{l.shortBy} <span className="text-lg font-bold">{l.shortBy === 1 ? "pack" : "packs"}</span>
                      {l.batchesShort != null && <span className="text-lg font-semibold text-muted-foreground"> · {plural(l.batchesShort, "batch", "batches")}</span>}
                    </p>
                    <p className="text-base text-muted-foreground">End of today {l.haveEndOfToday} · ordered {l.ordered}</p>
                    <p className={cn("text-base font-semibold", l.plannedPacks == null || l.shortAfterMake > 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-400")}>
                      {l.plannedPacks == null
                        ? `Not on ${dayCap}'s plan`
                        : l.shortAfterMake > 0
                          ? `${dayCap}'s make (${l.plannedPacks}) still leaves ${l.shortAfterMake} short`
                          : `${dayCap}'s make (${l.plannedPacks}) covers it — if it's made before packing`}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 2. The order of production */}
          <section className="rounded-3xl border-2 border-border bg-card p-5 space-y-4">
            <div className="flex items-start gap-3">
              <ListOrdered className="w-8 h-8 text-primary shrink-0" />
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-bold">Order of production · {dayCap}'s plan</h2>
                <p className="text-base text-muted-foreground">
                  The rules: veg before meat; slow meat goes in at 6:00 and can't be built until it's cooked; then whatever is most short first.
                </p>
              </div>
            </div>
            {plansQ.isLoading || planQ.isLoading ? (
              <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading the plan…</p>
            ) : planId == null ? (
              <p className="text-lg font-semibold">There's no plan for {packDateLabel} yet — make it first, then come back to sort its order.</p>
            ) : chosen?.status === "draft" ? (
              <p className="text-lg font-semibold text-amber-700 dark:text-amber-400">{dayCap}'s plan is still a draft — finish making it, then come back to sort its order.</p>
            ) : !suggestion ? (
              (schedQ.error || slowQ.error || planQ.error || plansQ.error) ? (
                <p className="text-red-700 dark:text-red-300 font-semibold">Couldn't work out the order: {((schedQ.error ?? slowQ.error ?? planQ.error ?? plansQ.error) as Error).message}</p>
              ) : (
                <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Working out the order…</p>
              )
            ) : (
              <>
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                  <OrderColumn title="Now" plan={suggestion.current} muted />
                  <OrderColumn title="Suggested" plan={suggestion.suggested} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {suggestion.changed ? (
                    <button type="button" onClick={() => setConfirmOrder(true)} disabled={reorder.isPending}
                      className="min-h-[56px] px-6 rounded-2xl bg-primary text-primary-foreground text-lg font-bold inline-flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50">
                      <ListOrdered className="w-6 h-6" /> Use this order
                    </button>
                  ) : (
                    <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-2">
                      <CheckCircle2 className="w-6 h-6" /> {reorderedTo ? "Reordered — every station follows this order." : "The plan already follows the rules."}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>

          {/* 3. The message */}
          {report.lines.length > 0 && (
            <section className="rounded-3xl border-2 border-border bg-card p-5 space-y-3">
              <div className="flex items-start gap-3">
                <Megaphone className="w-8 h-8 text-primary shrink-0" />
                <div>
                  <h2 className="font-display text-2xl font-bold">Tell the team</h2>
                  <p className="text-base text-muted-foreground">
                    Goes to Everyone in team messages. Edit it first if you like.
                    {!reorderedTo && suggestion?.changed && " Use the new order above and the message will say so."}
                  </p>
                </div>
              </div>
              <textarea
                value={message}
                onChange={e => setDraft(e.target.value)}
                rows={Math.min(16, message.split("\n").length + 2)}
                aria-label="Message to everyone"
                className="w-full rounded-xl border-2 border-border bg-background p-3 text-lg leading-relaxed focus:outline-none focus:border-primary"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setConfirmSend(true)} disabled={!canMessageEveryone || !message.trim() || send.isPending}
                  className="min-h-[56px] px-6 rounded-2xl bg-primary text-primary-foreground text-lg font-bold inline-flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50">
                  <Send className="w-6 h-6" /> Send to everyone
                </button>
                {draft != null && draft !== template && (
                  <button type="button" onClick={() => setDraft(null)}
                    className="min-h-[48px] px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary/60">
                    <Undo2 className="w-5 h-5" /> Back to the suggested wording
                  </button>
                )}
                {sentAt && <span className="text-lg font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-2"><CheckCircle2 className="w-6 h-6" /> Sent at {sentAt}</span>}
                {!canMessageEveryone && <span className="text-base text-muted-foreground">Only managers can message everyone.</span>}
              </div>
            </section>
          )}
        </>
      )}

      {confirmOrder && suggestion && (
        <ConfirmSheet
          title="Reorder the production plan"
          orderName={`${dayCap}'s plan`}
          customerName={packDateLabel}
          confirmLabel="Yes, use this order"
          busy={reorder.isPending}
          onClose={() => setConfirmOrder(false)}
          onConfirm={() => reorder.mutate(suggestion.order)}
        >
          <p className="text-lg">Every station (mixing prep, building, the meeting) will follow this order:</p>
          <ol className="space-y-1 text-lg">
            {suggestion.suggested.rows.map((r, i) => (
              <li key={r.itemId}><span className="font-bold tabular-nums">{i + 1}.</span> {r.recipeName}</li>
            ))}
          </ol>
        </ConfirmSheet>
      )}

      {confirmSend && (
        <ConfirmSheet
          title="Send to everyone"
          orderName="Team messages · Everyone"
          customerName={null}
          confirmLabel="Send it"
          busy={send.isPending}
          onClose={() => setConfirmSend(false)}
          onConfirm={doSend}
        >
          <p className="text-lg whitespace-pre-wrap rounded-xl bg-secondary/50 p-3">{message.trim()}</p>
        </ConfirmSheet>
      )}
    </div>
  );
}

function OrderColumn({ title, plan, muted = false }: { title: string; plan: OrderPlan; muted?: boolean }) {
  return (
    <div className={cn("rounded-2xl border-2 p-3 space-y-2", muted ? "border-border bg-secondary/30" : "border-primary/50 bg-primary/5")}>
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="text-lg font-bold uppercase tracking-wide">{title}</h3>
        <span className="text-sm text-muted-foreground">
          {plan.finish && `Building done ~${plan.finish}`}
          {plan.totalWaitMinutes > 0 && ` · waits ${plan.totalWaitMinutes} min for meat`}
        </span>
      </div>
      <ol className="space-y-2">
        {plan.rows.map((r, i) => <OrderRowCard key={r.itemId} row={r} position={i + 1} />)}
      </ol>
    </div>
  );
}

function OrderRowCard({ row, position }: { row: OrderRow; position: number }) {
  const tag = row.kind === "veg" ? { label: "Veg", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" }
    : row.kind === "slow_meat" ? { label: "Slow meat", cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" }
    : row.kind === "meat" ? { label: "Meat", cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" }
    : row.station === "mac" ? { label: "Mac", cls: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200" }
    : null;
  return (
    <li className="rounded-xl bg-card border border-border px-3 py-2.5 flex items-start gap-3">
      <span className="text-2xl font-black tabular-nums w-8 shrink-0 text-center">{position}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold leading-snug break-words">{row.recipeName}</span>
          {tag && <span className={cn("text-xs font-bold uppercase rounded-full px-2 py-0.5", tag.cls)}>{tag.label}</span>}
          {row.shortBy > 0 && <span className="text-xs font-bold uppercase rounded-full px-2 py-0.5 bg-red-600 text-white">−{row.shortBy}</span>}
        </div>
        <p className="text-sm text-muted-foreground">
          {row.start && <span className="font-semibold tabular-nums">{row.start} · </span>}
          {row.reason}
        </p>
      </div>
    </li>
  );
}
