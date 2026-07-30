import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { format, addDays, parseISO } from "date-fns";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Check, X, Play,
  CalendarDays, Inbox, Target, LayoutTemplate, CircleDashed,
  SkipForward, Pencil, Repeat, Copy, Video, ExternalLink, Eye, EyeOff,
  BellRing, BellOff,
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

interface CalEvent {
  title: string;
  calendar: string;
  startMin: number;
  endMin: number;
  allDay: boolean;
  joinUrl: string | null;
  joinIsCall: boolean;
}

interface RecurringItem {
  id: number;
  pillarId: number;
  title: string;
  ticked: boolean;
}

interface Overview {
  date: string;
  weekday: number;
  pillars: Pillar[];
  blocks: Block[];
  templates: TemplateRow[];
  parkingLot: ParkingItem[];
  recurringItems: RecurringItem[];
  calendarConfigured: boolean;
  events: CalEvent[];
  calendarError: string | null;
}

interface CaldavCalendar {
  url: string;
  name: string;
  enabled: boolean;
}

interface CaldavStatus {
  configured: boolean;
  appleId?: string;
  calendars?: CaldavCalendar[];
  error?: string;
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
    mutationFn: (b: { date: string; startMin: number; endMin: number; title?: string; pillarId: number | null }) =>
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
  const addRecurring = useMutation({
    mutationFn: (r: { pillarId: number; title: string }) =>
      api("/recurring-items", { method: "POST", body: JSON.stringify(r) }),
    onSuccess: invalidate,
  });
  const deleteRecurring = useMutation({
    mutationFn: (id: number) => api(`/recurring-items/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const tickRecurring = useMutation({
    mutationFn: ({ id, ticked }: { id: number; ticked: boolean }) =>
      api(`/recurring-items/${id}/tick`, { method: "POST", body: JSON.stringify({ date: dateStr, ticked }) }),
    onSuccess: invalidate,
  });
  const addTemplateRow = useMutation({
    mutationFn: (t: { weekday: number; startMin: number; endMin: number; title?: string; pillarId: number | null }) =>
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
  const events = data?.events ?? [];

  // One merged timeline: blocks you planned plus meetings from the diary.
  // Meetings are immovable, so Now/Next treats them as first-class items —
  // "you're in the supplier call until 2" beats pretending the block matters.
  type TimelineItem =
    | { kind: "block"; startMin: number; endMin: number; block: Block }
    | { kind: "event"; startMin: number; endMin: number; event: CalEvent };
  const timeline: TimelineItem[] = [
    ...blocks.map(b => ({ kind: "block" as const, startMin: b.startMin, endMin: b.endMin, block: b })),
    ...events.filter(e => !e.allDay).map(e => ({ kind: "event" as const, startMin: e.startMin, endMin: e.endMin, event: e })),
  ].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const allDayEvents = events.filter(e => e.allDay);

  const isLive = (t: TimelineItem) => t.kind === "event" || t.block.status === "planned";
  const currentItem = isToday ? timeline.find(t => isLive(t) && t.startMin <= now && now < t.endMin) : undefined;
  const nextItem = isToday ? timeline.find(t => isLive(t) && t.startMin > now) : undefined;

  // Completed things are clutter mid-day: hide done/skipped blocks and (for
  // today only) meetings that have already ended, behind a toggle. Past
  // dates always show everything — that's the day's record.
  const [showCompleted, setShowCompleted] = useState(false);
  const isCompleted = (t: TimelineItem) =>
    t.kind === "block"
      ? t.block.status !== "planned"
      : (isToday && t.endMin <= now);
  const completedCount = isToday ? timeline.filter(isCompleted).length : 0;
  const visibleTimeline = isToday && !showCompleted ? timeline.filter(t => !isCompleted(t)) : timeline;

  // ── Reminders ────────────────────────────────────────────────────────────
  // Pop-up 10 minutes before anything on today's timeline (meetings and
  // blocks). Browser Notification API: works while the app is open in a
  // desktop/tablet browser; on an iPhone it needs the app added to the home
  // screen. The fired-set stops the 30s tick re-firing the same reminder.
  const notifSupported = typeof window !== "undefined" && "Notification" in window;
  const [notifPermission, setNotifPermission] = useState<string>(
    () => (typeof Notification !== "undefined" ? Notification.permission : "unsupported"),
  );
  const firedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isToday || notifPermission !== "granted") return;
    const LEAD_MIN = 10;
    for (const t of timeline) {
      if (t.kind === "block" && t.block.status !== "planned") continue;
      const minsTo = t.startMin - now;
      if (minsTo <= 0 || minsTo > LEAD_MIN) continue;
      const title = t.kind === "event" ? t.event.title : t.block.title;
      const key = `${dateStr}|${t.startMin}|${title}`;
      if (firedRef.current.has(key)) continue;
      firedRef.current.add(key);
      try {
        const n = new Notification(`${title} — in ${minsTo} min`, {
          body: t.kind === "event"
            ? `${minToTime(t.startMin)} · ${t.event.calendar}${t.event.joinIsCall ? " · join from the planner" : ""}`
            : `${minToTime(t.startMin)} · time block`,
          tag: key,
        });
        n.onclick = () => window.focus();
      } catch {
        // Some platforms expose the API but refuse page-context notifications.
      }
    }
  });

  // Accordion: one pillar open at a time keeps the rail scannable.
  const [openPillarId, setOpenPillarId] = useState<number | null>(null);

  // Recurring rituals attach to the FIRST block of their pillar for the day,
  // so "30-min one-on-one" shows inside the morning Team & Coaching block
  // and simply doesn't appear on days whose template skips the pillar.
  const recurringByBlockId = useMemo(() => {
    const firstBlockForPillar = new Map<number, number>();
    for (const b of blocks) {
      if (b.pillarId != null && !firstBlockForPillar.has(b.pillarId)) {
        firstBlockForPillar.set(b.pillarId, b.id);
      }
    }
    const m = new Map<number, RecurringItem[]>();
    for (const item of data?.recurringItems ?? []) {
      const blockId = firstBlockForPillar.get(item.pillarId);
      if (blockId == null) continue;
      if (!m.has(blockId)) m.set(blockId, []);
      m.get(blockId)!.push(item);
    }
    return m;
  }, [blocks, data?.recurringItems]);

  if (state.status !== "authenticated" || state.user.email !== FOUNDER_EMAIL) {
    return <Redirect to="/" />;
  }

  return (
    <div className="space-y-6">
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
        {notifSupported && notifPermission === "default" && (
          <button
            onClick={() => Notification.requestPermission().then(setNotifPermission)}
            title="Get a pop-up 10 minutes before meetings and time blocks"
            className="p-2 rounded-lg border border-border hover:bg-secondary/50 text-muted-foreground"
            aria-label="Enable reminders"
          >
            <BellRing className="w-4 h-4" />
          </button>
        )}
        {notifSupported && notifPermission === "denied" && (
          <span title="Notifications are blocked for this site in your browser settings" className="p-2 text-muted-foreground/50">
            <BellOff className="w-4 h-4" />
          </span>
        )}
        <button onClick={() => setDateStr(format(addDays(parseISO(dateStr), 1), "yyyy-MM-dd"))}
          className="p-2 rounded-lg border border-border hover:bg-secondary/50" aria-label="Next day">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* ── Now / Next ──────────────────────────────────────────────────── */}
      {isToday && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NowNextCard label="Now" item={currentItem} pillarById={pillarById} now={now}
            empty={timeline.length === 0 ? "No plan yet — block the day out below." : "Nothing blocked right now."} />
          <NowNextCard label="Next" item={nextItem} pillarById={pillarById} now={now}
            empty="Nothing else planned today." />
        </div>
      )}

      {/* ── All-day + calendar warnings ─────────────────────────────────── */}
      {allDayEvents.length > 0 && (
        <div className="rounded-xl border border-border bg-secondary/30 px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap">
          <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          {allDayEvents.map((e, i) => (
            <span key={i} className="font-medium">
              {e.title}
              <span className="text-muted-foreground font-normal text-xs ml-1">({e.calendar})</span>
              {i < allDayEvents.length - 1 && <span className="text-muted-foreground"> · </span>}
            </span>
          ))}
        </div>
      )}
      {data?.calendarError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          Apple Calendar unavailable: {data.calendarError}
        </div>
      )}

      {/* ── Two columns on wide screens: the day on the left, planning
             tools on the right; stacked on tablet/mobile. ─────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
      <div className="space-y-6 min-w-0">

      {/* ── Day blocks ──────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Time blocks
          </h2>
          <div className="flex items-center gap-2">
            {completedCount > 0 && (
              <button
                onClick={() => setShowCompleted(s => !s)}
                className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 flex items-center gap-1.5 text-muted-foreground"
              >
                {showCompleted ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showCompleted ? "Hide completed" : `Show completed (${completedCount})`}
              </button>
            )}
            <button
              onClick={() => applyTemplate.mutate()}
              disabled={applyTemplate.isPending || (data?.templates.length ?? 0) === 0}
              title={(data?.templates.length ?? 0) === 0 ? "No template rows for this weekday yet — add some below." : undefined}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <LayoutTemplate className="w-3.5 h-3.5" /> Fill from template
            </button>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No blocks for this day yet.</p>
        ) : visibleTimeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything's done or wrapped up — nice. Toggle "Show completed" to review the day.</p>
        ) : (
          <ul className="space-y-2">
            {visibleTimeline.map(t => t.kind === "event" ? (
              <li key={`e-${t.event.calendar}-${t.startMin}-${t.event.title}`}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-dashed border-border p-3 bg-secondary/30",
                  isToday && t.startMin <= now && now < t.endMin && "ring-2 ring-primary/60",
                )}>
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">{t.event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {minToTime(t.startMin)}–{minToTime(t.endMin)}
                    <span className="ml-2">{t.event.calendar} · from your diary</span>
                  </p>
                </div>
                {t.event.joinUrl && (
                  <a
                    href={t.event.joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 flex-shrink-0",
                      t.event.joinIsCall
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border border-border hover:bg-secondary/50 text-muted-foreground",
                    )}
                  >
                    {t.event.joinIsCall ? <Video className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
                    {t.event.joinIsCall ? "Join" : "Open"}
                  </a>
                )}
              </li>
            ) : (() => {
              const b = t.block;
              const pillar = b.pillarId != null ? pillarById.get(b.pillarId) : undefined;
              const color = pillar?.color ?? DEFAULT_PILLAR_COLOR;
              const isCurrent = isToday && b.startMin <= now && now < b.endMin;
              const rituals = recurringByBlockId.get(b.id) ?? [];
              return (
                <li key={b.id}
                  className={cn(
                    "rounded-xl border border-border p-3 bg-background",
                    b.status === "done" && "opacity-60",
                    b.status === "skipped" && "opacity-40",
                    isCurrent && b.status === "planned" && "ring-2 ring-primary/60",
                  )}
                  style={{ borderLeft: `5px solid ${color}` }}
                >
                  <div className="flex items-center gap-3">
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
                        {pillar && pillar.name !== b.title && <span className="ml-2" style={{ color }}>{pillar.name}</span>}
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
                  </div>
                  {rituals.length > 0 && (
                    <ul className="mt-2 ml-11 space-y-1.5">
                      {rituals.map(r => (
                        <li key={r.id} className="flex items-center gap-2 text-sm">
                          <button
                            onClick={() => tickRecurring.mutate({ id: r.id, ticked: !r.ticked })}
                            className={cn(
                              "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                              r.ticked ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
                            )}
                            aria-label={r.ticked ? `Untick ${r.title}` : `Tick ${r.title}`}
                          >
                            {r.ticked && <Check className="w-3 h-3" />}
                          </button>
                          <span className={cn(r.ticked && "line-through text-muted-foreground")}>
                            {r.title}
                            <Repeat className="w-3 h-3 inline ml-1.5 text-muted-foreground" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })())}
          </ul>
        )}

        <AddBlockForm
          pillars={data?.pillars ?? []}
          pending={addBlock.isPending}
          onAdd={(startMin, endMin, pillarId, title) =>
            addBlock.mutate({ date: dateStr, startMin, endMin, pillarId, ...(title ? { title } : {}) })}
        />
      </section>

      </div>{/* end main column */}
      <div className="space-y-6 min-w-0">

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
            open={openPillarId === p.id}
            onToggle={() => setOpenPillarId(id => (id === p.id ? null : p.id))}
            recurring={(data?.recurringItems ?? []).filter(r => r.pillarId === p.id)}
            onAddGoal={title => addGoal.mutate({ pillarId: p.id, title })}
            onToggleGoal={g => patchGoal.mutate({ id: g.id, status: g.status === "done" ? "active" : "done" })}
            onDeleteGoal={id => deleteGoal.mutate(id)}
            onAddRecurring={title => addRecurring.mutate({ pillarId: p.id, title })}
            onDeleteRecurring={id => deleteRecurring.mutate(id)}
            onRename={name => patchPillar.mutate({ id: p.id, name })}
            onTarget={pct => patchPillar.mutate({ id: p.id, targetSharePct: pct })}
            onArchive={() => patchPillar.mutate({ id: p.id, archived: true })}
          />
        ))}
        <AddPillarForm pending={addPillar.isPending} onAdd={(name, color) => addPillar.mutate({ name, color })} />
      </section>

      {/* ── Apple Calendar connection ───────────────────────────────────── */}
      <AppleCalendarCard />

      {/* ── Weekly template ─────────────────────────────────────────────── */}
      <TemplateEditor
        pillars={data?.pillars ?? []}
        pendingAdd={addTemplateRow.isPending}
        onAdd={row => addTemplateRow.mutate(row)}
        onDelete={id => deleteTemplateRow.mutate(id)}
      />

      </div>{/* end right rail */}
      </div>{/* end two-column grid */}
    </div>
  );
}

// ── Now / Next card ────────────────────────────────────────────────────────
type TimelineCardItem =
  | { kind: "block"; startMin: number; endMin: number; block: Block }
  | { kind: "event"; startMin: number; endMin: number; event: CalEvent };

function NowNextCard({ label, item, pillarById, now, empty }: {
  label: string;
  item: TimelineCardItem | undefined;
  pillarById: Map<number, Pillar>;
  now: number;
  empty: string;
}) {
  const pillar = item?.kind === "block" && item.block.pillarId != null ? pillarById.get(item.block.pillarId) : undefined;
  const color = item?.kind === "event" ? "#64748b" : (pillar?.color ?? DEFAULT_PILLAR_COLOR);
  const title = item?.kind === "event" ? item.event.title : item?.block.title;
  const tag = item?.kind === "event" ? `${item.event.calendar} · diary` : pillar?.name;
  return (
    <div className="rounded-2xl border border-border bg-card p-4"
      style={item ? { borderTop: `4px solid ${color}` } : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        {label === "Now" ? <Play className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {label}
      </p>
      {item ? (
        <>
          <p className="font-display font-bold text-lg leading-tight mt-1">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {minToTime(item.startMin)}–{minToTime(item.endMin)}
            {label === "Now" && <span className="ml-1.5 font-medium text-foreground">· {item.endMin - now} min left</span>}
            {tag && <span className="ml-1.5" style={{ color }}>{tag}</span>}
          </p>
          {item.kind === "event" && item.event.joinUrl && (
            <a
              href={item.event.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "mt-2 inline-flex px-3 py-1.5 rounded-lg text-xs font-medium items-center gap-1.5",
                item.event.joinIsCall
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border hover:bg-secondary/50 text-muted-foreground",
              )}
            >
              {item.event.joinIsCall ? <Video className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
              {item.event.joinIsCall ? "Join call" : "Open link"}
            </a>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground mt-1.5">{empty}</p>
      )}
    </div>
  );
}

// ── Apple Calendar connection card ─────────────────────────────────────────
function AppleCalendarCard() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery<CaldavStatus>({
    queryKey: ["founder-focus-caldav"],
    queryFn: () => api("/caldav"),
    staleTime: 5 * 60 * 1000,
  });
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: () => api("/caldav", { method: "POST", body: JSON.stringify({ appleId: appleId.trim(), appPassword: appPassword.trim() }) }),
    onSuccess: () => {
      setAppPassword("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["founder-focus-caldav"] });
      queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => api("/caldav", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["founder-focus-caldav"] });
      queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
    },
  });
  const saveCalendarToggles = useMutation({
    mutationFn: (enabledUrls: string[]) =>
      api("/caldav/calendars", { method: "PUT", body: JSON.stringify({ enabledUrls }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["founder-focus-caldav"] });
      queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
    },
  });

  function toggleCalendar(cal: CaldavCalendar) {
    const calendars = status?.calendars ?? [];
    const enabledUrls = calendars
      .filter(c => (c.url === cal.url ? !c.enabled : c.enabled))
      .map(c => c.url);
    saveCalendarToggles.mutate(enabledUrls);
  }

  const inputCls = "px-2.5 py-2 rounded-lg border border-border bg-background text-sm";

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-primary" /> Apple Calendar
      </h2>
      {status?.configured ? (
        <>
          <p className="text-sm">Connected as <b>{status.appleId}</b></p>
          {status.calendars && status.calendars.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Tap a calendar to show or hide it in the day view. New calendars you create in Apple stay hidden until you switch them on here.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {status.calendars.map(c => (
                  <button
                    key={c.url}
                    onClick={() => toggleCalendar(c)}
                    disabled={saveCalendarToggles.isPending}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 disabled:opacity-60",
                      c.enabled
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-secondary/40 border-border text-muted-foreground line-through",
                    )}
                    aria-pressed={c.enabled}
                  >
                    {c.enabled ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {status.error && (
            <p className="text-sm text-amber-700 dark:text-amber-400">{status.error}</p>
          )}
          <button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Read-only: meetings appear in the day view; nothing is ever written to your calendar.
            Use an <b>app-specific password</b> from account.apple.com (Sign-In &amp; Security → App-Specific
            Passwords), never your real Apple ID password. Generate a fresh one — if a password has ever been
            shared anywhere else (a chat, a note), revoke it first.
          </p>
          <div className="flex flex-wrap gap-2">
            <input value={appleId} onChange={e => setAppleId(e.target.value)} placeholder="Apple ID email"
              type="email" autoComplete="off" className={inputCls + " flex-1 min-w-[200px]"} />
            <input value={appPassword} onChange={e => setAppPassword(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx"
              type="password" autoComplete="off" className={inputCls + " flex-1 min-w-[180px] font-mono"} />
            <button
              onClick={() => connect.mutate()}
              disabled={connect.isPending || !appleId.trim() || appPassword.trim().length < 8}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {connect.isPending ? "Connecting…" : "Connect"}
            </button>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </>
      )}
    </section>
  );
}

// ── Add block form ─────────────────────────────────────────────────────────
// The pillar IS the block: pick a pillar and a time range and go. The title
// is an optional override for one-offs that don't fit a pillar.
function AddBlockForm({ pillars, pending, onAdd }: {
  pillars: Pillar[];
  pending: boolean;
  onAdd: (startMin: number, endMin: number, pillarId: number | null, title: string | null) => void;
}) {
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [title, setTitle] = useState("");
  const [pillarId, setPillarId] = useState<string>("");

  const canSubmit = !!pillarId || !!title.trim();

  function submit() {
    const s = timeToMin(start);
    const e = timeToMin(end);
    if (s == null || e == null || e <= s || !canSubmit) return;
    onAdd(s, e, pillarId ? Number(pillarId) : null, title.trim() || null);
    setTitle("");
  }

  const inputCls = "px-2.5 py-2 rounded-lg border border-border bg-background text-sm";

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <input type="time" value={start} onChange={e => setStart(e.target.value)} className={inputCls} aria-label="Start time" />
      <span className="text-muted-foreground text-sm">–</span>
      <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} aria-label="End time" />
      <select value={pillarId} onChange={e => setPillarId(e.target.value)} className={inputCls + " flex-1 min-w-[140px]"} aria-label="Pillar">
        <option value="">Pick a pillar…</option>
        {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder="Title (optional)"
        className={inputCls + " flex-1 min-w-[120px]"}
      />
      <button onClick={submit} disabled={pending || !canSubmit}
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

// ── Pillar card (accordion) ────────────────────────────────────────────────
function PillarCard({ pillar, open, onToggle, recurring, onAddGoal, onToggleGoal, onDeleteGoal, onAddRecurring, onDeleteRecurring, onRename, onTarget, onArchive }: {
  pillar: Pillar;
  open: boolean;
  onToggle: () => void;
  recurring: RecurringItem[];
  onAddGoal: (title: string) => void;
  onToggleGoal: (g: Goal) => void;
  onDeleteGoal: (id: number) => void;
  onAddRecurring: (title: string) => void;
  onDeleteRecurring: (id: number) => void;
  onRename: (name: string) => void;
  onTarget: (pct: number | null) => void;
  onArchive: () => void;
}) {
  const [newGoal, setNewGoal] = useState("");
  const [newRecurring, setNewRecurring] = useState("");
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
    <div className="rounded-2xl border border-border bg-card" style={{ borderLeft: `5px solid ${color}` }}>
      {/* Accordion header — always visible, summarises what's inside */}
      <button onClick={onToggle} className="w-full flex items-center gap-2 p-4 text-left" aria-expanded={open}>
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
        <h3 className="font-semibold text-sm flex-1 min-w-0 truncate">{pillar.name}</h3>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {activeGoals.length} goal{activeGoals.length !== 1 ? "s" : ""}
          {recurring.length > 0 && ` · ${recurring.length} daily`}
          {pillar.targetSharePct != null && ` · ${pillar.targetSharePct}%`}
        </span>
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform flex-shrink-0", open && "rotate-90")} />
      </button>

      {open && (
      <div className="px-4 pb-4 space-y-3">
      <div className="flex items-center gap-2">
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
          <button onClick={() => { setNameDraft(pillar.name); setEditingName(true); }}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary/50 flex items-center gap-1.5 text-xs" aria-label="Rename pillar">
            <Pencil className="w-3.5 h-3.5" /> Rename
          </button>
        )}
        <span className="flex-1" />
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

      {/* Daily rituals — tickable each day inside this pillar's time block */}
      <div className="pt-1 border-t border-border/60 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
          <Repeat className="w-3 h-3" /> Daily
        </p>
        {recurring.map(r => (
          <div key={r.id} className="flex items-center gap-2 text-sm group">
            <Repeat className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="flex-1">{r.title}</span>
            <button onClick={() => onDeleteRecurring(r.id)}
              className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive" aria-label="Delete daily item">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            value={newRecurring}
            onChange={e => setNewRecurring(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newRecurring.trim()) { onAddRecurring(newRecurring.trim()); setNewRecurring(""); } }}
            placeholder="Add a daily item — reappears every day this pillar is blocked…"
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm"
          />
          <button
            onClick={() => { if (newRecurring.trim()) { onAddRecurring(newRecurring.trim()); setNewRecurring(""); } }}
            disabled={!newRecurring.trim()}
            className="px-2.5 py-1.5 rounded-lg border border-border text-sm hover:bg-secondary/50 disabled:opacity-50" aria-label="Add daily item">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
      </div>
      )}
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
  onAdd: (row: { weekday: number; startMin: number; endMin: number; title?: string; pillarId: number | null }) => void;
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

  const copyDay = useMutation({
    mutationFn: () => api("/templates/copy-day", {
      method: "POST",
      body: JSON.stringify({ fromWeekday: weekday, toWeekdays: [1, 2, 3, 4, 5] }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["founder-focus-templates"] });
      queryClient.invalidateQueries({ queryKey: ["founder-focus"] });
    },
  });

  function submit() {
    const s = timeToMin(start);
    const e = timeToMin(end);
    if (s == null || e == null || e <= s || (!pillarId && !title.trim())) return;
    onAdd({ weekday, startMin: s, endMin: e, ...(title.trim() ? { title: title.trim() } : {}), pillarId: pillarId ? Number(pillarId) : null });
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
          <div className="flex gap-1.5 flex-wrap items-center">
            {WEEKDAYS.map((d, i) => (
              <button key={d} onClick={() => setDayIdx(i)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm border",
                  i === dayIdx ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary/50",
                )}>
                {d}
              </button>
            ))}
            <button
              onClick={() => copyDay.mutate()}
              disabled={copyDay.isPending || rows.length === 0}
              title={rows.length === 0 ? "Nothing to copy on this day yet." : `Replace Mon–Fri with ${WEEKDAYS[dayIdx]}'s blocks`}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" /> {copyDay.isPending ? "Copying…" : `Copy ${WEEKDAYS[dayIdx]} to Mon–Fri`}
            </button>
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
            <select value={pillarId} onChange={e => setPillarId(e.target.value)} className={inputCls + " flex-1 min-w-[140px]"} aria-label="Pillar">
              <option value="">Pick a pillar…</option>
              {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input value={title} onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
              placeholder="Title (optional)" className={inputCls + " flex-1 min-w-[110px]"} />
            <button onClick={submit} disabled={pendingAdd || (!pillarId && !title.trim())}
              className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
