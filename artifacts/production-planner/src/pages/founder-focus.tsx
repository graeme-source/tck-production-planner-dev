import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { format, addDays, parseISO } from "date-fns";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Check, X, Play,
  CalendarDays, Inbox, Target, LayoutTemplate, CircleDashed,
  SkipForward, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

// ── Types (mirror the founder-focus API) ────────────────────────────────────
interface Goal {
  id: number;
  pillarId: number;
  title: string;
  detail: string | null;
  status: "active" | "done" | "parked";
  sort: number;
}

interface Pillar {
  id: number;
  name: string;
  color: string | null;
  sort: number;
  targetSharePct: number | null;
  notes: string | null;
  goals: Goal[];
}

interface Block {
  id: number;
  date: string;
  startMin: number;
  endMin: number;
  pillarId: number | null;
  title: string;
  notes: string | null;
  status: "planned" | "done" | "skipped";
  source: string;
}

interface TemplateRow {
  id: number;
  weekday: number;
  startMin: number;
  endMin: number;
  pillarId: number | null;
  title: string;
}

interface ParkingItem {
  id: number;
  text: string;
  createdAt: string;
}

interface Overview {
  date: string;
  weekday: number;
  pillars: Pillar[];
  blocks: Block[];
  templates: TemplateRow[];
  parkingLot: ParkingItem[];
}

// ── Helpers ────────────────────────────────────────────────────────────────
function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

const DEFAULT_PILLAR_COLOR = "#9ca3af";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api/founder-focus${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function FounderFocus() {
  const { state } = useAuth();
  const queryClient = useQueryClient();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [dateStr, setDateStr] = useState(todayStr);

  // Re-render every 30s so the Now/Next strip tracks the clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading } = useQuery<Overview>({
    queryKey: ["founder-focus", dateStr],
    queryFn: () => api(`/overview?date=${dateStr}`),
    enabled: state.status === "authenticated" && state.user.email === FOUNDER_EMAIL,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["founder-focus"] });

  // ── Mutations ────────────────────────────────────────────────────────────
  const addBlock = useMutation({
    mutationFn: (b: { date: string; startMin: number; endMin: number; title: string; pillarId: number | null }) =>
      api("/blocks", { method: "POST", body: JSON.stringify(b) }),
    onSuccess: invalidate,
  });
  const patchBlock = useMutation({
    mutationFn: ({ id, ...fields }: { id: number } & Partial<Pick<Block, "status" | "title" | "startMin" | "endMin" | "pillarId">>) =>
      api(`/blocks/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: invalidate,
  });
  const deleteBlock = useMutation({
    mutationFn: (id: number) => api(`/blocks/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const applyTemplate = useMutation({
    mutationFn: () => api("/blocks/apply-template", { method: "POST", body: JSON.stringify({ date: dateStr }) }),
    onSuccess: invalidate,
  });
  const addParking = useMutation({
    mutationFn: (text: string) => api("/parking-lot", { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: invalidate,
  });
  const resolveParking = useMutation({
    mutationFn: (id: number) => api(`/parking-lot/${id}`, { method: "PATCH", body: JSON.stringify({ resolved: true }) }),
    onSuccess: invalidate,
  });
  const addGoal = useMutation({
    mutationFn: (g: { pillarId: number; title: string }) => api("/goals", { method: "POST", body: JSON.stringify(g) }),
    onSuccess: invalidate,
  });
  const patchGoal = useMutation({
    mutationFn: ({ id, ...fields }: { id: number; status?: Goal["status"]; title?: string }) =>
      api(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: invalidate,
  });
  const deleteGoal = useMutation({
    mutationFn: (id: number) => api(`/goals/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const addPillar = useMutation({
    mutationFn: (p: { name: string; color: string }) => api("/pillars", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: invalidate,
  });
  const patchPillar = useMutation({
    mutationFn: ({ id, ...fields }: { id: number; name?: string; targetSharePct?: number | null; notes?: string | null; archived?: boolean }) =>
      api(`/pillars/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
    onSuccess: invalidate,
  });
  const addTemplateRow = useMutation({
    mutationFn: (t: { weekday: number; startMin: number; endMin: number; title: string; pillarId: number | null }) =>
      api("/templates", { method: "POST", body: JSON.stringify(t) }),
    onSuccess: invalidate,
  });
  const deleteTemplateRow = useMutation({
    mutationFn: (id: number) => api(`/templates/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  // ── Derived ──────────────────────────────────────────────────────────────
  const pillarById = useMemo(() => {
    const m = new Map<number, Pillar>();
    for (const p of data?.pillars ?? []) m.set(p.id, p);
    return m;
  }, [data?.pillars]);

  const isToday = dateStr === todayStr;
  const now = nowMinutes();
  const blocks = data?.blocks ?? [];
  const currentBlock = isToday ? blocks.find(b => b.status === "planned" && b.startMin <= now && now < b.endMin) : undefined;
  const nextBlock = isToday ? blocks.find(b => b.status === "planned" && b.startMin > now) : undefined;

  if (state.status !== "authenticated" || state.user.email !== FOUNDER_EMAIL) {
    return <Redirect to="/" />;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Founder Focus"
        description="Time-blocked days against the pillars only you can move."
      />

      {/* ── Date navigation ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <button onClick={() => setDateStr(format(addDays(parseISO(dateStr), -1), "yyyy-MM-dd"))}
          className="p-2 rounded-lg border border-border hover:bg-secondary/50" aria-label="Previous day">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center">
          <span className="font-display font-bold text-lg">{format(parseISO(dateStr), "EEEE d MMMM")}</span>
          {!isToday && (
            <button onClick={() => setDateStr(todayStr)} className="ml-3 text-xs text-primary underline hover:no-underline">
              Back to today
            </button>
          )}
        </div>
        <button onClick={() => setDateStr(format(addDays(parseISO(dateStr), 1), "yyyy-MM-dd"))}
          className="p-2 rounded-lg border border-border hover:bg-secondary/50" aria-label="Next day">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* ── Now / Next ──────────────────────────────────────────────────── */}
      {isToday && (
        <div className="grid grid-cols-2 gap-3">
          <NowNextCard label="Now" block={currentBlock} pillarById={pillarById} now={now}
            empty={blocks.length === 0 ? "No plan yet — block the day out below." : "Nothing blocked right now."} />
          <NowNextCard label="Next" block={nextBlock} pillarById={pillarById} now={now}
            empty="Nothing else planned today." />
        </div>
      )}

      {/* ── Day blocks ──────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Time blocks
          </h2>
          <button
            onClick={() => applyTemplate.mutate()}
            disabled={applyTemplate.isPending || (data?.templates.length ?? 0) === 0}
            title={(data?.templates.length ?? 0) === 0 ? "No template rows for this weekday yet — add some below." : undefined}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1.5"
          >
            <LayoutTemplate className="w-3.5 h-3.5" /> Fill from template
          </button>
        </div>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No blocks for this day yet.</p>
        ) : (
          <ul className="space-y-2">
            {blocks.map(b => {
              const pillar = b.pillarId != null ? pillarById.get(b.pillarId) : undefined;
              const color = pillar?.color ?? DEFAULT_PILLAR_COLOR;
              const isCurrent = isToday && b.startMin <= now && now < b.endMin;
              return (
                <li key={b.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border border-border p-3 bg-background",
                    b.status === "done" && "opacity-60",
                    b.status === "skipped" && "opacity-40",
                    isCurrent && b.status === "planned" && "ring-2 ring-primary/60",
                  )}
                  style={{ borderLeft: `5px solid ${color}` }}
                >
                  <button
                    onClick={() => patchBlock.mutate({ id: b.id, status: b.status === "done" ? "planned" : "done" })}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                      b.status === "done" ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
                    )}
                    aria-label={b.status === "done" ? "Mark not done" : "Mark done"}
                  >
                    {b.status === "done" ? <Check className="w-4 h-4" /> : <CircleDashed className="w-4 h-4 text-muted-foreground" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium leading-tight", b.status !== "planned" && "line-through")}>
                      {b.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {minToTime(b.startMin)}–{minToTime(b.endMin)}
                      {pillar && <span className="ml-2" style={{ color }}>{pillar.name}</span>}
                      {b.status === "skipped" && <span className="ml-2">skipped</span>}
                    </p>
                  </div>
                  {b.status === "planned" && (
                    <button onClick={() => patchBlock.mutate({ id: b.id, status: "skipped" })}
                      className="p-2 rounded-lg text-muted-foreground hover:bg-secondary/50" title="Skip this block" aria-label="Skip block">
                      <SkipForward className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => deleteBlock.mutate(b.id)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label="Delete block">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <AddBlockForm
          pillars={data?.pillars ?? []}
          pending={addBlock.isPending}
          onAdd={(startMin, endMin, title, pillarId) =>
            addBlock.mutate({ date: dateStr, startMin, endMin, title, pillarId })}
        />
      </section>

      {/* ── Parking lot ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Inbox className="w-4 h-4 text-primary" /> Parking lot
          <span className="text-xs font-normal text-muted-foreground">— things pulling at you; write them down, stay on the block</span>
        </h2>
        <ParkingInput pending={addParking.isPending} onAdd={t => addParking.mutate(t)} />
        {(data?.parkingLot.length ?? 0) > 0 && (
          <ul className="space-y-1.5">
            {data!.parkingLot.map(item => (
              <li key={item.id} className="flex items-center gap-2 text-sm rounded-lg bg-secondary/30 px-3 py-2">
                <span className="flex-1">{item.text}</span>
                <button onClick={() => resolveParking.mutate(item.id)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10"
                  title="Resolve — dealt with or planned" aria-label="Resolve item">
                  <Check className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Pillars & goals ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" /> Pillars &amp; goals
        </h2>
        {(data?.pillars ?? []).map(p => (
          <PillarCard key={p.id} pillar={p}
            onAddGoal={title => addGoal.mutate({ pillarId: p.id, title })}
            onToggleGoal={g => patchGoal.mutate({ id: g.id, status: g.status === "done" ? "active" : "done" })}
            onDeleteGoal={id => deleteGoal.mutate(id)}
            onRename={name => patchPillar.mutate({ id: p.id, name })}
            onTarget={pct => patchPillar.mutate({ id: p.id, targetSharePct: pct })}
            onArchive={() => patchPillar.mutate({ id: p.id, archived: true })}
          />
        ))}
        <AddPillarForm pending={addPillar.isPending} onAdd={(name, color) => addPillar.mutate({ name, color })} />
      </section>

      {/* ── Weekly template ─────────────────────────────────────────────── */}
      <TemplateEditor
        pillars={data?.pillars ?? []}
        pendingAdd={addTemplateRow.isPending}
        onAdd={row => addTemplateRow.mutate(row)}
        onDelete={id => deleteTemplateRow.mutate(id)}
      />
    </div>
  );
}

// ── Now / Next card ────────────────────────────────────────────────────────
function NowNextCard({ label, block, pillarById, now, empty }: {
  label: string;
  block: Block | undefined;
  pillarById: Map<number, Pillar>;
  now: number;
  empty: string;
}) {
  const pillar = block?.pillarId != null ? pillarById.get(block.pillarId) : undefined;
  const color = pillar?.color ?? DEFAULT_PILLAR_COLOR;
  return (
    <div className="rounded-2xl border border-border bg-card p-4"
      style={block ? { borderTop: `4px solid ${color}` } : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        {label === "Now" ? <Play className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {label}
      </p>
      {block ? (
        <>
          <p className="font-display font-bold text-lg leading-tight mt-1">{block.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {minToTime(block.startMin)}–{minToTime(block.endMin)}
            {label === "Now" && <span className="ml-1.5 font-medium text-foreground">· {block.endMin - now} min left</span>}
            {pillar && <span className="ml-1.5" style={{ color }}>{pillar.name}</span>}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground mt-1.5">{empty}</p>
      )}
    </div>
  );
}

// ── Add block form ─────────────────────────────────────────────────────────
function AddBlockForm({ pillars, pending, onAdd }: {
  pillars: Pillar[];
  pending: boolean;
  onAdd: (startMin: number, endMin: number, title: string, pillarId: number | null) => void;
}) {
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [title, setTitle] = useState("");
  const [pillarId, setPillarId] = useState<string>("");

  function submit() {
    const s = timeToMin(start);
    const e = timeToMin(end);
    if (s == null || e == null || e <= s || !title.trim()) return;
    onAdd(s, e, title.trim(), pillarId ? Number(pillarId) : null);
    setTitle("");
  }

  const inputCls = "px-2.5 py-2 rounded-lg border border-border bg-background text-sm";

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <input type="time" value={start} onChange={e => setStart(e.target.value)} className={inputCls} aria-label="Start time" />
      <span className="text-muted-foreground text-sm">–</span>
      <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} aria-label="End time" />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder="What will you do?"
        className={inputCls + " flex-1 min-w-[160px]"}
      />
      <select value={pillarId} onChange={e => setPillarId(e.target.value)} className={inputCls} aria-label="Pillar">
        <option value="">No pillar</option>
        {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button onClick={submit} disabled={pending || !title.trim()}
        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
        <Plus className="w-4 h-4" /> Add
      </button>
    </div>
  );
}

// ── Parking input ──────────────────────────────────────────────────────────
function ParkingInput({ pending, onAdd }: { pending: boolean; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  function submit() {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  }
  return (
    <div className="flex gap-2">
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder="It can wait — park it…"
        className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
      />
      <button onClick={submit} disabled={pending || !text.trim()}
        className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-secondary/50 disabled:opacity-50">
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Pillar card ────────────────────────────────────────────────────────────
function PillarCard({ pillar, onAddGoal, onToggleGoal, onDeleteGoal, onRename, onTarget, onArchive }: {
  pillar: Pillar;
  onAddGoal: (title: string) => void;
  onToggleGoal: (g: Goal) => void;
  onDeleteGoal: (id: number) => void;
  onRename: (name: string) => void;
  onTarget: (pct: number | null) => void;
  onArchive: () => void;
}) {
  const [newGoal, setNewGoal] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(pillar.name);
  const color = pillar.color ?? DEFAULT_PILLAR_COLOR;
  const activeGoals = pillar.goals.filter(g => g.status !== "done");
  const doneGoals = pillar.goals.filter(g => g.status === "done");

  function submitGoal() {
    if (!newGoal.trim()) return;
    onAddGoal(newGoal.trim());
    setNewGoal("");
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3" style={{ borderLeft: `5px solid ${color}` }}>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
        {editingName ? (
          <span className="flex items-center gap-1.5 flex-1">
            <input value={nameDraft} onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && nameDraft.trim()) { onRename(nameDraft.trim()); setEditingName(false); } }}
              className="px-2 py-1 rounded-md border border-border bg-background text-sm font-semibold flex-1" autoFocus />
            <button onClick={() => { if (nameDraft.trim()) { onRename(nameDraft.trim()); } setEditingName(false); }}
              className="p-1 text-primary" aria-label="Save name"><Check className="w-4 h-4" /></button>
            <button onClick={() => { setNameDraft(pillar.name); setEditingName(false); }}
              className="p-1 text-muted-foreground" aria-label="Cancel rename"><X className="w-4 h-4" /></button>
          </span>
        ) : (
          <>
            <h3 className="font-semibold text-sm flex-1">{pillar.name}</h3>
            <button onClick={() => { setNameDraft(pillar.name); setEditingName(true); }}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary/50" aria-label="Rename pillar">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="number" min={0} max={100}
            defaultValue={pillar.targetSharePct ?? ""}
            onBlur={e => {
              const v = e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value)));
              if (v !== pillar.targetSharePct) onTarget(v);
            }}
            className="w-14 px-1.5 py-1 rounded-md border border-border bg-background text-right"
            aria-label="Target share of week (%)"
          />
          %
        </label>
        <button onClick={onArchive} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          title="Archive pillar (goals kept, hidden from view)" aria-label="Archive pillar">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {pillar.notes && <p className="text-xs text-muted-foreground">{pillar.notes}</p>}

      <ul className="space-y-1">
        {activeGoals.map(g => (
          <li key={g.id} className="flex items-center gap-2 text-sm group">
            <button onClick={() => onToggleGoal(g)}
              className="w-5 h-5 rounded-full border-2 border-border hover:border-primary flex items-center justify-center flex-shrink-0"
              aria-label="Mark goal done" />
            <span className="flex-1">
              {g.title}
              {g.detail && <span className="text-muted-foreground text-xs ml-1.5">— {g.detail}</span>}
            </span>
            <button onClick={() => onDeleteGoal(g.id)}
              className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive" aria-label="Delete goal">
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
        {doneGoals.map(g => (
          <li key={g.id} className="flex items-center gap-2 text-sm text-muted-foreground group">
            <button onClick={() => onToggleGoal(g)}
              className="w-5 h-5 rounded-full bg-primary border-2 border-primary text-primary-foreground flex items-center justify-center flex-shrink-0"
              aria-label="Mark goal active">
              <Check className="w-3 h-3" />
            </button>
            <span className="flex-1 line-through">{g.title}</span>
            <button onClick={() => onDeleteGoal(g.id)}
              className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:text-destructive" aria-label="Delete goal">
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          value={newGoal}
          onChange={e => setNewGoal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submitGoal(); }}
          placeholder="Add a goal…"
          className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm"
        />
        <button onClick={submitGoal} disabled={!newGoal.trim()}
          className="px-2.5 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary/50 disabled:opacity-50" aria-label="Add goal">
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Add pillar ─────────────────────────────────────────────────────────────
const PILLAR_COLORS = ["#7cb342", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899"];

function AddPillarForm({ pending, onAdd }: { pending: boolean; onAdd: (name: string, color: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PILLAR_COLORS[4]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-secondary/30 flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> Add pillar
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-center gap-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Pillar name"
        className="flex-1 min-w-[160px] px-2.5 py-2 rounded-lg border border-border bg-background text-sm" autoFocus />
      <div className="flex gap-1.5">
        {PILLAR_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)}
            className={cn("w-6 h-6 rounded-full", color === c && "ring-2 ring-offset-2 ring-foreground/40")}
            style={{ background: c }} aria-label={`Colour ${c}`} />
        ))}
      </div>
      <button
        onClick={() => { if (name.trim()) { onAdd(name.trim(), color); setName(""); setOpen(false); } }}
        disabled={pending || !name.trim()}
        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
        Add
      </button>
      <button onClick={() => setOpen(false)} className="p-2 text-muted-foreground" aria-label="Cancel">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Weekly template editor ─────────────────────────────────────────────────
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Display order Mon..Sun ↔ JS getDay() values 1..6,0
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0];

function TemplateEditor({ pillars, pendingAdd, onAdd, onDelete }: {
  pillars: Pillar[];
  pendingAdd: boolean;
  onAdd: (row: { weekday: number; startMin: number; endMin: number; title: string; pillarId: number | null }) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [title, setTitle] = useState("");
  const [pillarId, setPillarId] = useState<string>("");

  const weekday = WEEKDAY_VALUES[dayIdx];

  const { data: allRows } = useQuery<TemplateRow[]>({
    queryKey: ["founder-focus-templates"],
    queryFn: () => api("/templates"),
    enabled: open,
  });
  const queryClient = useQueryClient();
  const rows = (allRows ?? []).filter(r => r.weekday === weekday);

  function submit() {
    const s = timeToMin(start);
    const e = timeToMin(end);
    if (s == null || e == null || e <= s || !title.trim()) return;
    onAdd({ weekday, startMin: s, endMin: e, title: title.trim(), pillarId: pillarId ? Number(pillarId) : null });
    setTitle("");
    // templates list is a separate query from the day overview
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ["founder-focus-templates"] }), 300);
  }

  const inputCls = "px-2.5 py-2 rounded-lg border border-border bg-background text-sm";

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <LayoutTemplate className="w-4 h-4 text-primary" /> Weekly template
        </h2>
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {WEEKDAYS.map((d, i) => (
              <button key={d} onClick={() => setDayIdx(i)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm border",
                  i === dayIdx ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary/50",
                )}>
                {d}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No template blocks for {WEEKDAYS[dayIdx]} yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map(r => {
                const pillar = r.pillarId != null ? pillars.find(p => p.id === r.pillarId) : undefined;
                return (
                  <li key={r.id} className="flex items-center gap-2 text-sm rounded-lg bg-secondary/30 px-3 py-2">
                    <span className="font-mono text-xs text-muted-foreground">{minToTime(r.startMin)}–{minToTime(r.endMin)}</span>
                    <span className="flex-1">{r.title}</span>
                    {pillar && <span className="text-xs" style={{ color: pillar.color ?? undefined }}>{pillar.name}</span>}
                    <button
                      onClick={() => { onDelete(r.id); setTimeout(() => queryClient.invalidateQueries({ queryKey: ["founder-focus-templates"] }), 300); }}
                      className="p-1 rounded-md text-muted-foreground hover:text-destructive" aria-label="Delete template row">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input type="time" value={start} onChange={e => setStart(e.target.value)} className={inputCls} aria-label="Start time" />
            <span className="text-muted-foreground text-sm">–</span>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} aria-label="End time" />
            <input value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
              placeholder={`Every ${WEEKDAYS[dayIdx]}…`} className={inputCls + " flex-1 min-w-[140px]"} />
            <select value={pillarId} onChange={e => setPillarId(e.target.value)} className={inputCls} aria-label="Pillar">
              <option value="">No pillar</option>
              {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={submit} disabled={pendingAdd || !title.trim()}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
