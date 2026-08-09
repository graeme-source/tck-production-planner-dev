// Queued test production — decide batches for a future production date long
// before the plan exists, see exactly which ingredients are unusual (no
// stock check, no kanban bag), and raise their purchase orders early.
// Queued rows land on the plan automatically when the planner creates it
// through the normal flow (violet banner + "queued" badge there).

import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListRecipes, getListRecipesQueryKey } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import {
  Plus, Trash2, Loader2, ChevronDown, ChevronUp,
  ShoppingCart, CheckCircle2, AlertTriangle, Truck, ArrowLeft,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface QueueRow {
  id: number;
  productionDate: string;
  recipeId: number;
  batches: number;
  status: string;
  planId: number | null;
  recipeName: string;
  recipeColor: string | null;
  portionsPerBatch: number;
  packSize: number;
}

interface QueueIngredient {
  ingredientId: number;
  name: string;
  unit: string;
  required: number;
  isRoutine: boolean;
  inbound: number;
  remainingToOrder: number;
  supplierId: number | null;
  supplierName: string | null;
  supplierLeadTimeDays: number | null;
  packWeight: number;
  caseSizePacks: number | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Ingredient panel per date ──────────────────────────────────────────
function DateIngredients({ date, onOrdersCreated }: { date: string; onOrdersCreated: () => void }) {
  const queryClient = useQueryClient();
  const [placing, setPlacing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["queued-production-ingredients", date],
    queryFn: () => fetchJson<{ ingredients: QueueIngredient[] }>(`${BASE}/api/queued-production/ingredients?date=${date}`),
  });
  const [showRoutine, setShowRoutine] = useState(false);

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="w-4 h-4 animate-spin" /> Working out ingredient requirements…</div>;
  }
  const ingredients = data?.ingredients ?? [];
  const special = ingredients.filter(i => !i.isRoutine);
  const routine = ingredients.filter(i => i.isRoutine);
  const toOrder = special.filter(i => i.remainingToOrder > 0);
  const noSupplier = toOrder.filter(i => i.supplierId == null);

  const createOrders = async () => {
    setPlacing(true);
    try {
      const res = await fetch(`${BASE}/api/queued-production/create-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ productionDate: date }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      // Place each draft immediately — the standard endpoint applies the
      // supplier's normal lead time / cutoff; override the date afterwards
      // in Orders → Deliveries as usual for fresh products.
      const placed: string[] = [];
      for (const po of body.created as Array<{ poId: number; supplierName: string }>) {
        const placeRes = await fetch(`${BASE}/api/orders/purchase-orders/${po.poId}/place`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
        const placeBody = await placeRes.json().catch(() => null);
        placed.push(placeRes.ok
          ? `${po.supplierName}${placeBody?.expectedDeliveryDate ? ` (due ${placeBody.expectedDeliveryDate})` : ""}`
          : `${po.supplierName} (draft — place manually in Orders)`);
      }
      toast({
        title: `Orders created for ${placed.length} supplier${placed.length === 1 ? "" : "s"}`,
        description: placed.join("; "),
      });
      queryClient.invalidateQueries({ queryKey: ["queued-production-ingredients", date] });
      onOrdersCreated();
    } catch (err) {
      toast({ title: "Couldn't create orders", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {special.length === 0 ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> Every ingredient is routinely stocked (stock check or kanban) — normal ordering covers this.
        </p>
      ) : (
        <>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Special ingredients — not routinely ordered
          </p>
          <div className="space-y-1">
            {special.map(i => (
              <div key={i.ingredientId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {i.name}
                  {i.supplierName
                    ? <span className="text-xs text-muted-foreground"> · {i.supplierName}{i.supplierLeadTimeDays != null ? ` (${i.supplierLeadTimeDays}d lead)` : ""}</span>
                    : <span className="text-xs text-red-600 dark:text-red-400"> · no supplier set</span>}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0 tabular-nums text-xs">
                  <span className="font-semibold text-sm">{i.required} {i.unit}</span>
                  {i.inbound > 0 && (
                    <span className="text-sky-600 dark:text-sky-400 flex items-center gap-0.5" title="Already on order (open POs)">
                      <Truck className="w-3 h-3" /> {i.inbound}
                    </span>
                  )}
                  {i.remainingToOrder <= 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> ordered
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-400 font-medium">order {i.remainingToOrder} {i.unit}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          {noSupplier.length > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {noSupplier.map(i => i.name).join(", ")} {noSupplier.length === 1 ? "has" : "have"} no supplier set — set one on the ingredient before ordering.
            </p>
          )}
          {toOrder.some(i => i.supplierId != null) && (
            <button
              onClick={createOrders}
              disabled={placing}
              className="mt-1 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
              Create orders for special ingredients
            </button>
          )}
        </>
      )}
      {routine.length > 0 && (
        <div>
          <button onClick={() => setShowRoutine(!showRoutine)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {showRoutine ? "Hide" : "Show"} {routine.length} routine ingredient{routine.length === 1 ? "" : "s"} (covered by normal ordering)
          </button>
          {showRoutine && (
            <div className="mt-1 space-y-0.5">
              {routine.map(i => (
                <div key={i.ingredientId} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">{i.name}</span>
                  <span className="tabular-nums">{i.required} {i.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add-to-queue form ──────────────────────────────────────────────────
function AddQueueForm({ initialDate, onSaved }: { initialDate: string; onSaved: () => void }) {
  const [date, setDate] = useState(initialDate);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<number, number>>({}); // recipeId → batches
  const [saving, setSaving] = useState(false);
  const { data: recipes } = useListRecipes({ query: { queryKey: getListRecipesQueryKey() } });

  const sorted = useMemo(() => {
    const list = [...(recipes ?? [])].sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    const q = search.trim().toLowerCase();
    return q ? list.filter((r: { name: string }) => r.name.toLowerCase().includes(q)) : list;
  }, [recipes, search]);

  const toggle = (id: number) => setSelected(prev => {
    const next = { ...prev };
    if (next[id] != null) delete next[id]; else next[id] = 5;
    return next;
  });

  const selectedIds = Object.keys(selected).map(Number);

  const save = async () => {
    if (!date || selectedIds.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/queued-production`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productionDate: date,
          items: selectedIds.map(recipeId => ({ recipeId, batches: selected[recipeId] })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast({ title: `Queued ${selectedIds.length} recipe${selectedIds.length === 1 ? "" : "s"} for ${format(parseISO(date), "EEEE d MMM")}` });
      setSelected({});
      onSaved();
    } catch (err) {
      toast({ title: "Couldn't queue production", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Production date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground block mb-1">Find recipes</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
          />
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {sorted.map((r: { id: number; name: string; color?: string | null }) => (
          <div key={r.id} className="flex items-center gap-2 py-0.5">
            <input type="checkbox" checked={selected[r.id] != null} onChange={() => toggle(r.id)} className="rounded border-border flex-shrink-0" />
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-border" style={{ backgroundColor: r.color ?? "transparent" }} />
            <span className="text-sm truncate flex-1" style={r.color ? { color: r.color } : undefined}>{r.name}</span>
            {selected[r.id] != null && (
              <span className="flex items-center gap-1 flex-shrink-0">
                <input
                  type="number"
                  min={1}
                  value={selected[r.id]}
                  onChange={e => setSelected(prev => ({ ...prev, [r.id]: Math.max(1, parseInt(e.target.value) || 1) }))}
                  className="w-16 px-2 py-1 border border-border rounded-lg text-sm text-center tabular-nums bg-background"
                />
                <span className="text-xs text-muted-foreground">batches</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={save}
        disabled={saving || !date || selectedIds.length === 0}
        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Queue {selectedIds.length > 0 ? selectedIds.length : ""} for production
      </button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function QueuedProductionPage() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const initialDate = new URLSearchParams(searchStr).get("date") ?? "";
  const queryClient = useQueryClient();
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set(initialDate ? [initialDate] : []));

  const { data: rows, isLoading } = useQuery({
    queryKey: ["queued-production"],
    queryFn: () => fetchJson<QueueRow[]>(`${BASE}/api/queued-production`),
  });

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ["queued-production"] });
    queryClient.invalidateQueries({ queryKey: ["queued-production-ingredients"] });
  };

  const byDate = useMemo(() => {
    const map = new Map<string, QueueRow[]>();
    for (const r of rows ?? []) {
      const list = map.get(r.productionDate) ?? [];
      list.push(r);
      map.set(r.productionDate, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const updateBatches = async (row: QueueRow, batches: number) => {
    if (batches < 1) return;
    const res = await fetch(`${BASE}/api/queued-production/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ batches }),
    });
    if (res.ok) refetchAll();
  };

  const cancelRow = async (row: QueueRow) => {
    if (!window.confirm(`Remove ${row.recipeName} (${row.batches} batches) from the ${format(parseISO(row.productionDate), "EEE d MMM")} queue?`)) return;
    const res = await fetch(`${BASE}/api/queued-production/${row.id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) refetchAll();
  };

  const toggleDate = (date: string) => setExpandedDates(prev => {
    const next = new Set(prev);
    if (next.has(date)) next.delete(date); else next.add(date);
    return next;
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <PageHeader
        title="Queued Test Production"
        description="Decide test batches ahead of time and order their unusual ingredients early — they land on the production plan automatically."
      />
      <button onClick={() => navigate("/plans")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Back to Production Plans
      </button>

      <AddQueueForm initialDate={initialDate} onSaved={refetchAll} />

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-6"><Loader2 className="w-5 h-5 animate-spin" /> Loading queue…</div>
      ) : byDate.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center text-muted-foreground text-sm">
          Nothing queued yet. Pick a date and recipes above — ingredient requirements and early ordering appear here once queued.
        </div>
      ) : (
        byDate.map(([date, dateRows]) => {
          const expanded = expandedDates.has(date);
          const totalBatches = dateRows.reduce((s, r) => s + r.batches, 0);
          const allPlanned = dateRows.every(r => r.status === "planned");
          return (
            <div key={date} className="rounded-2xl border border-border bg-card p-4">
              <button onClick={() => toggleDate(date)} className="w-full flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold">{format(parseISO(date), "EEEE d MMM yyyy")}</span>
                  <span className="text-sm text-muted-foreground">{totalBatches} batch{totalBatches === 1 ? "" : "es"} · {dateRows.length} recipe{dateRows.length === 1 ? "" : "s"}</span>
                  {allPlanned && (
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">on plan</span>
                  )}
                </span>
                {expanded ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
              </button>
              {expanded && (
                <div className="mt-3 space-y-2">
                  {dateRows.map(row => (
                    <div key={row.id} className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-border" style={{ backgroundColor: row.recipeColor ?? "transparent" }} />
                      <span className="text-sm font-medium truncate flex-1" style={row.recipeColor ? { color: row.recipeColor } : undefined}>{row.recipeName}</span>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0",
                        row.status === "planned"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-violet-500/15 text-violet-700 dark:text-violet-400",
                      )}>
                        {row.status === "planned" ? "on plan" : "queued"}
                      </span>
                      <input
                        type="number"
                        min={1}
                        defaultValue={row.batches}
                        disabled={row.status === "planned"}
                        onBlur={e => { const v = parseInt(e.target.value); if (v && v !== row.batches) updateBatches(row, v); }}
                        className="w-16 px-2 py-1 border border-border rounded-lg text-sm text-center tabular-nums bg-background disabled:opacity-60 flex-shrink-0"
                      />
                      <span className="text-xs text-muted-foreground flex-shrink-0">batches</span>
                      {row.status !== "planned" && (
                        <button onClick={() => cancelRow(row)} className="p-1 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0" title="Remove from queue">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <DateIngredients date={date} onOrdersCreated={refetchAll} />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
