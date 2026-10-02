/**
 * Test boxes (reworked 2026-10-02): a trial box of 2–4 recipes that launches
 * to VIP Calzoney Club members first (a guaranteed 48 hours), maybe to
 * everyone later, and is delivered on one or more dates added over time.
 *
 *   - Launch checklist: the one-off steps (Shopify, discount, Zapiet,
 *     emails, social), each with a due date and a short "how".
 *   - Delivery dates: each one works BACKWARDS to its own deadlines; orders
 *     close BY HAND ("Close orders for 16 Oct"), and the card shows the
 *     latest day they can close (specialist ingredients pull it earlier).
 *   - Every step is also a to-do on the owner's list, and the box sits on the
 *     marketing calendar with its VIP launch email and social-post note.
 *
 * Nothing on this page touches Shopify, Zapiet or Klaviyo, or sends email.
 * Objectives A, C and I. Same access as Sales & Marketing.
 *
 * /test-boxes       every box, as big cards
 * /test-boxes/:id   one box
 */
import { useFounderArea } from "@/hooks/use-founder-area";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Redirect, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, ChevronDown, ChevronRight, Clock, Crown, ExternalLink, Loader2, Lock, Package,
  Plus, Rocket, Search, Trash2, Truck, Users, X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAutosave, type AutosaveState } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { RecipeDraftBadge } from "@/components/recipe-archive";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (mirror api-server/src/routes/test-boxes.ts) ─────────────────────
type DeliveryStatus = "open" | "closed" | "queued" | "made" | "delivered" | "cancelled";
type ProductionMix = "test_only" | "test_plus_normal";
interface Box {
  id: number;
  name: string;
  launchDate: string;
  publicLaunchDate: string | null;
  owner: { id: number; name: string } | null;
  status: string;
  notes: string | null;
  bufferPct: number;
  bufferDays: number;
  ordersCloseDays: number;
  expectedBoxes: number | null;
  recipes: Array<{ id: number; name: string; isDraft: boolean }>;
  launchEmailId: number | null;
  socialNoteEventId: number | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
interface ListBox extends Box {
  deliveries: Array<{ id: number; deliveryDate: string; status: DeliveryStatus; latestClose: string }>;
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
  how?: string;
  link?: string;
  items?: string[];
  assumed?: boolean;
  specialist?: boolean;
  beforeOrdersClose?: boolean;
  clamped?: boolean;
  automated?: boolean;
  past: boolean;
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
  todoId: number | null;
}
interface Delivery {
  id: number;
  deliveryDate: string;
  status: DeliveryStatus;
  despatchDate: string;
  productionDate: string;
  prepDate: string;
  ingredientsInBy: string;
  latestClose: string;
  closeDriver: { reason: "specialist" | "standard"; supplier?: string; items?: string[] };
  closedOn: string | null;
  closedBy: string | null;
  productionMix: ProductionMix | null;
  expectedBoxes: number | null;
  packsPerRecipe: number | null;
  tasks: Task[];
  afterClose: string[];
  warnings: string[];
}
interface Schedule {
  launchDate: string;
  publicLaunchDate: string | null;
  vipWindowEnds: string;
  vipGuaranteeHours: number;
  specialistExtraDays: number;
  tightTimeline: boolean;
  warnings: string[];
  launchTasks: Task[];
  deliveries: Delivery[];
}
interface Full { today: string; box: Box; schedule: Schedule; calendarEventId: number | null }

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

const BOX_STATUSES: Array<{ key: string; label: string }> = [
  { key: "planning", label: "Planning" },
  { key: "selling", label: "Selling" },
  { key: "ordering", label: "Ordering" },
  { key: "producing", label: "Producing" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];
const DELIVERY_STATUSES: Array<{ key: DeliveryStatus; label: string; tone: string }> = [
  { key: "open", label: "Open — selling", tone: "bg-emerald-600 text-white" },
  { key: "closed", label: "Closed", tone: "bg-amber-500 text-white" },
  { key: "queued", label: "Production queued", tone: "bg-violet-600 text-white" },
  { key: "made", label: "Made", tone: "bg-sky-600 text-white" },
  { key: "delivered", label: "Delivered", tone: "bg-slate-600 text-white" },
  { key: "cancelled", label: "Cancelled", tone: "bg-secondary text-muted-foreground" },
];
const statusOf = (k: DeliveryStatus) => DELIVERY_STATUSES.find(s => s.key === k) ?? DELIVERY_STATUSES[0];
const day = (iso: string) => format(parseISO(iso), "EEE d MMM");
const dayMonth = (iso: string) => format(parseISO(iso), "d MMM");
const firstName = (n: string | null | undefined) => n?.trim().split(/\s+/)[0] || "Someone";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
        description="Pick the VIP launch day, add delivery dates as you go — the app works out every deadline and puts each step on the owner's to-do list."
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
          <p className="text-muted-foreground">Start one to get its launch checklist and delivery deadlines.</p>
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
          <p className="text-base">VIP launch <b>{day(b.launchDate)}</b>{b.owner && <span className="text-muted-foreground"> · {firstName(b.owner.name)}</span>}</p>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-secondary text-sm font-semibold capitalize">{b.status}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {b.deliveries.length === 0
          ? <span className="text-sm text-muted-foreground">No delivery date yet</span>
          : b.deliveries.map(d => (
            <span key={d.id} className={cn("px-2.5 py-1 rounded-full text-sm font-semibold inline-flex items-center gap-1.5", statusOf(d.status).tone)}>
              <Truck className="w-3.5 h-3.5" /> {dayMonth(d.deliveryDate)} · {statusOf(d.status).label.replace(" — selling", "")}
            </span>
          ))}
      </div>
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

function Modal({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          {icon}
          <h2 className="flex-1 font-display font-bold text-lg">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function NewBoxModal({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [launchDate, setLaunchDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const create = useMutation({
    mutationFn: () => api<Full>("", { method: "POST", body: JSON.stringify({ name: name.trim(), launchDate, ...(deliveryDate ? { firstDeliveryDate: deliveryDate } : {}) }) }),
    onSuccess: r => { void qc.invalidateQueries({ queryKey: ["test-boxes"] }); void qc.invalidateQueries({ queryKey: ["marketing-calendar"] }); navigate(`/test-boxes/${r.box.id}`); },
  });
  const valid = name.trim().length > 0 && DATE_RE.test(launchDate) && (deliveryDate === "" || (DATE_RE.test(deliveryDate) && deliveryDate > launchDate));
  return (
    <Modal title="New test box" icon={<Package className="w-6 h-6 text-rose-600" />} onClose={onClose}>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Name</span>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoFocus placeholder="e.g. Autumn pork test box"
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold focus:outline-none focus:border-primary" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">VIP launch <span className="font-normal text-muted-foreground">— the day VIP Calzoney Club members can first buy it</span></span>
        <input type="date" value={launchDate} onChange={e => setLaunchDate(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">First delivery date <span className="font-normal text-muted-foreground">— optional, Tue–Sat; add more later</span></span>
        <input type="date" value={deliveryDate} min={launchDate || undefined} onChange={e => setDeliveryDate(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base" />
      </label>
      <p className="text-sm text-muted-foreground">Next you'll pick 2–4 recipes. The launch checklist and each delivery's deadlines are worked out from these dates, and land on your to-do list.</p>
      {create.isError && <p className="text-sm text-destructive">{(create.error as Error).message}</p>}
      <button onClick={() => create.mutate()} disabled={!valid || create.isPending}
        className="w-full px-5 py-3 rounded-xl bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        {create.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Create test box
      </button>
    </Modal>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────
type FieldKey = "name" | "launchDate" | "publicLaunchDate" | "ownerId" | "status" | "notes" | "bufferPct" | "bufferDays" | "ordersCloseDays" | "expectedBoxes" | "recipeIds";
interface Draft {
  name: string; launchDate: string; publicLaunchDate: string | null; ownerId: number | null; status: string; notes: string;
  bufferPct: number; bufferDays: number; ordersCloseDays: number; expectedBoxes: number | null; recipeIds: number[];
}
function draftFrom(b: Box): Draft {
  return {
    name: b.name, launchDate: b.launchDate, publicLaunchDate: b.publicLaunchDate, ownerId: b.owner?.id ?? null, status: b.status,
    notes: b.notes ?? "", bufferPct: b.bufferPct, bufferDays: b.bufferDays, ordersCloseDays: b.ordersCloseDays,
    expectedBoxes: b.expectedBoxes, recipeIds: b.recipes.map(r => r.id),
  };
}
const FIELD_KEYS: FieldKey[] = ["name", "launchDate", "publicLaunchDate", "ownerId", "status", "notes", "bufferPct", "bufferDays", "ordersCloseDays", "expectedBoxes", "recipeIds"];

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
  const owners = useQuery({
    queryKey: ["test-boxes", "owner-options"],
    queryFn: () => api<{ people: Array<{ id: number; name: string }> }>("/owner-options"),
    staleTime: 5 * 60_000,
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const queued = useRef<Partial<Record<FieldKey, unknown>>>({});
  const lastSeen = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);

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
      for (const k of FIELD_KEYS) if (!(k in queued.current)) (next as unknown as Record<string, unknown>)[k] = server[k as keyof Draft];
      return next;
    });
    if (fromOther) setNotice(firstName(b.updatedBy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const afterWrite = (r: Full) => {
    lastSeen.current = r.box.updatedAt;
    qc.setQueryData(key, r);
    void qc.invalidateQueries({ queryKey: ["test-boxes"], exact: true });
    void qc.invalidateQueries({ queryKey: ["marketing-calendar"] });
    void qc.invalidateQueries({ queryKey: ["todos"] });
  };

  const auto = useAutosave<Partial<Record<FieldKey, unknown>>>(async snapshot => {
    const pending = Object.fromEntries(Object.keys(snapshot).filter(k => k in queued.current).map(k => [k, snapshot[k as FieldKey]]));
    if (Object.keys(pending).length === 0) return;
    const r = await api<Full>(`/${id}`, { method: "PATCH", body: JSON.stringify(pending) });
    for (const k of Object.keys(pending) as FieldKey[]) if (queued.current[k] === pending[k]) delete queued.current[k];
    afterWrite(r);
  }, 700);

  const set = <K extends keyof Draft>(k: K, v: Draft[K], now = false) => {
    setDraft(d => (d ? { ...d, [k]: v } : d));
    queued.current = { ...queued.current, [k]: v };
    auto.schedule({ ...queued.current });
    if (now) void auto.flush();
  };

  const tick = useMutation({
    mutationFn: ({ taskKey, done }: { taskKey: string; done: boolean }) =>
      api<Full>(`/${id}/tasks/${taskKey}`, { method: "PUT", body: JSON.stringify({ done }) }),
    onMutate: ({ taskKey, done }) => {
      const flip = (t: Task) => (t.key === taskKey ? { ...t, done, doneBy: done ? (me?.name ?? null) : null } : t);
      qc.setQueryData<Full>(key, old => old ? {
        ...old,
        schedule: { ...old.schedule, launchTasks: old.schedule.launchTasks.map(flip), deliveries: old.schedule.deliveries.map(d => ({ ...d, tasks: d.tasks.map(flip) })) },
      } : old);
    },
    onSuccess: afterWrite,
    onError: () => { void qc.invalidateQueries({ queryKey: key }); },
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

  const { schedule, today } = data;
  const tickErr = tick.error as Error | null;
  const inVipWindow = today <= schedule.vipWindowEnds;
  const launchDone = schedule.launchTasks.filter(t => t.done).length;
  const ownerList = owners.data?.people ?? (data.box.owner ? [data.box.owner] : []);

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

      {/* ── The box ── */}
      <section className="rounded-2xl border-2 border-rose-500/30 bg-card p-5 space-y-5">
        <div className="flex items-start gap-3">
          <span className="w-12 h-12 rounded-xl bg-rose-600 text-white flex items-center justify-center flex-shrink-0"><Package className="w-7 h-7" /></span>
          <input value={draft.name} onChange={e => set("name", e.target.value)} onBlur={() => void auto.flush()} maxLength={120}
            aria-label="Test box name"
            className="flex-1 min-w-0 px-3 py-2 rounded-xl border-2 border-transparent hover:border-border focus:border-primary bg-transparent text-2xl font-bold focus:outline-none" />
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold flex items-center gap-1.5"><Crown className="w-4 h-4 text-amber-500" /> VIP launch</span>
            <input type="date" value={draft.launchDate}
              onChange={e => { if (DATE_RE.test(e.target.value)) set("launchDate", e.target.value, true); else setDraft(d => d ? { ...d, launchDate: e.target.value } : d); }}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold" />
          </label>
          <div className="space-y-1.5">
            <span className="text-sm font-semibold flex items-center gap-1.5"><Rocket className="w-4 h-4 text-rose-600" /> Public launch <span className="font-normal text-muted-foreground">— optional</span></span>
            {draft.publicLaunchDate == null ? (
              <button onClick={() => set("publicLaunchDate", schedule.vipWindowEnds, true)}
                className="w-full px-4 py-3 rounded-xl border-2 border-dashed border-border text-base font-semibold text-muted-foreground hover:bg-secondary/50 flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" /> Add a public launch
              </button>
            ) : (
              <div className="flex gap-2">
                <input type="date" value={draft.publicLaunchDate} min={draft.launchDate}
                  onChange={e => { if (DATE_RE.test(e.target.value)) set("publicLaunchDate", e.target.value, true); }}
                  className="flex-1 min-w-0 px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold" />
                <button onClick={() => set("publicLaunchDate", null, true)} aria-label="Remove the public launch" className="px-3 rounded-xl border-2 border-border hover:bg-secondary/50"><X className="w-5 h-5" /></button>
              </div>
            )}
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">Owner <span className="font-normal text-muted-foreground">— gets the to-dos</span></span>
            <select value={draft.ownerId ?? ""} onChange={e => set("ownerId", Number(e.target.value), true)}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold">
              {draft.ownerId == null && <option value="">Choose…</option>}
              {ownerList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="space-y-1.5">
            <span className="block text-sm font-semibold">Expected boxes <span className="font-normal text-muted-foreground">— per delivery, optional</span></span>
            <NumberField value={draft.expectedBoxes} allowEmpty min={0} max={100000} onChange={v => set("expectedBoxes", v)} onBlur={() => void auto.flush()} />
          </div>
        </div>

        {/* VIP guarantee */}
        <div className="rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 p-4 flex items-start gap-3">
          <Crown className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-base font-bold">VIP-only until {day(schedule.vipWindowEnds)}</p>
            <p className="text-sm text-muted-foreground">VIP Calzoney Club members get a guaranteed {schedule.vipGuaranteeHours} hours from launch before anything is cut off.</p>
            {inVipWindow && <p className="text-sm font-semibold">Keep restocking if it sells out until every VIP has had the chance to buy.</p>}
          </div>
        </div>

        <RecipePicker ids={draft.recipeIds} names={data.box.recipes} onChange={ids => set("recipeIds", ids, true)} />

        <div className="space-y-1.5">
          <span className="block text-sm font-semibold">The story <span className="font-normal text-muted-foreground">— what we're testing and why</span></span>
          <textarea value={draft.notes} onChange={e => set("notes", e.target.value)} onBlur={() => void auto.flush()} rows={4} maxLength={10000}
            placeholder="What we're testing, what we learned last time…"
            className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base focus:outline-none focus:border-primary resize-y" />
        </div>
      </section>

      {schedule.warnings.length > 0 && <Warnings list={schedule.warnings} />}

      {/* ── Launch checklist ── */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-xl font-bold">Launch checklist</h2>
          <span className="text-sm text-muted-foreground">{launchDone} of {schedule.launchTasks.length} done · on {firstName(data.box.owner?.name)}'s to-do list</span>
        </div>
        {tickErr && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Couldn't save the tick: {tickErr.message}</p>}
        <ol className="space-y-2.5">
          {schedule.launchTasks.map(t => <TaskRow key={t.key} task={t} onToggle={done => tick.mutate({ taskKey: t.key, done })} />)}
        </ol>
      </section>

      {/* ── Delivery dates ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-bold flex-1">Delivery dates</h2>
          <button onClick={() => setAdding(true)}
            className="px-4 py-2.5 rounded-xl bg-rose-600 text-white text-base font-semibold flex items-center gap-2 hover:bg-rose-700">
            <Plus className="w-5 h-5" /> Add delivery date
          </button>
        </div>
        {schedule.deliveries.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border p-6 text-center space-y-1">
            <Truck className="w-8 h-8 mx-auto text-rose-500" />
            <p className="text-base font-semibold">No delivery date yet</p>
            <p className="text-sm text-muted-foreground">Add one to see its production chain — you can add more as orders come in.</p>
          </div>
        ) : (
          schedule.deliveries.map(d => (
            <DeliveryCard key={d.id} boxId={id} boxName={data.box.name} delivery={d} today={today}
              specialistExtraDays={schedule.specialistExtraDays}
              onWritten={afterWrite} onToggle={(taskKey, done) => tick.mutate({ taskKey, done })} />
          ))
        )}
      </section>

      {/* ── Buffers & status ── */}
      <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold">Safety buffers</h2>
          <p className="text-sm text-muted-foreground">Test boxes carry more buffer than a normal plan — demand is a guess until the orders are in.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Setting label="Extra product" hint="% on top of orders" value={draft.bufferPct} min={0} max={200} onChange={v => set("bufferPct", v ?? 0)} onBlur={() => void auto.flush()} />
          <Setting label="Ingredients early" hint="working days before prep day" value={draft.bufferDays} min={0} max={15} onChange={v => set("bufferDays", v ?? 0)} onBlur={() => void auto.flush()} />
          <Setting label="Close orders" hint="working days before production (without specialist ingredients)" value={draft.ordersCloseDays} min={0} max={20} onChange={v => set("ordersCloseDays", v ?? 0)} onBlur={() => void auto.flush()} />
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold">Box status</span>
          <div className="flex flex-wrap gap-2">
            {BOX_STATUSES.map(s => <Chip key={s.key} active={draft.status === s.key} onClick={() => set("status", s.key, true)}>{s.label}</Chip>)}
          </div>
          {draft.status === "cancelled" && <p className="text-sm text-muted-foreground">Cancelled: it's off the calendar and its open to-dos have been removed.</p>}
        </div>
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
            <p className="font-semibold text-base">Are you sure? “{draft.name}”, its calendar bar, its planned launch email and note, and its open to-dos come off for everyone.</p>
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

      {adding && <AddDeliveryModal boxId={id} launchDate={draft.launchDate} expectedBoxes={draft.expectedBoxes} onClose={() => setAdding(false)} onAdded={r => { afterWrite(r); setAdding(false); }} />}
    </div>
  );
}

function Warnings({ list }: { list: string[] }) {
  return (
    <div className="space-y-2">
      {list.map((w, i) => (
        <div key={i} className="rounded-xl border-2 border-amber-500/40 bg-amber-500/10 px-4 py-3 text-base flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" /><span>{w}</span>
        </div>
      ))}
    </div>
  );
}

function AddDeliveryModal({ boxId, launchDate, expectedBoxes, onClose, onAdded }: {
  boxId: number; launchDate: string; expectedBoxes: number | null; onClose: () => void; onAdded: (r: Full) => void;
}) {
  const [date, setDate] = useState("");
  const add = useMutation({
    mutationFn: () => api<Full>(`/${boxId}/deliveries`, { method: "POST", body: JSON.stringify({ deliveryDate: date, expectedBoxes }) }),
    onSuccess: onAdded,
  });
  const valid = DATE_RE.test(date) && date > launchDate;
  return (
    <Modal title="Add delivery date" icon={<Truck className="w-6 h-6 text-rose-600" />} onClose={onClose}>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Delivery day <span className="font-normal text-muted-foreground">— when customers receive it (Tue–Sat)</span></span>
        <input type="date" value={date} min={launchDate} autoFocus onChange={e => setDate(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-lg font-semibold" />
      </label>
      <p className="text-sm text-muted-foreground">It gets its own deadlines and to-dos, and a "switch it on in Zapiet" step on the launch checklist.</p>
      {add.isError && <p className="text-sm text-destructive">{(add.error as Error).message}</p>}
      <button onClick={() => add.mutate()} disabled={!valid || add.isPending}
        className="w-full px-5 py-3 rounded-xl bg-rose-600 text-white text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        {add.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Add delivery date
      </button>
    </Modal>
  );
}

function DeliveryCard({ boxId, boxName, delivery: d, today, specialistExtraDays, onWritten, onToggle }: {
  boxId: number; boxName: string; delivery: Delivery; today: string; specialistExtraDays: number;
  onWritten: (r: Full) => void; onToggle: (taskKey: string, done: boolean) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expected, setExpected] = useState<number | null>(d.expectedBoxes);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setExpected(d.expectedBoxes); }, [d.expectedBoxes]);

  const patch = async (body: Record<string, unknown>) => {
    const r = await api<Full>(`/${boxId}/deliveries/${d.id}`, { method: "PATCH", body: JSON.stringify(body) });
    onWritten(r);
  };
  const auto = useAutosave<Record<string, unknown>>(async body => { await patch(body); dirty.current = false; }, 700);
  const now = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Full>(`/${boxId}/deliveries/${d.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: onWritten,
  });
  const close = useMutation({
    mutationFn: (closed: boolean) => api<Full>(`/${boxId}/deliveries/${d.id}/close`, { method: "POST", body: JSON.stringify({ closed }) }),
    onSuccess: onWritten,
  });
  const remove = useMutation({
    mutationFn: () => api<Full>(`/${boxId}/deliveries/${d.id}`, { method: "DELETE" }),
    onSuccess: onWritten,
  });

  const st = statusOf(d.status);
  const isOpen = d.status === "open";
  const cancelled = d.status === "cancelled";
  const pastClose = isOpen && d.latestClose < today;
  const writeErr = (now.error ?? close.error ?? remove.error) as Error | null;
  const saveState: AutosaveState = now.isPending || close.isPending ? "saving" : auto.state;

  return (
    <article className={cn("rounded-2xl border-2 bg-card p-5 space-y-4", cancelled ? "border-border opacity-70" : "border-rose-500/30")}>
      <header className="flex items-start gap-3 flex-wrap">
        <span className="w-12 h-12 rounded-xl bg-rose-600 text-white flex items-center justify-center flex-shrink-0"><Truck className="w-7 h-7" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">Delivery</p>
          <p className="text-2xl font-bold">{format(parseISO(d.deliveryDate), "EEEE d MMMM")}</p>
        </div>
        <span className={cn("px-3 py-1.5 rounded-full text-sm font-bold", st.tone)}>{st.label}</span>
        <SaveChip state={saveState} error={auto.error} onRetry={() => void auto.flush()} />
      </header>

      {!cancelled && (
        <div className={cn("rounded-2xl p-4 flex items-center gap-4 flex-wrap", pastClose ? "bg-amber-500/15 border-2 border-amber-500/50" : "bg-secondary/50")}>
          <div className="flex-1 min-w-[14rem] space-y-0.5">
            {isOpen ? (<>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Clock className="w-4 h-4" /> Close orders by (latest)</p>
              <p className={cn("text-xl font-bold", pastClose && "text-amber-700 dark:text-amber-300")}>{day(d.latestClose)}</p>
              <p className="text-sm text-muted-foreground">
                {d.closeDriver.reason === "specialist"
                  ? <>Set by <b>{d.closeDriver.items?.join(", ")}</b> from {d.closeDriver.supplier} — a specialist ingredient (+{specialistExtraDays} working days' lead time).</>
                  : "Production minus the orders-close days (no specialist ingredients pulling it earlier)."}
              </p>
            </>) : (<>
              <p className="text-sm text-muted-foreground">Orders closed</p>
              <p className="text-xl font-bold">{d.closedOn ? day(d.closedOn) : "—"}{d.closedBy && <span className="text-base font-normal text-muted-foreground"> by {firstName(d.closedBy)}</span>}</p>
            </>)}
          </div>
          {isOpen && (
            <button onClick={() => close.mutate(true)} disabled={close.isPending}
              className="px-5 py-3 rounded-xl bg-rose-600 text-white text-base font-bold flex items-center gap-2 hover:bg-rose-700 disabled:opacity-60">
              {close.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />} Close orders for {dayMonth(d.deliveryDate)}
            </button>
          )}
          {d.status === "closed" && (
            <button onClick={() => close.mutate(false)} disabled={close.isPending}
              className="px-4 py-2.5 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary/60 disabled:opacity-60">
              Reopen orders
            </button>
          )}
        </div>
      )}

      {!cancelled && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <DateTile label="Ingredients in by" date={d.ingredientsInBy} />
          <DateTile label="Prep & dough" date={d.prepDate} />
          <DateTile label="Production" date={d.productionDate} strong />
          <DateTile label="Despatch" date={d.despatchDate} />
          <DateTile label="Delivery" date={d.deliveryDate} strong />
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 items-start">
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold">Expected boxes for this date <span className="font-normal text-muted-foreground">— optional</span></span>
          <NumberField value={expected} allowEmpty min={0} max={100000}
            onChange={v => { dirty.current = true; setExpected(v); auto.schedule({ expectedBoxes: v }); }}
            onBlur={() => void auto.flush()} />
          {d.packsPerRecipe != null && <p className="text-sm">Make <b>{d.packsPerRecipe} packs of each recipe</b> (with the buffer).</p>}
        </div>
        {!isOpen && !cancelled && (
          <div className="space-y-1.5">
            <span className="block text-sm font-semibold">{day(d.productionDate)}: what goes on the plan?</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Production for this day">
              {([["test_only", "Test only"], ["test_plus_normal", "Test + normal production"]] as const).map(([k, label]) => (
                <Chip key={k} active={d.productionMix === k} onClick={() => now.mutate({ productionMix: d.productionMix === k ? null : k })}>{label}</Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      {d.warnings.length > 0 && <Warnings list={d.warnings} />}
      {writeErr && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {writeErr.message}</p>}

      {d.tasks.length > 0 && (
        <ol className="space-y-2.5">
          {d.tasks.map(t => <TaskRow key={t.key} task={t} onToggle={done => onToggle(t.key, done)} />)}
        </ol>
      )}
      {d.afterClose.length > 0 && (
        <div className="rounded-2xl border-2 border-dashed border-border p-4 space-y-1.5">
          <p className="text-sm font-semibold flex items-center gap-1.5"><Lock className="w-4 h-4" /> Once you close orders for {dayMonth(d.deliveryDate)}:</p>
          <ul className="text-sm text-muted-foreground list-disc pl-6 space-y-0.5">{d.afterClose.map(a => <li key={a}>{a}</li>)}</ul>
        </div>
      )}

      <footer className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
        <span className="text-sm font-semibold mr-1">Status</span>
        {DELIVERY_STATUSES.filter(s => s.key !== "open" && s.key !== "closed").map(s => (
          <Chip key={s.key} active={d.status === s.key} onClick={() => now.mutate({ status: d.status === s.key ? (d.closedOn ? "closed" : "open") : s.key })}>{s.label}</Chip>
        ))}
        <span className="flex-1" />
        {!confirmRemove ? (
          <button onClick={() => setConfirmRemove(true)} className="px-3 py-2 rounded-xl text-red-600 font-semibold flex items-center gap-1.5 hover:bg-red-500/10">
            <Trash2 className="w-4 h-4" /> Remove date
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold">Remove {dayMonth(d.deliveryDate)} from “{boxName}”? Its open to-dos go too.</span>
            <button onClick={() => remove.mutate()} disabled={remove.isPending} className="px-3 py-2 rounded-xl bg-red-600 text-white font-semibold">Remove</button>
            <button onClick={() => setConfirmRemove(false)} className="px-3 py-2 rounded-xl border-2 border-border font-semibold">Keep</button>
          </span>
        )}
      </footer>
    </article>
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
        className={cn("w-10 h-10 rounded-xl border-2 flex items-center justify-center flex-shrink-0",
          t.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary")}
      >
        {t.done && <Check className="w-5 h-5" />}
      </button>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-base font-bold tabular-nums", overdue && "text-red-600")}>{day(t.date)}{t.time ? `, ${t.time}` : ""}</span>
          <span className={cn("text-base font-semibold", t.done && "line-through")}>{t.label}</span>
          {overdue && <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold uppercase">Overdue</span>}
          {t.clamped && !t.done && <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-semibold">Tight timeline — due straight away</span>}
          {t.automated && <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">Done by the app</span>}
          {t.specialist && <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-800 dark:text-violet-300 text-xs font-semibold">Specialist — extra lead time</span>}
          {t.assumed && <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-semibold">Lead time assumed</span>}
          {t.beforeOrdersClose && !t.done && <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-800 dark:text-sky-300 text-xs font-semibold">Before orders close — order on forecast + buffer</span>}
        </p>
        {t.how && <p className="text-sm text-muted-foreground">{t.how}</p>}
        {t.detail && <p className="text-sm text-muted-foreground">{t.detail}</p>}
        {t.link && (
          <Link href={t.link} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline underline-offset-2">
            Open Queued production <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        )}
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

function RecipePicker({ ids, names, onChange }: { ids: number[]; names: Array<{ id: number; name: string; isDraft?: boolean }>; onChange: (ids: number[]) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["test-boxes", "recipe-options"],
    // Drafts are included (flagged isDraft) — a test box is how a draft gets
    // trialled. Archived recipes aren't.
    queryFn: () => api<{ recipes: Array<{ id: number; name: string; category: string | null; isDraft?: boolean }> }>("/recipe-options"),
    staleTime: 5 * 60_000,
  });
  const all = data?.recipes ?? [];
  const nameOf = (id: number) => all.find(r => r.id === id)?.name ?? names.find(r => r.id === id)?.name ?? `Recipe ${id}`;
  const draftIds = new Set([...all.filter(r => r.isDraft).map(r => r.id), ...names.filter(r => r.isDraft).map(r => r.id)]);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return all.filter(r => !ids.includes(r.id) && r.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [q, all, ids]);
  const full = ids.length >= 4;

  return (
    <div className="space-y-2">
      <span className="block text-sm font-semibold">Recipes <span className="font-normal text-muted-foreground">— 2 to 4, drafts welcome</span></span>
      {ids.length === 0 ? (
        <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/10 px-4 py-3 text-base flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <span><b>Add the recipes in this box.</b> Until then the app can't work out what to order, when — or whether any specialist ingredient pulls the close-orders date earlier.</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {ids.map(id => (
            <span key={id} className="pl-3.5 pr-1.5 py-1.5 rounded-full bg-rose-500/10 text-rose-900 dark:text-rose-100 text-base font-semibold inline-flex items-center gap-1.5">
              {nameOf(id)}
              {draftIds.has(id) && <RecipeDraftBadge />}
              <button onClick={() => onChange(ids.filter(x => x !== id))} className="p-1 rounded-full hover:bg-rose-500/20" aria-label={`Remove ${nameOf(id)}`}><X className="w-4 h-4" /></button>
            </span>
          ))}
        </div>
      )}
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
                    {r.isDraft && <span className="ml-2 align-middle"><RecipeDraftBadge /></span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {full && <p className="text-sm text-muted-foreground">Four recipes is the most a test box takes.</p>}
      {ids.some(id => draftIds.has(id)) && (
        <p className="text-sm text-muted-foreground">A draft can go in a test box, but it won't be offered on a production plan or in Queued production until it's put on the menu — from <Link href="/recipes?view=drafts" className="font-semibold text-primary underline underline-offset-2">Recipes → Drafts</Link>.</p>
      )}
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
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn("px-4 py-2 rounded-full border-2 text-base font-semibold transition-colors",
        active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:bg-secondary/50")}>
      {children}
    </button>
  );
}
