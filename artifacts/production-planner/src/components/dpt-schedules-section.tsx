/**
 * Scheduled DPT changes (Graeme, 2026-10-26): "schedule a removal of a
 * recipe ... we will keep making it next week, but only a very small amount".
 * From a start date (by PLAN date), Create Plan makes the recipe's real orders
 * — the subscription renewals — plus at most N batches a day, and gives the
 * capacity it frees to the other recipes. API: /api/dpt-schedules.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import { useListRecipes, getListRecipesQueryKey } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Schedule {
  id: number; recipeId: number; recipeName: string; startsOn: string; endsOn: string | null;
  extraBatches: number; reason: string | null; createdBy: string | null; endedAt: string | null; endedBy: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/dpt-schedules${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function DptSchedulesSection({ open }: { open: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["dpt-schedules"], queryFn: () => call<{ today: string; schedules: Schedule[] }>(""), enabled: open });
  const { data: recipes } = useListRecipes({ query: { queryKey: getListRecipesQueryKey(), enabled: open } });
  const [adding, setAdding] = useState(false);
  const [recipeId, setRecipeId] = useState<number | "">("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [extra, setExtra] = useState(2);
  const [reason, setReason] = useState("Leaving the one-time menu");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["dpt-schedules"] });
    // Create Plan's numbers depend on the rules.
    void qc.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? "").includes("calculate") });
  };
  const add = useMutation({
    mutationFn: () => call("", { method: "POST", body: JSON.stringify({ recipeId, startsOn, endsOn: endsOn || null, extraBatches: extra, reason: reason.trim() || null }) }),
    onSuccess: () => { refresh(); setAdding(false); setRecipeId(""); setStartsOn(""); setEndsOn(""); toast({ title: "Scheduled — Create Plan follows it for plans from that date" }); },
    onError: (e: Error) => toast({ title: "Didn't save", description: e.message, variant: "destructive" }),
  });
  const end = useMutation({
    mutationFn: (id: number) => call(`/${id}/end`, { method: "POST", body: "{}" }),
    onSuccess: () => { refresh(); toast({ title: "Ended — plans from today use the normal DPT again" }); },
    onError: (e: Error) => toast({ title: "Didn't save", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => call(`/${id}`, { method: "DELETE" }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Didn't delete", description: e.message, variant: "destructive" }),
  });

  const today = list.data?.today ?? "";
  const rows = list.data?.schedules ?? [];
  const live = rows.filter(s => !s.endsOn || s.endsOn >= today);
  const past = rows.filter(s => s.endsOn && s.endsOn < today);
  const choices = (recipes ?? []).filter(r => !(r as { archivedAt?: string | null }).archivedAt).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-bold flex-1">Scheduled changes</h3>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="h-10 px-3 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1.5 hover:bg-secondary">
            <Plus className="w-4 h-4" /> Schedule a change
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        From the start date, plans make the recipe's real orders (e.g. subscription renewals) plus at most the extra batches a day — the rest of the day goes to the other recipes.
      </p>

      {adding && (
        <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-3 grid gap-2 sm:grid-cols-2">
          <label className="text-sm font-semibold space-y-1 sm:col-span-2">
            <span>Recipe</span>
            <select value={recipeId} onChange={e => setRecipeId(e.target.value ? Number(e.target.value) : "")} className="w-full h-11 px-3 rounded-xl border-2 border-border bg-card">
              <option value="">Choose…</option>
              {choices.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold space-y-1">
            <span>From plan date</span>
            <input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} className="w-full h-11 px-3 rounded-xl border-2 border-border bg-card" />
          </label>
          <label className="text-sm font-semibold space-y-1">
            <span>Until (optional)</span>
            <input type="date" value={endsOn} min={startsOn || undefined} onChange={e => setEndsOn(e.target.value)} className="w-full h-11 px-3 rounded-xl border-2 border-border bg-card" />
          </label>
          <label className="text-sm font-semibold space-y-1">
            <span>Extra batches a day on top of orders</span>
            <input type="number" min={0} max={50} value={extra} onChange={e => setExtra(Math.max(0, Math.min(50, Number(e.target.value) || 0)))} className="w-full h-11 px-3 rounded-xl border-2 border-border bg-card" />
          </label>
          <label className="text-sm font-semibold space-y-1">
            <span>Why</span>
            <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} className="w-full h-11 px-3 rounded-xl border-2 border-border bg-card" />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="h-11 px-4 rounded-xl font-semibold hover:bg-secondary">Cancel</button>
            <button type="button" onClick={() => add.mutate()} disabled={!recipeId || !startsOn || add.isPending}
              className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-40">
              {add.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Schedule it
            </button>
          </div>
        </div>
      )}

      {list.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!list.isLoading && live.length === 0 && !adding && <p className="text-sm text-muted-foreground">Nothing scheduled.</p>}
      {live.map(s => {
        const started = s.startsOn <= today;
        return (
          <div key={s.id} className={cn("rounded-2xl border-2 p-3 flex flex-wrap items-center gap-x-3 gap-y-1", started ? "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20" : "border-border bg-card")}>
            <div className="flex-1 min-w-[14rem]">
              <p className="font-bold">{s.recipeName}</p>
              <p className="text-sm">Orders + {s.extraBatches} batch{s.extraBatches === 1 ? "" : "es"} a day · {started ? "since" : "from"} {fmt(s.startsOn)}{s.endsOn ? ` until ${fmt(s.endsOn)}` : " until ended"}</p>
              {(s.reason || s.createdBy) && <p className="text-xs text-muted-foreground">{s.reason}{s.createdBy ? ` · set by ${s.createdBy}` : ""}</p>}
            </div>
            {started ? (
              <button type="button" onClick={() => end.mutate(s.id)} disabled={end.isPending} className="h-10 px-3 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1.5 hover:bg-secondary">
                <XCircle className="w-4 h-4" /> End now
              </button>
            ) : (
              <button type="button" onClick={() => remove.mutate(s.id)} disabled={remove.isPending} className="h-10 px-3 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1.5 hover:bg-secondary">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
          </div>
        );
      })}
      {past.length > 0 && <p className="text-xs text-muted-foreground">{past.length} earlier rule{past.length === 1 ? "" : "s"} finished.</p>}
    </section>
  );
}
