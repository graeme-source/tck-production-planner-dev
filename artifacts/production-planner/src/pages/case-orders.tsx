/**
 * Case Orders — bulk frozen 8-pack-bag orders (e.g. Waterdean: 100 cases,
 * 2,400 portions) produced across several days on top of normal production.
 *
 * The page answers three standing questions without anyone counting anything:
 *   1. How many bags of each recipe does this order need?   (cases × bags-per-case)
 *   2. How many are in the freezer / still to make?         (wrapping's counts)
 *   3. How many should we make today?                       (capacity-aware spread)
 *
 * The suggestion spreads remaining bags across the days before the target
 * collection date, respecting the daily batch ceiling (110 with a Dough Prep
 * person on the Planday rota, 80 without — or the safe 80 when the rota is
 * unknown) and per-recipe limits (BBQ pulled pork: 30/day). Suggestions are
 * editable before applying; applying writes the freezer-bag allocation onto
 * that day's plan (never adding a recipe to a plan — same rule as wholesale).
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Box, Plus, X, Loader2, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  Snowflake, CalendarDays, Trash2, Pencil, Send, Ban, Gauge,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (mirror routes/case-orders.ts serialisation) ─────────────────────

interface CaseTypeLine { id: number; caseTypeId: number; recipeId: number; bagsPerCase: number; recipeName: string | null }
interface CaseType { id: number; name: string; active: boolean; lines: CaseTypeLine[]; bagsPerCaseTotal: number }

interface RecipeProgress {
  recipeId: number;
  recipeName: string | null;
  maxBatchesPerDay: number | null;
  bagsRequired: number;
  bagsMade: number;
  bagsRemaining: number;
  portionsRequired: number;
}

interface CaseOrderRow {
  id: number;
  supplierId: number;
  supplierName: string | null;
  reference: string | null;
  targetCollectionDate: string;
  status: "open" | "complete" | "cancelled";
  notes: string | null;
  caseLines: Array<{ caseTypeId: number; casesOrdered: number; caseTypeName: string | null }>;
  recipes: RecipeProgress[];
  totals: { cases: number; bagsRequired: number; bagsMade: number; bagsRemaining: number; portionsRequired: number };
}

interface SuggestionDay {
  date: string;
  doughPrep: boolean | null;
  capacity: number;
  existingBatches: number;
  headroomAfter: number;
  planId: number | null;
  suggestions: Array<{ recipeId: number; recipeName: string | null; bags: number; batchEquivalent: number; warnings: string[] }>;
}

interface SuggestionResponse {
  orderId: number;
  targetCollectionDate: string;
  plandayAvailable: boolean;
  days: SuggestionDay[];
  shortfall: Array<RecipeProgress & { bagsUnplaced: number }>;
}

interface RecipeLimit { id: number; name: string; maxBatchesPerDay: number | null }
interface SupplierLite { id: number; name: string }

async function jsonOrThrow(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? fallback);
  return data;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CaseOrders() {
  const queryClient = useQueryClient();
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [managingTypes, setManagingTypes] = useState(false);
  const [showLimits, setShowLimits] = useState(false);

  const { data: orders, isLoading } = useQuery<CaseOrderRow[]>({
    queryKey: ["case-orders"],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/case-orders`, { credentials: "include" }), "Failed to load case orders"),
  });

  const { data: caseTypes } = useQuery<CaseType[]>({
    queryKey: ["case-types"],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/case-orders/case-types`, { credentials: "include" }), "Failed to load case types"),
  });

  const { data: recipeLimits } = useQuery<RecipeLimit[]>({
    queryKey: ["case-recipe-limits"],
    queryFn: async () => jsonOrThrow(await fetch(`${BASE}/api/case-orders/recipe-limits`, { credentials: "include" }), "Failed to load recipes"),
  });

  const { data: suppliers } = useQuery<SupplierLite[]>({
    queryKey: ["suppliers-for-case-orders"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/suppliers`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const open = (orders ?? []).filter(o => o.status === "open");
  const closed = (orders ?? []).filter(o => o.status !== "open");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Case Orders"
        description="Bulk frozen 8-pack-bag orders, produced across days and handed over on a collection."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setManagingTypes(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors"
            >
              <Box className="w-3.5 h-3.5" /> Case types
            </button>
            <button
              onClick={() => setCreatingOrder(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary-foreground bg-primary rounded-lg px-3 py-2 hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" /> New case order
            </button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : open.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card flex flex-col items-center justify-center py-14 text-muted-foreground">
          <Snowflake className="w-10 h-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">No open case orders</p>
          <p className="text-xs mt-1 opacity-70">Create one and the production schedule falls out of the arithmetic.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {open.map(o => <CaseOrderCard key={o.id} order={o} />)}
        </div>
      )}

      {/* Per-recipe daily limits — lives here because it's a scheduling
          concern (BBQ pulled pork: 30/day, meat-cooking bound). */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setShowLimits(v => !v)}
          className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-secondary/30 transition-colors"
        >
          <Gauge className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Recipe daily limits</span>
          <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">
            Process ceilings (e.g. slow meat cooking) — the scheduler warns past these
          </span>
          {showLimits ? <ChevronUp className="w-4 h-4 ml-auto text-muted-foreground" /> : <ChevronDown className="w-4 h-4 ml-auto text-muted-foreground" />}
        </button>
        {showLimits && <RecipeLimitsEditor limits={recipeLimits ?? []} />}
      </div>

      {closed.length > 0 && (
        <details className="rounded-2xl border border-border bg-card px-4 py-3">
          <summary className="text-sm font-semibold cursor-pointer text-muted-foreground">
            Completed &amp; cancelled ({closed.length})
          </summary>
          <div className="mt-3 space-y-2">
            {closed.map(o => (
              <div key={o.id} className="flex items-center gap-3 text-sm px-2 py-1.5">
                <span className={cn(
                  "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
                  o.status === "complete" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-muted text-muted-foreground",
                )}>{o.status}</span>
                <span className="font-medium">#{o.id} {o.supplierName}</span>
                <span className="text-muted-foreground">{o.totals.cases} cases · {o.totals.bagsMade}/{o.totals.bagsRequired} bags</span>
                <span className="text-muted-foreground ml-auto tabular-nums">{o.targetCollectionDate}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {creatingOrder && (
        <CreateOrderDialog
          suppliers={suppliers ?? []}
          caseTypes={(caseTypes ?? []).filter(t => t.active)}
          onClose={() => { setCreatingOrder(false); queryClient.invalidateQueries({ queryKey: ["case-orders"] }); }}
        />
      )}
      {managingTypes && (
        <CaseTypesDialog
          caseTypes={caseTypes ?? []}
          recipes={recipeLimits ?? []}
          onClose={() => { setManagingTypes(false); queryClient.invalidateQueries({ queryKey: ["case-types"] }); }}
        />
      )}
    </div>
  );
}

// ── Order card with progress + schedule ────────────────────────────────────

function CaseOrderCard({ order }: { order: CaseOrderRow }) {
  const queryClient = useQueryClient();
  const [showSchedule, setShowSchedule] = useState(false);

  const setStatus = useMutation({
    mutationFn: async (status: "complete" | "cancelled") =>
      jsonOrThrow(await fetch(`${BASE}/api/case-orders/${order.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }), "Failed to update the order"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["case-orders"] }),
    onError: (e) => toast({ title: e instanceof Error ? e.message : "Failed to update", variant: "destructive" }),
  });

  const pct = order.totals.bagsRequired > 0
    ? Math.min(100, Math.round((order.totals.bagsMade / order.totals.bagsRequired) * 100))
    : 0;
  const done = order.totals.bagsRemaining === 0 && order.totals.bagsRequired > 0;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-11 h-11 rounded-xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center shrink-0">
            <Snowflake className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-xl leading-tight">
              #{order.id} — {order.supplierName ?? "Customer"}
              {order.reference ? <span className="text-muted-foreground font-normal text-base"> · {order.reference}</span> : null}
            </h3>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <CalendarDays className="w-3.5 h-3.5" />
              Collection {format(new Date(`${order.targetCollectionDate}T12:00:00Z`), "EEEE d MMMM")} ·{" "}
              {order.caseLines.map((l, i) => `${i > 0 ? " + " : ""}${l.casesOrdered}× ${l.caseTypeName ?? "case"}`).join("")}
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {done && (
              <button
                onClick={() => setStatus.mutate("complete")}
                disabled={setStatus.isPending}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Mark complete
              </button>
            )}
            <button
              onClick={() => { if (confirm(`Cancel case order #${order.id}? Progress records are kept.`)) setStatus.mutate("cancelled"); }}
              disabled={setStatus.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              <Ban className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>

        {/* Headline progress */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm font-semibold tabular-nums">
              {order.totals.bagsMade} / {order.totals.bagsRequired} bags in the freezer
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {order.totals.bagsRemaining} to go · {order.totals.portionsRequired.toLocaleString()} portions total
            </span>
          </div>
          <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", done ? "bg-emerald-500" : "bg-sky-500")} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Per-recipe rows */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {order.recipes.map(r => (
            <div key={r.recipeId} className="rounded-xl border border-border bg-background px-3 py-2">
              <p className="text-sm font-semibold truncate">{r.recipeName ?? `Recipe ${r.recipeId}`}</p>
              <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                <span className={cn("font-bold", r.bagsRemaining === 0 ? "text-emerald-600" : "text-foreground")}>
                  {r.bagsMade}/{r.bagsRequired}
                </span>{" "}
                bags · {r.bagsRemaining} left
                {r.maxBatchesPerDay != null && <span className="text-amber-600"> · max {r.maxBatchesPerDay} batches/day</span>}
              </p>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => setShowSchedule(v => !v)}
        className="w-full px-4 py-2.5 border-t border-border bg-secondary/20 flex items-center gap-2 text-sm font-semibold hover:bg-secondary/40 transition-colors"
      >
        <CalendarDays className="w-4 h-4 text-muted-foreground" />
        Production schedule
        {showSchedule ? <ChevronUp className="w-4 h-4 ml-auto text-muted-foreground" /> : <ChevronDown className="w-4 h-4 ml-auto text-muted-foreground" />}
      </button>
      {showSchedule && <ScheduleView orderId={order.id} />}
    </div>
  );
}

// ── Suggestion table ───────────────────────────────────────────────────────

function ScheduleView({ orderId }: { orderId: number }) {
  const queryClient = useQueryClient();
  // Edited bag counts, keyed `${date}|${recipeId}` — the suggestion is a
  // starting point, not a decision.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [applyingDate, setApplyingDate] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<SuggestionResponse>({
    queryKey: ["case-order-suggestion", orderId],
    queryFn: async () => jsonOrThrow(
      await fetch(`${BASE}/api/case-orders/${orderId}/schedule-suggestion`, { credentials: "include" }),
      "Failed to load the schedule suggestion",
    ),
    staleTime: 30_000,
  });

  const applyDay = async (day: SuggestionDay) => {
    const allocations = day.suggestions
      .map(s => ({ recipeId: s.recipeId, bags: edits[`${day.date}|${s.recipeId}`] ?? s.bags }))
      .filter(a => a.bags > 0);
    if (allocations.length === 0) return;
    setApplyingDate(day.date);
    try {
      const result = await jsonOrThrow(
        await fetch(`${BASE}/api/case-orders/${orderId}/apply-day`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: day.date, allocations, addBatches: true }),
        }),
        "Failed to apply the allocation",
      );
      const appliedBags = (result.applied as Array<{ bags: number }>).reduce((s, a) => s + a.bags, 0);
      const batches = (result.applied as Array<{ batchesAdded: number }>).reduce((s, a) => s + a.batchesAdded, 0);
      if (result.applied.length > 0) {
        toast({ title: `${appliedBags} bags added to the ${day.date} plan`, description: `+${batches} batches. The wrapping station will see the freezer split.` });
      }
      for (const s of result.skipped as Array<{ reason: string }>) {
        toast({ title: "Skipped", description: s.reason, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["case-orders"] });
      refetch();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to apply", variant: "destructive" });
    } finally {
      setApplyingDate(null);
    }
  };

  if (isLoading) return <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  return (
    <div className="p-4 space-y-3 border-t border-border/50">
      {!data.plandayAvailable && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          Rota unavailable — every day assumes the safe {data.days[0]?.capacity ?? 80}-batch ceiling (no Dough Prep person). Connect Planday to lift days automatically.
        </p>
      )}

      {data.days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No production days left before the collection date.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="text-left font-semibold py-2 pr-3">Day</th>
                <th className="text-left font-semibold py-2 pr-3">Capacity</th>
                <th className="text-left font-semibold py-2 pr-3">Make for this order</th>
                <th className="text-right font-semibold py-2 pl-3">Apply</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.days.map(day => (
                <tr key={day.date} className="align-top">
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    <p className="font-semibold">{format(new Date(`${day.date}T12:00:00Z`), "EEE d MMM")}</p>
                    <p className="text-xs text-muted-foreground">
                      {day.planId ? `plan #${day.planId}` : "no plan yet"}
                    </p>
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                    <p>
                      <span className="font-bold text-foreground tabular-nums">{day.capacity}</span> batches
                      {day.doughPrep === true && <span className="text-emerald-600"> · Dough Prep on</span>}
                      {day.doughPrep === false && <span className="text-amber-600"> · no Dough Prep</span>}
                    </p>
                    <p className="tabular-nums">{day.existingBatches} planned · {day.headroomAfter} spare after</p>
                  </td>
                  <td className="py-2.5 pr-3">
                    {day.suggestions.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="space-y-1.5">
                        {day.suggestions.map(s => {
                          const key = `${day.date}|${s.recipeId}`;
                          const value = edits[key] ?? s.bags;
                          return (
                            <div key={s.recipeId} className="flex items-center gap-2 flex-wrap">
                              <input
                                type="number"
                                min={0}
                                value={value}
                                onChange={e => setEdits(prev => ({ ...prev, [key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                                className="w-16 px-2 py-1 border border-border rounded-lg bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <span className="font-medium">{s.recipeName}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">bags (~{Math.ceil((value * 8) / 10)} batches)</span>
                              {s.warnings.map((w, i) => (
                                <span key={i} className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> {w}
                                </span>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    {day.suggestions.length > 0 && (
                      <button
                        onClick={() => applyDay(day)}
                        disabled={applyingDate !== null || !day.planId}
                        title={day.planId ? "Write these bags onto the day's plan" : "Create the production plan for this day first"}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
                      >
                        {applyingDate === day.date ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        Apply to plan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.shortfall.length > 0 && (
        <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2.5 text-sm text-red-800 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Doesn't fit before the collection date:</p>
            {data.shortfall.map(s => (
              <p key={s.recipeId} className="tabular-nums">{s.recipeName}: {s.bagsUnplaced} bags won't fit — move the collection date, raise capacity, or accept overtime.</p>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Suggestions spread the remaining bags evenly over the days before collection, after existing planned batches.
        Edit the numbers before applying — applying adds the bags <em>and</em> their batch-equivalents to that day's plan,
        and the recipe must already be on the plan (same rule as wholesale bags).
      </p>
    </div>
  );
}

// ── Create order dialog ────────────────────────────────────────────────────

function CreateOrderDialog({ suppliers, caseTypes, onClose }: {
  suppliers: SupplierLite[];
  caseTypes: CaseType[];
  onClose: () => void;
}) {
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [reference, setReference] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Array<{ caseTypeId: number | ""; casesOrdered: string }>>([{ caseTypeId: "", casesOrdered: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const validLines = lines.filter(l => l.caseTypeId !== "" && Number(l.casesOrdered) > 0);
  const canSubmit = supplierId !== "" && targetDate && validLines.length > 0;

  // Live arithmetic preview — the point of the feature.
  const preview = useMemo(() => {
    const byRecipe = new Map<string, number>();
    let cases = 0;
    for (const l of validLines) {
      const t = caseTypes.find(ct => ct.id === l.caseTypeId);
      if (!t) continue;
      cases += Number(l.casesOrdered);
      for (const tl of t.lines) {
        const k = tl.recipeName ?? String(tl.recipeId);
        byRecipe.set(k, (byRecipe.get(k) ?? 0) + Number(l.casesOrdered) * tl.bagsPerCase);
      }
    }
    const bags = Array.from(byRecipe.values()).reduce((s, b) => s + b, 0);
    return { cases, bags, portions: bags * 8, byRecipe };
  }, [validLines, caseTypes]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await jsonOrThrow(await fetch(`${BASE}/api/case-orders`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: Number(supplierId),
          reference: reference.trim() || undefined,
          targetCollectionDate: targetDate,
          notes: notes.trim() || undefined,
          lines: validLines.map(l => ({ caseTypeId: Number(l.caseTypeId), casesOrdered: Number(l.casesOrdered) })),
        }),
      }), "Could not create the case order");
      toast({ title: "Case order created", description: `${preview.bags} bags (${preview.portions.toLocaleString()} portions) to make.` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the case order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg my-8">
        <div className="p-5 border-b border-border flex items-start gap-3">
          <Snowflake className="w-6 h-6 text-sky-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg leading-tight">New case order</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Bags and portions are computed — nothing to count by hand.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-semibold">Customer <span className="text-red-500">*</span></span>
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Choose…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Target collection date <span className="text-red-500">*</span></span>
              <input
                type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold">Reference <span className="text-muted-foreground font-normal">(optional)</span></span>
            <input
              value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. Waterdean August order"
              className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <div>
            <span className="text-sm font-semibold">Cases <span className="text-red-500">*</span></span>
            <div className="mt-1.5 space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number" min={1} placeholder="Qty" value={line.casesOrdered}
                    onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, casesOrdered: e.target.value } : l))}
                    className="w-20 px-3 py-2.5 border border-border rounded-xl bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <select
                    value={line.caseTypeId}
                    onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, caseTypeId: e.target.value ? Number(e.target.value) : "" } : l))}
                    className="flex-1 px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">Case type…</option>
                    {caseTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.bagsPerCaseTotal} bags/case)</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setLines(ls => ls.length === 1 ? ls : ls.filter((_, j) => j !== i))}
                    disabled={lines.length === 1}
                    className="p-2.5 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setLines(ls => [...ls, { caseTypeId: "", casesOrdered: "" }])}
              className="mt-2 flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Add case line
            </button>
            {caseTypes.length === 0 && (
              <p className="text-xs text-amber-600 mt-2">No case types yet — create one from the "Case types" button first.</p>
            )}
          </div>

          {preview.cases > 0 && (
            <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/30 px-3 py-2.5 text-sm">
              <p className="font-semibold text-sky-900 dark:text-sky-100 tabular-nums">
                {preview.cases} cases = {preview.bags} bags = {preview.portions.toLocaleString()} portions
              </p>
              <p className="text-xs text-sky-800/90 dark:text-sky-200/90 mt-0.5 tabular-nums">
                {Array.from(preview.byRecipe.entries()).map(([name, bags]) => `${name}: ${bags} bags`).join(" · ")}
              </p>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-semibold">Notes <span className="text-muted-foreground font-normal">(optional)</span></span>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex gap-3">
          <button onClick={onClose} className="px-5 py-3 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors">Cancel</button>
          <button
            onClick={submit} disabled={!canSubmit || saving}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><Plus className="w-4 h-4" /> Create order</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Case types management ──────────────────────────────────────────────────

function CaseTypesDialog({ caseTypes, recipes, onClose }: {
  caseTypes: CaseType[];
  recipes: RecipeLimit[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: number | null; name: string; lines: Array<{ recipeId: number | ""; bagsPerCase: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startNew = () => setEditing({ id: null, name: "", lines: [{ recipeId: "", bagsPerCase: "3" }] });
  const startEdit = (t: CaseType) => setEditing({
    id: t.id, name: t.name,
    lines: t.lines.map(l => ({ recipeId: l.recipeId, bagsPerCase: String(l.bagsPerCase) })),
  });

  const save = async () => {
    if (!editing) return;
    const validLines = editing.lines.filter(l => l.recipeId !== "" && Number(l.bagsPerCase) > 0);
    if (!editing.name.trim() || validLines.length === 0) { setError("A name and at least one recipe line are required."); return; }
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: editing.name.trim(),
        lines: validLines.map(l => ({ recipeId: Number(l.recipeId), bagsPerCase: Number(l.bagsPerCase) })),
      });
      await jsonOrThrow(
        editing.id == null
          ? await fetch(`${BASE}/api/case-orders/case-types`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body })
          : await fetch(`${BASE}/api/case-orders/case-types/${editing.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body }),
        "Could not save the case type",
      );
      queryClient.invalidateQueries({ queryKey: ["case-types"] });
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the case type");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg my-8">
        <div className="p-5 border-b border-border flex items-start gap-3">
          <Box className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg leading-tight">Case types</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              What a case contains. "Margherita case" = 3 bags of margherita; "Mixed case" = 1 bag each. Any recipe can be cased.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {editing ? (
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-semibold">Case name <span className="text-red-500">*</span></span>
                <input
                  autoFocus value={editing.name}
                  onChange={e => setEditing(ed => ed ? { ...ed, name: e.target.value } : ed)}
                  placeholder="e.g. Margherita case, Mixed case"
                  className="mt-1.5 w-full px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <div>
                <span className="text-sm font-semibold">Bags in this case <span className="text-red-500">*</span></span>
                <div className="mt-1.5 space-y-2">
                  {editing.lines.map((line, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="number" min={1} value={line.bagsPerCase}
                        onChange={e => setEditing(ed => ed ? { ...ed, lines: ed.lines.map((l, j) => j === i ? { ...l, bagsPerCase: e.target.value } : l) } : ed)}
                        className="w-16 px-3 py-2.5 border border-border rounded-xl bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <span className="text-sm text-muted-foreground">×</span>
                      <select
                        value={line.recipeId}
                        onChange={e => setEditing(ed => ed ? { ...ed, lines: ed.lines.map((l, j) => j === i ? { ...l, recipeId: e.target.value ? Number(e.target.value) : "" } : l) } : ed)}
                        className="flex-1 px-3 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        <option value="">Recipe…</option>
                        {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <button
                        onClick={() => setEditing(ed => ed && ed.lines.length > 1 ? { ...ed, lines: ed.lines.filter((_, j) => j !== i) } : ed)}
                        disabled={editing.lines.length === 1}
                        className="p-2.5 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setEditing(ed => ed ? { ...ed, lines: [...ed.lines, { recipeId: "", bagsPerCase: "1" }] } : ed)}
                  className="mt-2 flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add recipe
                </button>
              </div>
              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setEditing(null); setError(null); }} className="px-4 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors">Back</button>
                <button
                  onClick={save} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save case type
                </button>
              </div>
            </div>
          ) : (
            <>
              {caseTypes.length === 0 && (
                <p className="text-sm text-muted-foreground">No case types yet.</p>
              )}
              {caseTypes.map(t => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{t.name} <span className="text-muted-foreground font-normal">· {t.bagsPerCaseTotal} bags/case</span></p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.lines.map(l => `${l.bagsPerCase}× ${l.recipeName ?? l.recipeId}`).join(" + ")}
                    </p>
                  </div>
                  <button onClick={() => startEdit(t)} className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={startNew}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-border text-sm font-medium hover:bg-secondary/40 transition-colors"
              >
                <Plus className="w-4 h-4" /> New case type
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Recipe limits editor ───────────────────────────────────────────────────

function RecipeLimitsEditor({ limits }: { limits: RecipeLimit[] }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const save = async (recipeId: number) => {
    const raw = drafts[recipeId];
    if (raw === undefined) return;
    const value = raw.trim() === "" ? null : Math.max(1, parseInt(raw, 10) || 0) || null;
    setSavingId(recipeId);
    try {
      await jsonOrThrow(await fetch(`${BASE}/api/case-orders/recipe-limits/${recipeId}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxBatchesPerDay: value }),
      }), "Could not save the limit");
      queryClient.invalidateQueries({ queryKey: ["case-recipe-limits"] });
      setDrafts(prev => { const next = { ...prev }; delete next[recipeId]; return next; });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Could not save the limit", variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {limits.map(r => {
        const draft = drafts[r.id] ?? (r.maxBatchesPerDay == null ? "" : String(r.maxBatchesPerDay));
        const dirty = drafts[r.id] !== undefined;
        return (
          <div key={r.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
            <span className="flex-1 text-sm font-medium truncate">{r.name}</span>
            <input
              type="number" min={1} placeholder="no limit" value={draft}
              onChange={e => setDrafts(prev => ({ ...prev, [r.id]: e.target.value }))}
              onBlur={() => { if (dirty) save(r.id); }}
              className="w-24 px-2 py-1.5 border border-border rounded-lg bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {savingId === r.id
              ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
              : <span className="text-xs text-muted-foreground flex-shrink-0">batches/day</span>}
          </div>
        );
      })}
    </div>
  );
}
