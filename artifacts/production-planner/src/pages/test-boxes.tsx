/**
 * Test boxes (Phase 1 of the test-box tool): plan a trial box of 2–4 recipes
 * for one delivery day, and let the app work BACKWARDS to every deadline —
 * start selling, orders close, what to order from whom by when, prep/dough,
 * production, despatch — with a bigger safety buffer than a normal plan.
 * The deadlines become a tick-off to-do list, and each box sits on the
 * marketing calendar (it moves when the delivery date moves).
 * Objectives A, C and I. Same access as Sales & Marketing.
 *
 * /test-boxes       every box, as big cards
 * /test-boxes/:id   one box: settings, key dates, to-do list
 */
import { useFounderArea } from "@/hooks/use-founder-area";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Redirect, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, ChevronDown, ChevronRight, Loader2, Package, Plus, Search, Trash2, Users, X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave, type AutosaveState } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (mirror api-server/src/routes/test-boxes.ts) ─────────────────────
interface Box {
  id: number;
  name: string;
  deliveryDate: string;
  audience: "vip" | "vip_then_public" | "public";
  audienceLabel: string;
  status: string;
  notes: string | null;
  bufferPct: number;
  bufferDays: number;
  sellingDays: number;
  ordersCloseDays: number;
  vipHeadStartDays: number;
  expectedBoxes: number | null;
  recipes: Array<{ id: number; name: string }>;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
interface ListBox extends Box {
  sellingStart: string;
  ordersClose: string;
  productionDate: string;
  tasksDone: number;
  tasksTotal: number;
  nextTask: { label: string; date: string; time: string | null; past: boolean } | null;
  overdue: number;
}
interface Task {
  key: string;
  date: string;
  time?: string;
  kind: string;
  label: string;
  detail?: string;
  items?: string[];
  assumed?: boolean;
  beforeOrdersClose?: boolean;
  past: boolean;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
}
interface Schedule {
  deliveryDate: string;
  despatchDate: string;
  productionDate: string;
  prepDate: string;
  ingredientsInBy: string;
  ordersClose: string;
  sellingStart: string;
  publicStart: string | null;
  packsPerRecipe: number | null;
  tasks: Task[];
  warnings: string[];
}
interface Full { box: Box; schedule: Schedule; calendarEventId: number | null }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/test-boxes${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } };
    const field = err.details?.fieldErrors ? Object.values(err.details.fieldErrors)[0]?.[0] : undefined;
    throw new Error(err.details?.formErrors?.[0] ?? field ?? err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const STATUSES: Array<{ key: string; label: string }> = [
  { key: "planning", label: "Planning" },
  { key: "selling", label: "Selling" },
  { key: "ordering", label: "Ordering" },
  { key: "producing", label: "Producing" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];
const AUDIENCES: Array<{ key: Box["audience"]; label: string }> = [
  { key: "vip", label: "VIPs only" },
  { key: "vip_then_public", label: "VIPs first, then everyone" },
  { key: "public", label: "Everyone" },
];
const day = (iso: string) => format(parseISO(iso), "EEE d MMM");
const firstName = (n: string | null | undefined) => n?.trim().split(/\s+/)[0] || "Someone";


export default function TestBoxesPage() {
  const params = useParams<{ id?: string }>();
  // Same door as Sales & Marketing: the founder or a founder.sales grantee
  // (shared rule in @workspace/feature-registry, via useFounderArea).
  const { ready, canSales, home } = useFounderArea();
  if (!ready) return null;
  if (!canSales) return <Redirect to={home ?? "/"} />;
  const id = params.id ? Number(params.id) : null;
  return id && Number.isInteger(id) ? <TestBoxDetail id={id} /> : <TestBoxList />;
}

// ── List ────────────────────────────────────────────────────────────────────
function TestBoxList() {
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["test-boxes"],
    queryFn: () => api<{ boxes: ListBox[] }>(""),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="space-y-6">
      <Link href="/founder/sales" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Sales &amp; Marketing
      </Link>
      <PageHeader
        title="Test boxes"
        description="Pick the delivery day and the recipes — the app works back to every deadline and gives you the to-do list."
      />
      <button onClick={() => setCreating(true)}
        className="px-5 py-3 rounded-2xl bg-primary text-primary-foreground text-base font-semibold flex items-center gap-2 hover:bg-primary/90">
        <Plus className="w-5 h-5" /> New test box
      </button>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
      ) : error ? (
        <p className="text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(error as Error).message}</p>
      ) : (data?.boxes.length ?? 0) === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center space-y-2">
          <Package className="w-10 h-10 mx-auto text-rose-500" />
          <p className="text-lg font-semibold">No test boxes yet</p>
          <p className="text-muted-foreground">Start one to see the deadlines worked out from its delivery day.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {data!.boxes.map(b => <BoxCard key={b.id} box={b} />)}
        </div>
      )}

      {creating && <NewBoxModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function BoxCard({ box: b }: { box: ListBox }) {
  const pct = b.tasksTotal ? Math.round((b.tasksDone / b.tasksTotal) * 100) : 0;
  return (
    <Link href={`/test-boxes/${b.id}`} className={cn(
      "block rounded-2xl border-2 bg-card p-5 space-y-3 hover:bg-secondary/30 transition-colors",
      b.status === "cancelled" ? "border-border opacity-60" : "border-rose-500/30",
    )}>
      <div className="flex items-start gap-3">
        <span className="w-11 h-11 rounded-xl bg-rose-600 text-white flex items-center justify-center flex-shrink-0"><Package className="w-6 h-6" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold truncate">{b.name}</p>
          <p className="text-base">Delivery <b>{day(b.deliveryDate)}</b></p>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-secondary text-sm font-semibold capitalize">{b.status}</span>
      </div>
      {b.recipes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {b.recipes.map(r => <span key={r.id} className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-800 dark:text-rose-200 text-sm font-medium">{r.name}</span>)}
        </div>
      )}
      {b.nextTask && (
        <p className={cn("text-base", b.nextTask.past && "text-red-600 font-semibold")}>
          Next: {b.nextTask.label} — {day(b.nextTask.date)}{b.nextTask.time ? `, ${b.nextTask.time}` : ""}
        </p>
      )}
      <div className="space-y-1">
        <div className="h-2.5 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-rose-600" style={{ width: `${pct}%` }} /></div>
        <p className="text-sm text-muted-foreground">
          {b.tasksDone} of {b.tasksTotal} done{b.overdue > 0 && <span className="text-red-600 font-semibold"> · {b.overdue} overdue</span>}
        </p>
      </div>
    </Link>
  );
}

function NewBoxModal({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const create = useMutation({
    mutationFn: () => api<Full>("", { method: "POST", body: JSON.stringify({ name: name.trim(), deliveryDate }) }),
    onSuccess: r => { void qc.invalidateQueries({ queryKey: ["test-boxes"] }); void qc.invalidateQueries({ queryKey: ["marketing-calendar"] }); navigate(`/test-boxes/${r.box.id}`); },
  });
  const valid = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate);
  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New test box">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Package className="w-6 h-6 text-rose-600" />
          <h2 className="flex-1 font-display font-bold text-lg">New test box</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Name</span>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoFocus placeholder="e.g. Autumn pork test"
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold focus:outline-none focus:border-primary" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Delivery day <span className="font-normal text-muted-foreground">— when customers receive it (Tue–Sat)</span></span>
            <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base" />
          </label>
          <p className="text-sm text-muted-foreground">Next you'll pick 2–4 recipes; the deadlines and to-do list are worked out from here.</p>
          {create.isError && <p className="text-sm text-destructive">{(create.error as Error).message}</p>}
          <button onClick={() => create.mutate()} disabled={!valid || create.isPending}
            className="w-full px-5 py-3 rounded-xl bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {create.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Create test box
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────
type FieldKey = "name" | "deliveryDate" | "audience" | "status" | "notes" | "bufferPct" | "bufferDays" | "sellingDays" | "ordersCloseDays" | "vipHeadStartDays" | "expectedBoxes" | "recipeIds";
type Draft = Omit<Box, "recipes" | "audienceLabel" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "id"> & { recipeIds: number[] };

function draftFrom(b: Box): Draft {
  return {
    name: b.name, deliveryDate: b.deliveryDate, audience: b.audience, status: b.status, notes: b.notes ?? "",
    bufferPct: b.bufferPct, bufferDays: b.bufferDays, sellingDays: b.sellingDays, ordersCloseDays: b.ordersCloseDays,
    vipHeadStartDays: b.vipHeadStartDays, expectedBoxes: b.expectedBoxes, recipeIds: b.recipes.map(r => r.id),
  };
}
const FIELD_KEYS: FieldKey[] = ["name", "deliveryDate", "audience", "status", "notes", "bufferPct", "bufferDays", "sellingDays", "ordersCloseDays", "vipHeadStartDays", "expectedBoxes", "recipeIds"];

function TestBoxDetail({ id }: { id: number }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const key = ["test-boxes", id];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Full>(`/${id}`),
    refetchInterval: 25_000,
    refetchOnWindowFocus: true,
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const queued = useRef<Partial<Record<FieldKey, unknown>>>({});
  const lastSeen = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // First load, then other people's changes (fields you're editing are kept).
  useEffect(() => {
    if (!data) return;
    const b = data.box;
    if (lastSeen.current === b.updatedAt && draft) return;
    const fromOther = draft != null && lastSeen.current != null && b.updatedBy != null && me != null && b.updatedBy !== me.name;
    lastSeen.current = b.updatedAt;
    const server = draftFrom(b);
    setDraft(d => {
      if (!d) return server;
      const next = { ...d };
      for (const k of FIELD_KEYS) if (!(k in queued.current)) (next as Record<string, unknown>)[k] = server[k as keyof Draft];
      return next;
    });
    if (fromOther) setNotice(firstName(b.updatedBy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const auto = useAutosave<Partial<Record<FieldKey, unknown>>>(async snapshot => {
    const pending = Object.fromEntries(Object.keys(snapshot).filter(k => k in queued.current).map(k => [k, snapshot[k as FieldKey]]));
    if (Object.keys(pending).length === 0) return;
    const r = await api<Full>(`/${id}`, { method: "PATCH", body: JSON.stringify(pending) });
    for (const k of Object.keys(pending) as FieldKey[]) if (queued.current[k] === pending[k]) delete queued.current[k];
    lastSeen.current = r.box.updatedAt;
    qc.setQueryData(key, r);
    void qc.invalidateQueries({ queryKey: ["test-boxes"], exact: true });
    void qc.invalidateQueries({ queryKey: ["marketing-calendar"] });
  }, 700);

  const set = <K extends keyof Draft>(k: K, v: Draft[K], now = false) => {
    setDraft(d => (d ? { ...d, [k]: v } : d));
    queued.current = { ...queued.current, [k]: v };
    auto.schedule({ ...queued.current });
    if (now) void auto.flush();
  };

  const tick = useMutation({
    mutationFn: ({ taskKey, done }: { taskKey: string; done: boolean }) =>
      api<{ key: string; done: boolean; doneBy: string | null; doneAt: string | null }>(`/${id}/tasks/${taskKey}`, { method: "PUT", body: JSON.stringify({ done }) }),
    onMutate: ({ taskKey, done }) => {
      qc.setQueryData<Full>(key, old => old ? { ...old, schedule: { ...old.schedule, tasks: old.schedule.tasks.map(t => t.key === taskKey ? { ...t, done, doneBy: done ? (me?.name ?? null) : null } : t) } } : old);
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["test-boxes"], exact: true }); },
  });

  const del = useMutation({
    mutationFn: () => api<{ ok: true }>(`/${id}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["test-boxes"] }); void qc.invalidateQueries({ queryKey: ["marketing-calendar"] }); navigate("/test-boxes"); },
  });

  if (isLoading || (!draft && !error)) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /><Skeleton className="h-96" /></div>;
  if (error || !data || !draft) {
    return (
      <div className="space-y-4">
        <Link href="/test-boxes" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><ArrowLeft className="w-4 h-4" /> Test boxes</Link>
        <p className="text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {(error as Error)?.message ?? "Not found"}</p>
      </div>
    );
  }

  const { schedule } = data;
  const tickErr = tick.error as Error | null;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/test-boxes" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Test boxes
        </Link>
        <span className="flex-1" />
        <Link href="/founder/sales" className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300 hover:underline">
          <CalendarDays className="w-4 h-4" /> On the marketing calendar
        </Link>
        <SaveChip state={auto.state as AutosaveState} error={auto.error} onRetry={() => void auto.flush()} />
      </div>

      {notice && (
        <div className="rounded-xl border-2 border-sky-500/40 bg-sky-500/10 px-4 py-3 text-base flex items-center gap-3">
          <Users className="w-5 h-5 text-sky-600" />
          <span className="flex-1"><b>Updated by {notice}</b> just now — the page shows their changes.</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="p-1.5"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* The box */}
      <section className="rounded-2xl border-2 border-rose-500/30 bg-card p-5 space-y-5">
        <div className="flex items-start gap-3">
          <span className="w-12 h-12 rounded-xl bg-rose-600 text-white flex items-center justify-center flex-shrink-0"><Package className="w-7 h-7" /></span>
          <input value={draft.name} onChange={e => set("name", e.target.value)} onBlur={() => void auto.flush()} maxLength={120}
            aria-label="Test box name"
            className="flex-1 min-w-0 px-3 py-2 rounded-xl border-2 border-transparent hover:border-border focus:border-primary bg-transparent text-2xl font-bold focus:outline-none" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Delivery day</span>
            <input type="date" value={draft.deliveryDate}
              onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) set("deliveryDate", e.target.value, true); else setDraft(d => d ? { ...d, deliveryDate: e.target.value } : d); }}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold" />
          </label>
          <div className="space-y-1.5">
            <span className="block text-sm font-semibold">Expected boxes sold <span className="font-normal text-muted-foreground">— optional</span></span>
            <NumberField value={draft.expectedBoxes} allowEmpty min={0} max={100000} onChange={v => set("expectedBoxes", v)} onBlur={() => void auto.flush()} />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-sm font-semibold">Who can buy it</span>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map(a => <Chip key={a.key} active={draft.audience === a.key} onClick={() => set("audience", a.key, true)}>{a.label}</Chip>)}
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold">Status</span>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map(s => <Chip key={s.key} active={draft.status === s.key} onClick={() => set("status", s.key, true)}>{s.label}</Chip>)}
          </div>
        </div>

        <RecipePicker ids={draft.recipeIds} names={data.box.recipes} onChange={ids => set("recipeIds", ids, true)} />
      </section>

      {schedule.warnings.length > 0 && (
        <div className="space-y-2">
          {schedule.warnings.map((w, i) => (
            <div key={i} className="rounded-xl border-2 border-amber-500/40 bg-amber-500/10 px-4 py-3 text-base flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" /><span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Key dates */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">Key dates</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DateTile label={draft.audience === "public" ? "Start selling" : "Start selling (VIPs)"} date={schedule.sellingStart} />
          {schedule.publicStart && <DateTile label="Public launch" date={schedule.publicStart} />}
          <DateTile label="Orders close" date={schedule.ordersClose} />
          <DateTile label="Ingredients in by" date={schedule.ingredientsInBy} />
          <DateTile label="Prep & dough" date={schedule.prepDate} />
          <DateTile label="Production" date={schedule.productionDate} strong />
          <DateTile label="Despatch" date={schedule.despatchDate} />
          <DateTile label="Delivery" date={schedule.deliveryDate} strong />
        </div>
        {schedule.packsPerRecipe != null && (
          <p className="text-base">Make <b>{schedule.packsPerRecipe} packs of each recipe</b> ({draft.expectedBoxes} boxes + {draft.bufferPct}% buffer, one pack of each recipe per box).</p>
        )}
      </section>

      {/* To-do list */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold">To-do for this delivery</h2>
        {tickErr && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Couldn't save the tick: {tickErr.message}</p>}
        <ol className="space-y-2.5">
          {schedule.tasks.map(t => <TaskRow key={t.key} task={t} onToggle={done => tick.mutate({ taskKey: t.key, done })} />)}
        </ol>
      </section>

      {/* Buffers */}
      <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold">Safety buffers</h2>
          <p className="text-sm text-muted-foreground">Test boxes carry more buffer than a normal plan — demand is a guess until the orders are in.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Setting label="Extra product" hint="% on top of orders" value={draft.bufferPct} min={0} max={200} onChange={v => set("bufferPct", v ?? 0)} onBlur={() => void auto.flush()} />
          <Setting label="Ingredients early" hint="working days before prep day" value={draft.bufferDays} min={0} max={15} onChange={v => set("bufferDays", v ?? 0)} onBlur={() => void auto.flush()} />
          <Setting label="Selling window" hint="days on sale before orders close" value={draft.sellingDays} min={1} max={120} onChange={v => set("sellingDays", v ?? 1)} onBlur={() => void auto.flush()} />
          <Setting label="Orders close" hint="working days before production" value={draft.ordersCloseDays} min={0} max={20} onChange={v => set("ordersCloseDays", v ?? 0)} onBlur={() => void auto.flush()} />
          {draft.audience === "vip_then_public" && (
            <Setting label="VIP head start" hint="days before everyone else" value={draft.vipHeadStartDays} min={0} max={60} onChange={v => set("vipHeadStartDays", v ?? 0)} onBlur={() => void auto.flush()} />
          )}
        </div>
      </section>

      <section className="space-y-1.5">
        <h2 className="text-lg font-bold">Notes</h2>
        <textarea value={draft.notes ?? ""} onChange={e => set("notes", e.target.value)} onBlur={() => void auto.flush()} rows={5} maxLength={10000}
          placeholder="What we're testing, what we learned last time…"
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary resize-y" />
        <p className="text-sm text-muted-foreground">
          Added by {firstName(data.box.createdBy)} · last changed by {firstName(data.box.updatedBy)} {formatDistanceToNowStrict(parseISO(data.box.updatedAt))} ago
        </p>
      </section>

      <div className="pt-2 border-t border-border">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="px-4 py-2.5 rounded-xl border-2 border-red-500/40 text-red-600 font-semibold flex items-center gap-2 hover:bg-red-500/10">
            <Trash2 className="w-4 h-4" /> Delete test box
          </button>
        ) : (
          <div className="rounded-xl border-2 border-red-500/50 bg-red-500/10 p-4 space-y-3">
            <p className="font-semibold text-base">Are you sure? “{draft.name}” and its calendar event come off for everyone.</p>
            {del.isError && <p className="text-sm text-destructive">{(del.error as Error).message}</p>}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => del.mutate()} disabled={del.isPending} className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-semibold flex items-center gap-2 disabled:opacity-60">
                {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Yes, delete it
              </button>
              <button onClick={() => setConfirmDelete(false)} className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold">Keep it</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DateTile({ label, date, strong }: { label: string; date: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-2xl p-3.5", strong ? "bg-rose-600 text-white" : "bg-secondary/50")}>
      <p className={cn("text-sm", strong ? "text-white/85" : "text-muted-foreground")}>{label}</p>
      <p className="text-lg font-bold">{day(date)}</p>
    </div>
  );
}

function TaskRow({ task: t, onToggle }: { task: Task; onToggle: (done: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const overdue = t.past && !t.done;
  return (
    <li className={cn(
      "rounded-2xl border-2 bg-card flex items-start gap-3 p-3.5",
      t.done ? "border-border opacity-60" : overdue ? "border-red-500/50" : "border-border",
    )}>
      <button
        onClick={() => onToggle(!t.done)}
        aria-pressed={t.done}
        aria-label={t.done ? `Untick ${t.label}` : `Tick ${t.label}`}
        className={cn("w-9 h-9 rounded-xl border-2 flex items-center justify-center flex-shrink-0",
          t.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary")}
      >
        {t.done && <Check className="w-5 h-5" />}
      </button>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-base font-bold tabular-nums", overdue && "text-red-600")}>{day(t.date)}{t.time ? `, ${t.time}` : ""}</span>
          <span className={cn("text-base font-semibold", t.done && "line-through")}>{t.label}</span>
          {overdue && <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold uppercase">Overdue</span>}
          {t.assumed && <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-semibold">Lead time assumed</span>}
          {t.beforeOrdersClose && !t.done && <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-800 dark:text-sky-300 text-xs font-semibold">Before orders close — order on forecast + buffer</span>}
        </p>
        {t.detail && <p className="text-sm text-muted-foreground">{t.detail}</p>}
        {t.items && t.items.length > 0 && (
          <div>
            <button onClick={() => setOpen(o => !o)} className="text-sm font-semibold text-primary inline-flex items-center gap-1">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} {t.items.length} ingredient{t.items.length === 1 ? "" : "s"}
            </button>
            {open && <p className="text-sm mt-1">{t.items.join(", ")}</p>}
          </div>
        )}
        {t.done && t.doneBy && <p className="text-xs text-muted-foreground">Ticked by {firstName(t.doneBy)}{t.doneAt ? ` · ${format(parseISO(t.doneAt), "d MMM HH:mm")}` : ""}</p>}
      </div>
    </li>
  );
}

function RecipePicker({ ids, names, onChange }: { ids: number[]; names: Array<{ id: number; name: string }>; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["test-boxes", "recipe-options"],
    queryFn: () => api<{ recipes: Array<{ id: number; name: string; category: string | null }> }>("/recipe-options"),
    staleTime: 5 * 60_000,
  });
  const all = data?.recipes ?? [];
  const nameOf = (id: number) => all.find(r => r.id === id)?.name ?? names.find(r => r.id === id)?.name ?? `Recipe ${id}`;
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return all.filter(r => !ids.includes(r.id) && r.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [q, all, ids]);
  const full = ids.length >= 4;

  return (
    <div className="space-y-2">
      <span className="block text-sm font-semibold">Recipes <span className="font-normal text-muted-foreground">— 2 to 4</span></span>
      <div className="flex flex-wrap gap-2">
        {ids.map(id => (
          <span key={id} className="pl-3.5 pr-1.5 py-1.5 rounded-full bg-rose-500/10 text-rose-900 dark:text-rose-100 text-base font-semibold inline-flex items-center gap-1.5">
            {nameOf(id)}
            <button onClick={() => onChange(ids.filter(x => x !== id))} className="p-1 rounded-full hover:bg-rose-500/20" aria-label={`Remove ${nameOf(id)}`}><X className="w-4 h-4" /></button>
          </span>
        ))}
        {ids.length === 0 && <span className="text-muted-foreground">None yet.</span>}
      </div>
      {!full && (
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Add a recipe — type any part of its name"
            onKeyDown={e => { if (e.key === "Enter" && matches[0]) { onChange([...ids, matches[0].id]); setQ(""); } if (e.key === "Escape") setQ(""); }}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary" />
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-xl border-2 border-border bg-card shadow-xl max-h-72 overflow-y-auto">
              {matches.map(r => (
                <li key={r.id}>
                  <button onClick={() => { onChange([...ids, r.id]); setQ(""); }} className="w-full text-left px-4 py-2.5 hover:bg-secondary/60 text-base">
                    {r.name}{r.category && <span className="text-sm text-muted-foreground"> · {r.category}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {full && <p className="text-sm text-muted-foreground">Four recipes is the most a test box takes.</p>}
    </div>
  );
}

function Setting({ label, hint, value, min, max, onChange, onBlur }: {
  label: string; hint: string; value: number; min: number; max: number; onChange: (v: number | null) => void; onBlur: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-semibold">{label} <span className="font-normal text-muted-foreground">— {hint}</span></span>
      <NumberField value={value} min={min} max={max} onChange={onChange} onBlur={onBlur} />
    </div>
  );
}

/** A number box that only sends whole numbers inside the allowed range. */
function NumberField({ value, min, max, allowEmpty, onChange, onBlur }: {
  value: number | null; min: number; max: number; allowEmpty?: boolean; onChange: (v: number | null) => void; onBlur: () => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value == null ? "" : String(value)); }, [value]);
  const n = Number(text);
  const invalid = text === "" ? !allowEmpty : !Number.isInteger(n) || n < min || n > max;
  return (
    <div>
      <input
        inputMode="numeric"
        value={text}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; onBlur(); }}
        onChange={e => {
          const t = e.target.value.replace(/[^\d]/g, "");
          setText(t);
          const v = Number(t);
          if (t === "" && allowEmpty) onChange(null);
          else if (t !== "" && Number.isInteger(v) && v >= min && v <= max) onChange(v);
        }}
        className={cn("w-full px-4 py-3 rounded-xl border-2 bg-background text-lg font-semibold focus:outline-none",
          invalid ? "border-destructive" : "border-border focus:border-primary")}
      />
      {invalid && <p className="text-sm text-destructive mt-1">Between {min} and {max}{allowEmpty ? ", or leave empty" : ""} — not saved.</p>}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("px-4 py-2 rounded-full border-2 text-base font-semibold transition-colors",
        active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary/50")}>
      {children}
    </button>
  );
}
